//! Scraper WebView — single persistent Tauri child Webview embedded
//! in the main window that owns the per-host cookie jar for plugin
//! fetches.
//!
//! Architecture (post Origin/CORS fight):
//!
//! - The scraper webview lives at `scraper.html` (a stable
//!   tauri://localhost origin) and is never destroyed. It exists
//!   for two reasons:
//!     1. It owns a real-browser cookie jar — when the user opens
//!        the in-app site browser overlay and navigates to a plugin
//!        site, every cookie the site sets (CF clearance, login
//!        sessions) lands in that jar and persists across requests.
//!     2. It is the surface React's `SiteBrowserOverlay` paints
//!        into when the user wants to interact with a site.
//!
//! - Plugin HTTP fetches do NOT run inside the scraper's JS
//!   context. JS-side `fetch()` from an external page can't make
//!   the IPC call back to Rust because cross-origin pages send an
//!   Origin header that Tauri's invoke handshake rejects ("Origin
//!   header is not a valid URL" for `null` etc). Instead,
//!   `webview_fetch` reads cookies from the scraper's jar via
//!   `Webview::cookies_for_url` and issues the request from Rust
//!   with `reqwest` plus a browser-shaped User-Agent. Effectively
//!   the WebView is the cookie store and CF-clearance solver; reqwest
//!   is the request engine.
//!
//! - For sites with strict TLS fingerprinting (JA3) the cookie path
//!   alone may not pass — those sites need the user to interact
//!   through the visible site browser overlay, which uses the
//!   scraper webview's own network stack. After a successful manual
//!   pass, subsequent `webview_fetch` calls reuse the cleared
//!   cookies.

use std::collections::HashMap;
use std::error::Error as StdError;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder,
    WebviewUrl,
};

const SCRAPER_LABEL: &str = "scraper";
/// Local HTML file served by Vite (dev) / bundled in dist/ (prod).
/// Using `WebviewUrl::App` gives the scraper a stable Tauri-served
/// origin so any IPC the page does (none today, but future-proof)
/// passes Tauri's Origin handshake.
const SCRAPER_HOMEPAGE_PATH: &str = "scraper.html";

/// User-Agent we put on outbound requests. Mirrors the Edge WebView2
/// channel reasonably closely so plugin sites that gate by UA accept
/// the request the same way they accept the visible site browser.
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0";

/// Inbound JSON shape from `webview_fetch` callers (matches the
/// browser `RequestInit` subset our pluginFetch surfaces).
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchInit {
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

/// Successful fetch payload returned to JS. Mirrors the subset of
/// `Response` our pluginFetch reconstitutes on the JS side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub status: u16,
    pub status_text: String,
    pub body: String,
    pub headers: HashMap<String, String>,
    pub final_url: String,
}

/// Per-target navigation lock so two `scraper_navigate` calls don't
/// race the visible overlay into the wrong page. Most callers only
/// hit `webview_fetch` (which does not navigate), so this is rarely
/// contended.
#[derive(Default)]
pub struct ScraperState {
    nav_lock: tokio::sync::Mutex<()>,
    /// Last URL the visible overlay navigated to, for diagnostics.
    last_navigated: Mutex<Option<String>>,
}

const HIDDEN_SIZE: f64 = 1.0;

fn scraper_handle(app: &AppHandle) -> Result<Webview<tauri::Wry>, String> {
    app.get_webview(SCRAPER_LABEL)
        .ok_or_else(|| "scraper: child webview not yet attached".to_string())
}

/// Eagerly attach the scraper child Webview to the main window at
/// app setup. Idempotent — re-running is a no-op once attached.
pub fn init_scraper(app: &AppHandle) -> Result<(), String> {
    if app.get_webview(SCRAPER_LABEL).is_some() {
        return Ok(());
    }
    let main_window = app
        .get_window("main")
        .ok_or_else(|| "scraper: main window missing at setup".to_string())?;

    let builder = WebviewBuilder::new(
        SCRAPER_LABEL,
        WebviewUrl::App(PathBuf::from(SCRAPER_HOMEPAGE_PATH)),
    );

    let scraper = main_window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(HIDDEN_SIZE, HIDDEN_SIZE),
        )
        .map_err(|err| format!("scraper: add_child: {err}"))?;

    #[cfg(debug_assertions)]
    {
        scraper.open_devtools();
    }
    let _ = scraper;
    Ok(())
}

/// Manually open the scraper webview's devtools.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn scraper_open_devtools(app: AppHandle) -> Result<(), String> {
    let scraper = scraper_handle(&app)?;
    scraper.open_devtools();
    Ok(())
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn scraper_open_devtools(_app: AppHandle) -> Result<(), String> {
    Err("devtools only available in debug builds".to_string())
}

