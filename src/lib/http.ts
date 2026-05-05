import { fetch } from "@tauri-apps/plugin-http";
import { isCloudflareChallenge, solveCloudflare } from "./cf_webview";

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

function buildRequestInit(init: HttpInit, extraHeaders?: Record<string, string>) {
  return {
    method: init.method ?? "GET",
    headers: { ...DEFAULT_HEADERS, ...init.headers, ...extraHeaders },
    body: init.body,
    signal: init.signal,
  };
}

function shouldProbeCloudflare(response: Response): boolean {
  if (response.status !== 403 && response.status !== 503) return false;
  const ct = response.headers.get("content-type") ?? "";
  return ct.includes("text/html");
}

function cookieHeaderFromList(
  cookies: ReadonlyArray<{ name: string; value: string }>,
): string {
  return cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/**
 * Plugin-scraper-facing HTTP fetch.
 *
 * Routes through `tauri-plugin-http` on the Rust side so the
 * cookie jar can be shared with the Cloudflare hidden-WebView.
 * On a 403/503 + text/html response with a Cloudflare challenge
 * marker, hands off to `solveCloudflare(url)` to clear the
 * challenge and retries once with the returned cookies attached
 * via the `Cookie` header. Returns a `Response`-like object;
 * consumers should check `.ok` / `.status`.
 */
export async function pluginFetch(
  url: string,
  init: HttpInit = {},
): Promise<Response> {
  const response = await fetch(url, buildRequestInit(init));

  if (shouldProbeCloudflare(response)) {
    const body = await response.clone().text();
    if (isCloudflareChallenge(body)) {
      const result = await solveCloudflare(url);
      const cookie = cookieHeaderFromList(result.cookies);
      return fetch(url, buildRequestInit(init, cookie ? { Cookie: cookie } : undefined));
    }
  }

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
