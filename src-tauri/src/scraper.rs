//! Scraper WebView: single persistent Tauri child Webview embedded
//! in the main window that owns the per-host cookie jar for plugin
//! fetches.
//!
//! Architecture:
//!
//! - The scraper webview lives at `scraper.html` (a stable
//!   tauri://localhost origin) and is never destroyed. It exists
//!   for two reasons:
//!     1. It owns a real-browser cookie jar. When the user opens
//!        the in-app site browser overlay and navigates to a plugin
//!        site, every cookie the site sets (CF clearance, login
//!        sessions) lands in that jar and persists across requests.
//!     2. It is the surface React's `SiteBrowserOverlay` paints
//!        into when the user wants to interact with a site.
//!
//! - Plugin HTTP fetches run inside the scraper WebView's JavaScript
//!   context. This covers source browsing/search/listing, novel
//!   metadata/detail parsing, update checks, and chapter body
//!   downloads. That keeps the request on the browser network stack
//!   that solved Cloudflare, owns the TLS/browser fingerprint, and
//!   carries the WebView cookie jar without copying cookies into a
//!   host-side HTTP client.
//!
//! - Cross-origin pages still cannot call Tauri IPC directly, so
//!   the host asks the WebView to start an async browser fetch and
//!   polls a page-local result slot through `eval_with_callback`.

use std::collections::HashMap;
#[cfg(desktop)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(desktop)]
use std::sync::{Arc, Mutex};
#[cfg(desktop)]
use std::time::{Duration, Instant};

#[cfg(desktop)]
use std::path::PathBuf;

#[cfg(desktop)]
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{
    LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl,
};
#[cfg(desktop)]
use tokio::sync::oneshot;
#[cfg(desktop)]
use tokio::time::timeout;

#[cfg(desktop)]
const SCRAPER_LABEL: &str = "scraper";
#[cfg(not(desktop))]
const SCRAPER_UNAVAILABLE: &str = "scraper: child webview is not available on this platform";
/// Local HTML file served by Vite (dev) / bundled in dist/ (prod).
/// Using `WebviewUrl::App` gives the scraper a stable Tauri-served
/// origin so any IPC the page does (none today, but future-proof)
/// passes Tauri's Origin handshake.
#[cfg(desktop)]
const SCRAPER_HOMEPAGE_PATH: &str = "scraper.html";
#[cfg(desktop)]
static FETCH_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Polyfill + before-content hook injected at scraper webview creation.
/// The script runs before any page script in every navigation, so
/// callers (e.g. `webview_extract`) can pass an arbitrary
/// before-content script via the URL fragment and receive results
/// asynchronously via `window.ReactNativeWebView.postMessage`.
///
/// Bridge wiring:
/// - `__lnr_script__=ENCODED` fragment: decoded + eval'd before any
///   page script runs (e.g. patches `Element.prototype.attachShadow`).
/// - `ReactNativeWebView.postMessage(payload)` polyfill: writes the
///   payload to `location.hash` as `#__lnr_result__=ENCODED`. The host
///   polls `Webview::url()` to pick up the result.
#[cfg(desktop)]
const SCRAPER_INIT_SCRIPT: &str = r##"
(function () {
  window.ReactNativeWebView = window.ReactNativeWebView || {};
  window.ReactNativeWebView.postMessage = function (payload) {
    try {
      var encoded = encodeURIComponent(String(payload));
      var marker = "#__lnr_result__=" + encoded;
      try {
        history.replaceState(null, "", location.pathname + location.search + marker);
      } catch (e) {
        location.hash = marker;
      }
    } catch (e) {}
  };
  try {
    var hash = location.hash || "";
    var prefix = "#__lnr_script__=";
    var idx = hash.indexOf(prefix);
    if (idx !== -1) {
      var encoded = hash.substring(idx + prefix.length);
      var script = decodeURIComponent(encoded);
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) {}
      try {
        (0, eval)(script);
      } catch (e) {
        var msg = (e && e.message) || String(e);
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, error: "before-script error: " + msg }));
        } catch (e2) {}
      }
    }
  } catch (e) {}
})();
"##;

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
#[cfg(desktop)]
#[derive(Default)]
pub struct ScraperState {
    nav_lock: tokio::sync::Mutex<()>,
    /// Last URL the visible overlay navigated to, for diagnostics.
    last_navigated: Mutex<Option<String>>,
}

