import { fetch } from "@tauri-apps/plugin-http";

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData;
  signal?: AbortSignal;
}

/**
 * Header set we always merge in for plugin-scraper fetches.
 *
 * The list mirrors upstream lnreader's `@libs/fetch.fetchApi`
 * defaults (see `docs/plugins/contract.md §6`). The User-Agent
 * is intentionally absent — each plugin's `imageRequestInit`
 * carries its own UA, and the host fills in a device default
 * for plugins that omit one.
 */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  Accept: "*/*",
  "Accept-Language": "*",
  "Accept-Encoding": "gzip, deflate",
  Connection: "keep-alive",
  "Cache-Control": "max-age=0",
  "Sec-Fetch-Mode": "cors",
};

/**
 * Plugin-scraper-facing HTTP fetch.
 *
 * Routes through `tauri-plugin-http` on the Rust side so the
 * cookie jar can be shared with the Cloudflare hidden-WebView
 * (Sprint 2 part 2). Returns a `Response`-like object; consumers
 * should check `.ok` / `.status`.
 */
export async function pluginFetch(
  url: string,
  init: HttpInit = {},
): Promise<Response> {
  const headers = { ...DEFAULT_HEADERS, ...init.headers };
  return fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: init.signal,
  });
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
