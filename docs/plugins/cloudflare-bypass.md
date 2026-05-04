# Cloudflare Bypass Pipeline

> Tier 1.5. The exact behavior that the new Tauri-based hidden-WebView
> controller must reproduce. Sourced from upstream
> `src/components/HiddenWebViewHost/HiddenWebViewHost.tsx`,
> `src/plugins/helpers/fetch.ts`,
> `src/plugins/helpers/webViewFetch.ts`,
> `src/components/BackgroundAlertHost/BackgroundAlertHost.tsx`,
> and `src/services/ServiceManager.ts` (CF-blocked download abort path)
> at commit `639a2538`.

This document is the spec for the load-bearing PoC of `prd.md` Sprint 2.
The whole rewrite assumes this can work; if it can't, escalate before
continuing.

## 1. When the bypass kicks in

The pipeline has three trigger paths:

### 1.1 `fetchApi()` retry on suspicious HTML

`src/plugins/helpers/fetch.ts:103-135`. After a normal `fetch(url, init)`, the host examines the response:

- Status must be `403` or `503`.
- Content-Type must match `text/html` (case-insensitive).
- Body (read once via `response.clone().text()`) must match the
  regex `Just a moment\.\.\.|cf_chl_opt|challenge-platform|cf-mitigated`.

When **all three** are true, the host runs the WebView-driven retry
(`webFetch`). When any condition fails the original response is
returned unchanged.

### 1.2 Explicit plugin call to `webViewFetch`

`src/plugins/helpers/webViewFetch.ts`. A plugin that knows it needs the
hidden WebView (e.g. for sites that always use a JS-rendered shell,
not just Cloudflare) can call:

```ts
import { webViewFetch } from '@libs/webView';
const html = await webViewFetch(url, {
  beforeContentScript: '/* JS to inject before page content loads */',
  afterContentScript:  '/* JS to inject after page content loads */',
  userAgent:           'optional UA override',
  timeoutMs:           30000, // default
});
```

The promise resolves with the string passed to
`window.ReactNativeWebView.postMessage(...)` from inside the WebView.

### 1.3 Background-download CF detection

`src/services/ServiceManager.ts` (path `a460c3fe`) — when a chapter
download fails because the source is CF-protected, the manager **aborts
all queued downloads** and emits a snackbar via the
`'lnreader-cf-blocked'` `DeviceEventEmitter` channel. The
`BackgroundAlertHost.tsx` Snackbar listens and shows the message
`"<original error> (N pending downloads cancelled)"`. The new app
needs the same protection: never let a CF-protected source consume the
entire download queue retrying.

## 2. Lifecycle of a hidden WebView fetch

`HiddenWebViewHost.tsx` lives at the top level of the React tree
(`App.tsx:57`) and listens to `DeviceEventEmitter` events:

| Event | Payload | Effect |
|---|---|---|
| `lnreader-webview-fetch-request` | `{ id, url, beforeContentScript?, afterContentScript?, userAgent? }` | Set `pending` state to this request, mounting the WebView |
| `lnreader-webview-fetch-cancel` | `{ id }` | Clear `pending` if it matches; unmounts the WebView |
| `lnreader-webview-fetch-result-${id}` | `{ result?: string; error?: string }` | Resolves the promise on the JS side |

Internally:

1. JS side allocates a monotonically-increasing `id`, sets a `setTimeout(reject, timeoutMs)`, and emits `REQUEST` with the request object.
2. Host renders `null` when no request is pending (saves resources). Otherwise renders `<WebView />` once with `key={id}` so each request gets a fresh WebView.
3. WebView config (must be reproduced):
   - `source={{ uri: url }}`
   - `userAgent` from request, fallback to the device UA.
   - `sharedCookiesEnabled` and `thirdPartyCookiesEnabled` both `true` — cookies must flow back into the shared cookie jar so subsequent `fetchApi` requests benefit.
   - `javaScriptEnabled`, `domStorageEnabled` both `true`.
   - `cacheEnabled={false}` and `cacheMode="LOAD_NO_CACHE"` — Cloudflare's challenge depends on fresh evaluation.
   - `incognito={false}` — incognito breaks cookie sharing.
   - `injectedJavaScriptBeforeContentLoaded` = `beforeContentScript ?? ''`.
   - `injectedJavaScript` = `afterContentScript ?? ''`.
   - `originWhitelist={['*']}` — required, the challenge can navigate to subdomains.
