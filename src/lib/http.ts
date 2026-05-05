import { invoke } from "@tauri-apps/api/core";

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  /** Only string bodies survive the IPC hop; FormData is v0.2. */
  body?: string;
  /** Reserved for v0.2; the WebView fetch IPC ignores it today. */
  signal?: AbortSignal;
}

interface FetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface FetchResultWire {
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  finalUrl: string;
}

function toWireInit(init: HttpInit): FetchInitWire {
  return {
    method: init.method,
    headers: init.headers,
    body: init.body,
  };
}

/**
 * Plugin-scraper-facing HTTP fetch.
 *
 * Every request is routed through the persistent in-app Webview
 * (see `src-tauri/src/scraper.rs`). That gives us a real browser's
 * TLS fingerprint, Sec-Fetch-* headers, User-Agent and cookie jar
 * — Cloudflare, JA3-fingerprinting CDNs and login-walled sites
 * accept it the same way they accept any browser tab. There is no
 * host-side cookie store: the Webview owns the jar.
 *
 * The response is reconstituted into a standard `Response` object
 * so callers (and sandboxed plugins via `@libs/fetch`) keep the
 * familiar fetch-style API. `Response.url` is patched on so plugins
 * that follow redirects can still see the final URL.
 */
export async function pluginFetch(
  url: string,
  init: HttpInit = {},
): Promise<Response> {
  const result = await invoke<FetchResultWire>("webview_fetch", {
    url,
    init: toWireInit(init),
  });
  const response = new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  Object.defineProperty(response, "url", {
    value: result.finalUrl,
    configurable: true,
  });
  return response;
}

/**
 * Convenience wrapper that resolves to the response body as text.
 * Throws on non-2xx so callers don't have to thread `.ok` checks
 * through every code path.
 */
export async function pluginFetchText(
  url: string,
  init: HttpInit = {},
): Promise<string> {
  const response = await pluginFetch(url, init);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} on ${url}`,
    );
  }
  return response.text();
}