#[cfg(not(desktop))]
#[derive(Default)]
pub struct ScraperState;

#[cfg(desktop)]
const HIDDEN_SIZE: f64 = 1.0;

#[cfg(desktop)]
fn scraper_handle(app: &AppHandle) -> Result<Webview<tauri::Wry>, String> {
    app.get_webview(SCRAPER_LABEL)
        .ok_or_else(|| "scraper: child webview not yet attached".to_string())
}

/// Eagerly attach the scraper child Webview to the main window at
/// app setup. Idempotent; re-running is a no-op once attached.
#[cfg(desktop)]
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
    )
    .initialization_script(SCRAPER_INIT_SCRIPT);

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

#[cfg(not(desktop))]
pub fn init_scraper(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Manually open the scraper webview's devtools.
#[cfg(all(debug_assertions, desktop))]
#[tauri::command]
pub fn scraper_open_devtools(app: AppHandle) -> Result<(), String> {
    let scraper = scraper_handle(&app)?;
    scraper.open_devtools();
    Ok(())
}

#[cfg(all(debug_assertions, not(desktop)))]
#[tauri::command]
pub fn scraper_open_devtools(_app: AppHandle) -> Result<(), String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn scraper_open_devtools(_app: AppHandle) -> Result<(), String> {
    Err("devtools only available in debug builds".to_string())
}

/// Reposition + resize the scraper child Webview. React passes the
/// pixel rect of the placeholder div under its top chrome so the
/// scraper paints exactly inside that area.
#[cfg(desktop)]
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

#[cfg(not(desktop))]
#[tauri::command]
pub fn scraper_set_bounds(
    _app: AppHandle,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

/// Collapse the scraper to its hidden 1x1 footprint when the modal
/// closes. Cookies survive because the Webview is never destroyed.
#[cfg(desktop)]
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

#[cfg(not(desktop))]
#[tauri::command]
pub fn scraper_hide(_app: AppHandle) -> Result<(), String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

/// Delete all cookies held by the scraper WebView cookie jar.
#[cfg(desktop)]
#[tauri::command]
pub async fn scraper_clear_cookies(app: AppHandle) -> Result<usize, String> {
    let scraper = scraper_handle(&app)?;
    let cookies = scraper
        .cookies()
        .map_err(|err| format!("scraper: read cookies: {err}"))?;
    let count = cookies.len();
    for cookie in cookies {
        scraper
            .delete_cookie(cookie)
            .map_err(|err| format!("scraper: delete cookie: {err}"))?;
    }
    Ok(count)
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn scraper_clear_cookies(_app: AppHandle) -> Result<usize, String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

/// Navigate the scraper Webview to `url`. Used by the in-app site
/// browser overlay so the user can log in / clear CF / interact
/// before sending plugin scrape requests.
#[cfg(desktop)]
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

#[cfg(not(desktop))]
#[tauri::command]
pub async fn scraper_navigate(
    _app: AppHandle,
    _state: tauri::State<'_, ScraperState>,
    _url: String,
) -> Result<(), String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

#[cfg(desktop)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewFetchScriptResult {
    ok: bool,
    status: Option<u16>,
    status_text: Option<String>,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
    final_url: Option<String>,
    error: Option<String>,
}

#[cfg(desktop)]
async fn eval_json<T: DeserializeOwned>(
    scraper: &Webview<tauri::Wry>,
    script: String,
) -> Result<T, String> {
    let (tx, rx) = oneshot::channel::<String>();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let sender_for_callback = Arc::clone(&sender);

    scraper
        .eval_with_callback(script, move |payload| {
            if let Ok(mut guard) = sender_for_callback.lock() {
                if let Some(tx) = guard.take() {
                    let _ = tx.send(payload);
                }
            }
        })
        .map_err(|err| format!("scraper: eval browser fetch script: {err}"))?;

    let payload = timeout(Duration::from_secs(5), rx)
        .await
        .map_err(|_| "scraper: eval browser fetch script timed out".to_string())?
        .map_err(|_| "scraper: eval browser fetch callback dropped".to_string())?;

    match serde_json::from_str::<T>(&payload) {
        Ok(value) => Ok(value),
        Err(first_err) => {
            let inner = serde_json::from_str::<String>(&payload)
                .map_err(|_| format!("scraper: eval returned invalid JSON: {first_err}"))?;
            serde_json::from_str::<T>(&inner)
                .map_err(|err| format!("scraper: eval returned invalid nested JSON: {err}"))
        }
    }
}

#[cfg(desktop)]
fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

#[cfg(desktop)]
fn scraper_is_at_origin(scraper: &Webview<tauri::Wry>, target: &Url) -> bool {
    scraper
        .url()
        .map(|current| same_origin(&current, target))
        .unwrap_or(false)
}

#[cfg(desktop)]
async fn document_is_ready(scraper: &Webview<tauri::Wry>) -> bool {
    let ready = eval_json::<String>(
        scraper,
        r#"(function () { return document.readyState || "loading"; })()"#
            .to_string(),
    )
    .await;
    matches!(ready.as_deref(), Ok("interactive" | "complete"))
}

#[cfg(desktop)]
async fn prepare_fetch_context(
    scraper: &Webview<tauri::Wry>,
    context_url: Option<&str>,
) -> Result<(), String> {
    let Some(context_url) = context_url else {
        return Ok(());
    };
    let target: Url = context_url
        .parse()
        .map_err(|err| format!("scraper: invalid context url '{context_url}': {err}"))?;

    if scraper_is_at_origin(scraper, &target) && document_is_ready(scraper).await {
        return Ok(());
    }

    scraper
        .navigate(target.clone())
        .map_err(|err| format!("scraper: navigate fetch context: {err}"))?;

    let deadline = Duration::from_secs(15);
    let poll_interval = Duration::from_millis(150);
    let started = Instant::now();

    while started.elapsed() < deadline {
        tokio::time::sleep(poll_interval).await;
        if scraper_is_at_origin(scraper, &target) && document_is_ready(scraper).await {
            return Ok(());
        }
    }

    Err(format!(
        "scraper: timed out preparing fetch context {context_url}"
    ))
}

#[cfg(desktop)]
fn build_webview_fetch_start_script(
    request_id: &str,
    url: &str,
    init: &FetchInit,
) -> Result<String, String> {
    let request_json = serde_json::to_string(&serde_json::json!({
        "url": url,
        "init": init,
    }))
    .map_err(|err| format!("scraper: serialize fetch request: {err}"))?;
    let request_id_json = serde_json::to_string(request_id)
        .map_err(|err| format!("scraper: serialize fetch request id: {err}"))?;

    Ok(format!(
        r#"(function () {{
  const request = {request_json};
  const requestId = {request_id_json};
  const blockedHeaders = new Set([
    "accept-charset", "accept-encoding", "access-control-request-headers",
    "access-control-request-method", "connection", "content-length", "cookie",
    "cookie2", "date", "dnt", "expect", "host", "keep-alive", "origin",
    "referer", "te", "trailer", "transfer-encoding", "upgrade", "via",
    "user-agent"
  ]);
  const init = request.init || {{}};
  const headers = new Headers();
  for (const key of Object.keys(init.headers || {{}})) {{
    if (!blockedHeaders.has(key.toLowerCase())) {{
      headers.set(key, String(init.headers[key]));
    }}
  }}
  window.__lnrFetchResults = window.__lnrFetchResults || {{}};
  window.__lnrFetchResults[requestId] = {{ done: false }};
  (async function () {{
    try {{
      const fetchInit = {{
        method: init.method || "GET",
        headers,
        credentials: "include",
        redirect: "follow"
      }};
      if (init.body !== undefined && init.body !== null) {{
        fetchInit.body = init.body;
      }}
      const response = await fetch(request.url, fetchInit);
      const responseHeaders = {{}};
      response.headers.forEach(function (value, key) {{
        responseHeaders[key] = value;
      }});
      const body = await response.text();
      window.__lnrFetchResults[requestId] = {{
        done: true,
        ok: true,
        status: response.status,
        statusText: response.statusText || "",
        body,
        headers: responseHeaders,
        finalUrl: response.url || request.url
      }};
    }} catch (error) {{
      window.__lnrFetchResults[requestId] = {{
        done: true,
        ok: false,
        error: (error && (error.message || error.toString())) || String(error)
      }};
    }}
  }})();
}})();"#
    ))
}