4. The WebView fires `onMessage`, `onError`, or `onHttpError`. Each fires the result event for the request id and clears `pending`.
5. Layout: the WebView is positioned `absolute, top:-10000, left:-10000, width:1024, height:1024`, with `overflow:hidden`. **Do not use `display:none` or 1×1 size.** Chrome on Android throttles JS in zero-area or non-visible WebViews, breaking the challenge's timer-driven JS. The layout comment in upstream says this verbatim.

## 3. The default body script (CF challenge specifically)

For `webFetch` (the auto-retry path inside `fetchApi`), upstream
`fetch.ts` does **not** inject custom scripts — it relies on the
ambient WebView accepting the Cloudflare challenge JS, persisting the
`cf_clearance` cookie, and finishing the page navigation. The host
reads the resulting HTML from disk via `NativeFile.downloadFile` to a
temp file in `ExternalCachesDirectoryPath` and returns it as a
`Response(text, {status:200})`.

Note: this auto-retry uses `NativeFile.downloadFile`, which does
**not** execute JS — it is a Rust/Java HTTP client with cookie sharing
(via `CookieManager`). The expectation is that prior navigations (any
plugin browse before the failing call) have already populated the
`cf_clearance` cookie via the visible WebView path. The auto-retry is
the cheap second attempt that succeeds when the user has already
visited the source's WebView page recently.

If the auto-retry fails too, the user sees the snackbar from §1.3.

## 4. Mapping to Tauri 2

The new Tauri implementation lives in `/src-tauri/src/cf_webview.rs`
plus a thin JS shim at `/src/lib/webview-fetch.ts`. Sketch:

### 4.1 Rust controller

```rust
// pseudocode
use tauri::{WebviewWindowBuilder, WebviewUrl};

#[tauri::command]
async fn webview_fetch(
    app: tauri::AppHandle,
    url: String,
    user_agent: Option<String>,
    before_content_script: Option<String>,
    after_content_script: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let id = next_id();
    let label = format!("hidden-fetch-{id}");

    // Sized 1024x1024, positioned far off-screen, decorations off.
    // Same anti-throttle reasoning as upstream.
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().map_err(|e| e.to_string())?))
        .visible(false)
        .focused(false)
        .always_on_top(false)
        .decorations(false)
        .inner_size(1024.0, 1024.0)
        .position(-10000.0, -10000.0)
        .user_agent(user_agent.as_deref().unwrap_or(DEFAULT_UA))
        .initialization_script(before_content_script.as_deref().unwrap_or(""))
        .build()
        .map_err(|e| e.to_string())?;

    // Inject after-content script after page load.
    // (Use a navigation handler / page-load event hook — Tauri 2's
    //  WebviewWindow exposes on_page_load via the app handle.)
    if let Some(script) = after_content_script {
        window.eval(&script).ok();
    }

    // Wait for either:
    //   - window.__tauriCFResult (set by the page or injected script), or
    //   - cf_clearance cookie populated for this URL
    // ...with `timeout_ms` (default 30000).
    let result = wait_for_result_or_clearance(&window, &url, timeout_ms.unwrap_or(30000)).await?;

    // Pull cookies and merge into the HTTP cookie jar shared by tauri-plugin-http.
    let cookies = window.cookies_for_url(&url.parse().unwrap()).map_err(|e| e.to_string())?;
    sync_cookies_into_http_plugin(&app, &url, &cookies)?;

    // Close the window.
    window.close().ok();

    Ok(result)
}
```

### 4.2 JS shim

```ts
// src/lib/webview-fetch.ts
import { invoke } from '@tauri-apps/api/core';

export async function webViewFetch(url: string, opts?: {
  beforeContentScript?: string;
  afterContentScript?: string;
  userAgent?: string;
  timeoutMs?: number;
}): Promise<string> {
  return invoke<string>('webview_fetch', { url, ...opts });
}
```

The plugin sandbox's `@libs/webView.webViewFetch` resolves to this
function. Plugin code stays unchanged.

### 4.3 Cookie sync rule

`tauri-plugin-http` and the WebView store cookies separately
(`prd.md §6.1`). Whenever the hidden WebView completes:

1. Read `Webview::cookies_for_url(url)` — these are the
   challenge-cleared cookies the WebView produced.
