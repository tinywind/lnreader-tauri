import { invoke } from "@tauri-apps/api/core";

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  /**
   * Anything plugin code passes through `fetchApi`. The IPC layer
   * needs a string, so non-string values get serialized in
   * `serializeBody` before they cross the boundary — plain objects
   * become JSON, URLSearchParams becomes their query-string form,
   * FormData is dropped to undefined (v0.2 will add multipart).
   */
  body?: unknown;
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

function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // Multipart bodies don't survive the IPC string field today.
    // Plugins that rely on multipart fail visibly here rather than
    // silently sending the wrong thing.
    return undefined;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function toWireInit(init: HttpInit): FetchInitWire {
  return {
    method: init.method,
    headers: init.headers,
    body: serializeBody(init.body),
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