#[cfg(desktop)]
fn build_webview_fetch_poll_script(request_id: &str) -> Result<String, String> {
    let request_id_json = serde_json::to_string(request_id)
        .map_err(|err| format!("scraper: serialize fetch request id: {err}"))?;
    Ok(format!(
        r#"(function () {{
  const requestId = {request_id_json};
  const store = window.__lnrFetchResults || {{}};
  const result = store[requestId];
  if (!result || !result.done) return null;
  delete store[requestId];
  return result;
}})()"#
    ))
}

#[cfg(desktop)]
fn build_webview_fetch_cleanup_script(request_id: &str) -> Result<String, String> {
    let request_id_json = serde_json::to_string(request_id)
        .map_err(|err| format!("scraper: serialize fetch request id: {err}"))?;
    Ok(format!(
        r#"(function () {{
  const requestId = {request_id_json};
  if (window.__lnrFetchResults) {{
    delete window.__lnrFetchResults[requestId];
  }}
}})();"#
    ))
}

/// Issue an HTTP request through the scraper WebView's own browser
/// `fetch()`, preserving Cloudflare/browser-network behavior.
#[cfg(desktop)]
#[tauri::command]
pub async fn webview_fetch(
    app: AppHandle,
    state: tauri::State<'_, ScraperState>,
    url: String,
    init: Option<FetchInit>,
    context_url: Option<String>,
) -> Result<FetchResult, String> {
    let _guard = state.nav_lock.lock().await;
    let scraper = scraper_handle(&app)?;
    let _: Url = url
        .parse()
        .map_err(|err| format!("scraper: invalid url '{url}': {err}"))?;
    prepare_fetch_context(&scraper, context_url.as_deref()).await?;
    let init = init.unwrap_or_default();
    let request_id = format!(
        "fetch-{}",
        FETCH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let start_script = build_webview_fetch_start_script(&request_id, &url, &init)?;
    scraper
        .eval(start_script)
        .map_err(|err| format!("scraper: start browser fetch: {err}"))?;

    let deadline = Duration::from_secs(60);
    let poll_interval = Duration::from_millis(150);
    let started = Instant::now();

    while started.elapsed() < deadline {
        tokio::time::sleep(poll_interval).await;
        let poll_script = build_webview_fetch_poll_script(&request_id)?;
        let result: Option<WebviewFetchScriptResult> =
            eval_json(&scraper, poll_script).await?;
        let Some(result) = result else {
            continue;
        };

        if !result.ok {
            let error = result
                .error
                .unwrap_or_else(|| "unknown browser fetch error".to_string());
            return Err(format!("scraper: browser fetch to {url} failed: {error}"));
        }

        return Ok(FetchResult {
            status: result
                .status
                .ok_or_else(|| "scraper: browser fetch missing status".to_string())?,
            status_text: result.status_text.unwrap_or_default(),
            body: result.body.unwrap_or_default(),
            headers: result.headers.unwrap_or_default(),
            final_url: result.final_url.unwrap_or(url),
        });
    }

    if let Ok(cleanup_script) = build_webview_fetch_cleanup_script(&request_id) {
        let _ = scraper.eval(cleanup_script);
    }

    Err(format!(
        "scraper: browser fetch to {url} timed out after {}ms",
        deadline.as_millis()
    ))
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn webview_fetch(
    _app: AppHandle,
    _state: tauri::State<'_, ScraperState>,
    _url: String,
    _init: Option<FetchInit>,
    _context_url: Option<String>,
) -> Result<FetchResult, String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}

/// RFC 3986 percent-encode every byte that is not in the unreserved
/// set. Used to embed an arbitrary script string inside a URL
/// fragment without breaking parsing.
#[cfg(desktop)]
fn percent_encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Inverse of `encodeURIComponent`. Strict on malformed escapes so the
/// caller can surface the failure rather than silently dropping data.
#[cfg(desktop)]
fn decode_uri_component(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(format!("invalid percent escape at offset {i}"));
            }
            let hi = (bytes[i + 1] as char)
                .to_digit(16)
                .ok_or_else(|| format!("non-hex char at offset {}", i + 1))?;
            let lo = (bytes[i + 2] as char)
                .to_digit(16)
                .ok_or_else(|| format!("non-hex char at offset {}", i + 2))?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|err| format!("invalid utf-8 in payload: {err}"))
}

