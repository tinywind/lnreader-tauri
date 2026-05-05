use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::time::sleep;

#[derive(Debug, Serialize)]
pub struct CfCookie {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CfSolveResult {
    pub final_url: String,
    pub cookies: Vec<CfCookie>,
}

const POLL_INTERVAL_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 30_000;
const CF_CLEARANCE_COOKIE: &str = "cf_clearance";

/// Open a hidden WebviewWindow at `url`, wait for the Cloudflare
/// challenge to set the `cf_clearance` cookie, and return the
/// cookies the host should adopt before re-issuing the request via
/// `tauri-plugin-http` / `reqwest`.
///
/// Times out after 30 seconds. The hidden window is always closed
/// before the function returns, success or failure.
#[tauri::command]
pub async fn cf_solve(app: AppHandle, url: String) -> Result<CfSolveResult, String> {
    let target_url: Url = url
        .parse()
        .map_err(|err| format!("cf_solve: invalid url '{url}': {err}"))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let label = format!("cf_solver_{timestamp}");

    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(target_url.clone()),
    )
    .visible(false)
    .inner_size(900.0, 700.0)
    .build()
    .map_err(|err| format!("cf_solve: failed to build hidden webview: {err}"))?;

    let mut elapsed_ms: u64 = 0;
    let mut cleared = false;

    while elapsed_ms < MAX_TIMEOUT_MS {
        sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
        elapsed_ms += POLL_INTERVAL_MS;

        let cookies = window
            .cookies_for_url(target_url.clone())
            .unwrap_or_default();

        if cookies
            .iter()
            .any(|cookie| cookie.name() == CF_CLEARANCE_COOKIE)
        {
            cleared = true;
            break;
        }
    }

    let final_url = window
        .url()
        .map(|parsed| parsed.to_string())
        .unwrap_or_else(|_| target_url.to_string());

    let cookies = window
        .cookies_for_url(target_url.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|cookie| CfCookie {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain: cookie.domain().map(String::from),
            path: cookie.path().map(String::from),
        })
        .collect();

    let _ = window.close();

    if !cleared {
        return Err(format!(
            "cf_solve: timed out after {MAX_TIMEOUT_MS} ms (cf_clearance not set for {url})"
        ));
    }

    Ok(CfSolveResult {
        final_url,
        cookies,
    })
}