/// Reposition + resize the scraper child Webview. React passes the
/// pixel rect of the placeholder div under its top chrome so the
/// scraper paints exactly inside that area.
#[tauri::command]
pub fn scraper_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let scraper = scraper_handle(&app)?;
    let safe_w = width.max(HIDDEN_SIZE);
    let safe_h = height.max(HIDDEN_SIZE);
    scraper
        .set_position(LogicalPosition::new(x, y))
        .map_err(|err| format!("scraper: set_position: {err}"))?;
    scraper
        .set_size(LogicalSize::new(safe_w, safe_h))
        .map_err(|err| format!("scraper: set_size: {err}"))?;
    Ok(())
}

/// Collapse the scraper to its hidden 1x1 footprint when the modal
/// closes. Cookies survive because the Webview is never destroyed.
#[tauri::command]
pub fn scraper_hide(app: AppHandle) -> Result<(), String> {
    let scraper = scraper_handle(&app)?;
    scraper
        .set_position(LogicalPosition::new(0.0, 0.0))
        .map_err(|err| format!("scraper: set_position: {err}"))?;
    scraper
        .set_size(LogicalSize::new(HIDDEN_SIZE, HIDDEN_SIZE))
        .map_err(|err| format!("scraper: set_size: {err}"))?;
    Ok(())
}

/// Navigate the scraper Webview to `url`. Used by the in-app site
/// browser overlay so the user can log in / clear CF / interact
/// before sending plugin scrape requests.
#[tauri::command]
pub async fn scraper_navigate(
    app: AppHandle,
    state: tauri::State<'_, ScraperState>,
    url: String,
) -> Result<(), String> {
    let _guard = state.nav_lock.lock().await;
    let scraper = scraper_handle(&app)?;
    let parsed: Url = url
        .parse()
        .map_err(|err| format!("scraper_navigate: invalid url '{url}': {err}"))?;
    scraper
        .navigate(parsed)
        .map_err(|err| format!("scraper_navigate: {err}"))?;
    *state
        .last_navigated
        .lock()
        .expect("scraper last_navigated mutex") = Some(url);
    Ok(())
}

fn parse_method(raw: &str) -> Result<reqwest::Method, String> {
    reqwest::Method::from_bytes(raw.as_bytes())
        .map_err(|err| format!("scraper: invalid HTTP method '{raw}': {err}"))
}

/// Format an error plus its full source chain so silent connection
/// failures (DNS, TCP refused, TLS handshake, proxy, firewall …)
/// surface in the global toast instead of getting flattened into a
/// single "error sending request" line.
fn describe_with_chain(err: &(dyn StdError + 'static)) -> String {
    let mut out = err.to_string();
    let mut cur = err.source();
    while let Some(src) = cur {
        out.push_str(" :: ");
        out.push_str(&src.to_string());
        cur = src.source();
    }
    out
}

/// Issue an HTTP request through Rust's reqwest, attaching whatever
/// cookies the scraper webview's jar holds for the target URL.
///
/// CF/login cookies populate via the in-app site browser overlay —
/// when the user navigates the scraper to a plugin site and clears a
/// CF challenge, those cookies stay in the WebView2 cookie jar and
/// are visible here through `cookies_for_url`.
#[tauri::command]
pub async fn webview_fetch(
    app: AppHandle,
    url: String,
    init: Option<FetchInit>,
) -> Result<FetchResult, String> {
    let scraper = scraper_handle(&app)?;
    let target_url: Url = url
        .parse()
        .map_err(|err| format!("scraper: invalid url '{url}': {err}"))?;

    let cookie_pairs: Vec<(String, String)> = scraper
        .cookies_for_url(target_url.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.name().to_string(), c.value().to_string()))
        .collect();

    let init = init.unwrap_or_default();
    let method = parse_method(init.method.as_deref().unwrap_or("GET"))?;

    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .gzip(true)
        .build()
        .map_err(|err| format!("scraper: reqwest client: {describe}", describe = describe_with_chain(&err)))?;

    let mut req = client.request(method, target_url.clone());

    if !cookie_pairs.is_empty() {
        let cookie_header = cookie_pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        req = req.header(reqwest::header::COOKIE, cookie_header);
    }

    if let Some(headers) = init.headers {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }

    if let Some(body) = init.body {
        req = req.body(body);
    }

    let resp = req
        .send()
        .await
        .map_err(|err| {
            format!(
                "scraper: request to {url} failed: {chain}",
                chain = describe_with_chain(&err),
            )
        })?;
    let status = resp.status();
    let final_url = resp.url().to_string();

    let mut result_headers: HashMap<String, String> = HashMap::new();
    for (name, value) in resp.headers() {
        if let Ok(value_str) = value.to_str() {
            result_headers.insert(name.to_string(), value_str.to_string());
        }
    }

    let body = resp
        .text()
        .await
        .map_err(|err| format!("scraper: body read failed: {err}"))?;

    Ok(FetchResult {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        body,
        headers: result_headers,
        final_url,
    })
}