2. For every cookie, push it into the `tauri-plugin-http` cookie jar
   (`reqwest_cookie_store::CookieStore::insert_raw`).
3. Subsequent `fetchApi` calls then use the cleared cookies via
   `tauri-plugin-http`'s built-in cookie jar without needing to invoke
   the WebView again.

## 5. Cancellation

`webViewFetch` callers must be cancellable from JS. Upstream uses the
`lnreader-webview-fetch-cancel` event with the request id and lets
`HiddenWebViewHost` drop the pending state, which unmounts the
WebView. The Tauri implementation should expose:

```ts
import { webViewFetchCancel } from '@/lib/webview-fetch';
const reqId = ...;
webViewFetchCancel(reqId); // closes the underlying WebviewWindow
```

This maps to a second Rust command that looks up the label
`hidden-fetch-<id>` and closes it.

## 6. Concurrency

Upstream serializes hidden-WebView fetches: `HiddenWebViewHost` only
holds one `pending` at a time, and earlier requests are silently
dropped if a new one arrives (the result event for the dropped id
never fires; its 30s timeout will reject). The new implementation
should preserve this — Cloudflare's challenge JS does not interact
well with parallel WebViews using the same cookie store.

A queue lives outside this module. If the runtime has multiple plugin
calls demanding the WebView, they should be queued by the caller (the
plugin runtime), not by the WebView host.

## 7. User-visible UX

`BackgroundAlertHost.tsx` shows a Snackbar via `react-native-paper`'s
`Portal` system when the `'lnreader-cf-blocked'` event fires. Message
shape: `<error message>` plus, if `cancelledCount > 0`,
`(N pending downloads cancelled)` (English; localized via the
`backupScreen.*` keys for other languages).

In the new app, the Snackbar lives at the layout root — a Mantine
`Notifications` instance is the natural fit.

## 8. Performance budget

- Hidden-WebView fetch should complete within 5–10 seconds on the
  first call to a CF-protected source. Subsequent calls within the
  cookie's TTL should fall through to plain HTTP via the synced cookie
  jar (no WebView spawn).
- The 30-second timeout (default) is the upper bound; if exceeded the
  caller treats it as a hard failure.
- WebView creation and destruction is cheap relative to the
  challenge-solve time, so no pooling is needed.

## 9. Testing

A reference test list:

1. **Plain HTML site** — `webViewFetch` returns the page body as
   a string within 5s.
2. **Cloudflare challenge site** — first call solves the challenge
   (5–10s), second call returns the body via `fetchApi` without
   spawning a WebView (cookie jar hit).
3. **Timeout** — `webViewFetch(slowUrl, { timeoutMs: 1000 })` rejects
   after 1s.
4. **Cancellation** — `webViewFetchCancel(id)` causes the in-flight
   `webViewFetch(id)` promise to reject and the underlying window to
   close.
5. **Snackbar** — emit `'lnreader-cf-blocked'` programmatically; the
   Snackbar shows for ~8s with the right message.

## 10. Known limits

- iOS WebKit cookie store is **separate** from the system cookie store
  available to URLSession / reqwest. Upstream's
  `react-native-cookie-manager` `useWebKit` flag selects which to
  read/write. Tauri 2 on iOS uses WKWebView, so the same caveat
  applies. Verify cookie sync direction in Sprint 2.
- Some Cloudflare deployments use Turnstile (interactive). The hidden
  WebView cannot solve those without user interaction. For those
  sources, surface the visible WebView as a fallback (the upstream
  WebviewScreen route) — the user manually completes the challenge,
  cookies persist, then `fetchApi` succeeds on the next call.

## 11. References

- HiddenWebViewHost: <https://github.com/lnreader/lnreader/blob/639a2538/src/components/HiddenWebViewHost/HiddenWebViewHost.tsx>
- BackgroundAlertHost: <https://github.com/lnreader/lnreader/blob/639a2538/src/components/BackgroundAlertHost/BackgroundAlertHost.tsx>
- fetch helpers: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/fetch.ts>
- WebView fetch: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/webViewFetch.ts>
- ServiceManager CF abort: <https://github.com/lnreader/lnreader/commit/a460c3fe>
- HiddenWebView throttle fix: <https://github.com/lnreader/lnreader/commit/8b77aadd>
- Tauri Webview cookies API: <https://github.com/tauri-apps/tauri/commit/cedb24d494b84111daa3206c05196c8b89f1e994>