/// Navigate the scraper WebView to `url`, run the optional
/// `before_script` before any page script via the
/// `SCRAPER_INIT_SCRIPT` bridge, and resolve with whatever the page
/// (or the injected script) emits via
/// `window.ReactNativeWebView.postMessage`.
///
/// Use this instead of `webview_fetch` for plugins that need a fully
/// rendered page (closed shadow roots, JS-decrypted bodies,
/// fingerprinted CDN handshake) - e.g. Booktoki, which decrypts
/// chapter HTML inside a closed shadow root that only a real Chromium
/// session can read.
///
/// Concurrency: serialized via `nav_lock` so chapter downloads do not
/// race the visible site browser overlay.
#[cfg(desktop)]
#[tauri::command]
pub async fn webview_extract(
    app: AppHandle,
    state: tauri::State<'_, ScraperState>,
    url: String,
    before_script: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let _guard = state.nav_lock.lock().await;
    let scraper = scraper_handle(&app)?;

    // Embed the before-content script in the URL fragment. The
    // browser does not send the fragment to the server, and the
    // initialization script picks it up before any page script runs.
    let target_url_str = match before_script.as_deref().filter(|s| !s.is_empty()) {
        Some(script) => {
            let encoded = percent_encode_uri_component(script);
            // The fragment is consumed by SCRAPER_INIT_SCRIPT before the
            // page sees it, so a `?cb=...#...` URL stays well-formed
            // because we prepend a fresh `#`. If the caller's URL
            // already had a fragment, that fragment is dropped.
            let base = url.split('#').next().unwrap_or(&url);
            format!("{base}#__lnr_script__={encoded}")
        }
        None => url.clone(),
    };

    let parsed: Url = target_url_str.parse().map_err(|err| {
        format!("webview_extract: invalid url '{target_url_str}': {err}")
    })?;

    eprintln!("[scraper] webview_extract navigate: {url}");

    scraper
        .navigate(parsed)
        .map_err(|err| format!("webview_extract: navigate: {err}"))?;

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let poll_interval = std::time::Duration::from_millis(150);
    let start = std::time::Instant::now();
    let result_marker = "#__lnr_result__=";

    while start.elapsed() < timeout {
        tokio::time::sleep(poll_interval).await;
        let current = match scraper.url() {
            Ok(u) => u.to_string(),
            Err(_) => continue,
        };
        if let Some(idx) = current.find(result_marker) {
            let encoded = &current[idx + result_marker.len()..];
            let decoded = decode_uri_component(encoded).map_err(|err| {
                format!("webview_extract: decode result: {err}")
            })?;
            // Park the scraper on a clean URL so the next call does
            // not see a stale `#__lnr_result__=...` if it polls
            // before the new navigation lands.
            let blank = "about:blank";
            if let Ok(blank_url) = blank.parse::<Url>() {
                let _ = scraper.navigate(blank_url);
            }
            return Ok(decoded);
        }
    }

    Err(format!(
        "webview_extract: timeout after {}ms",
        timeout.as_millis(),
    ))
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn webview_extract(
    _app: AppHandle,
    _state: tauri::State<'_, ScraperState>,
    _url: String,
    _before_script: Option<String>,
    _timeout_ms: Option<u64>,
) -> Result<String, String> {
    Err(SCRAPER_UNAVAILABLE.to_string())
}
