import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { androidWebviewFetch } from "./android-scraper";
import { isAndroidRuntime } from "./tauri-runtime";
import { getSourceRequestTimeoutMs } from "../store/browse";
import { getScraperUserAgent } from "../store/user-agent";
import {
  activeScraperExecutor,
  type ScraperExecutorId,
} from "./tasks/scraper-queue";

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  /**
   * Anything plugin code passes through `fetchApi`. The IPC layer
   * needs a string, so non-string values get serialized in
   * `serializeBody` before they cross the boundary. Plain objects
   * become JSON, URLSearchParams becomes their query-string form,
   * and FormData is dropped to undefined until multipart support
   * lands.
   */
  body?: unknown;
  /** Plugin-owned site origin to prepare in the scraper WebView. */
  contextUrl?: string;
  /** Source id used to infer an executor when no explicit scraper executor is bound. */
  sourceId?: string;
  /** Executor-owned WebView that must execute plugin-owned site traffic. */
  scraperExecutor?: ScraperExecutorId;
  /** Per-request timeout for plugin-owned site traffic. */
  timeoutMs?: number;
  /** Accepted for API compatibility; the WebView fetch IPC ignores it today. */
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
  body?: string;
  bodyBase64?: string;
  headers: Record<string, string>;
  finalUrl: string;
}

function headerUserAgent(
  headers: Record<string, string> | undefined,
): string | null {
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "user-agent") {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }
  }
  return null;
}

function scraperUserAgent(
  headers: Record<string, string> | undefined,
): string | null {
  return headerUserAgent(headers) ?? getScraperUserAgent();
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
    headers: init.headers ? { ...init.headers } : undefined,
    body: serializeBody(init.body),
  };
}

function requestTimeoutMs(timeoutMs: number | undefined): number {
  const numeric =
    typeof timeoutMs === "number" ? timeoutMs : getSourceRequestTimeoutMs();
  if (!Number.isFinite(numeric)) return getSourceRequestTimeoutMs();
  return Math.max(1, Math.round(numeric));
}

function decodeBase64Body(bodyBase64: string): Uint8Array {
  const binary = atob(bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bodyFromWire(result: FetchResultWire): BodyInit {
  if (result.bodyBase64 !== undefined) {
    return decodeBase64Body(result.bodyBase64);
  }
  return result.body ?? "";
}

export async function appFetch(
  url: string,
  init: HttpInit = {},
): Promise<Response> {
  return tauriFetch(url, {
    method: init.method,
    headers: init.headers,
    body: serializeBody(init.body),
  });
}

export async function appFetchText(
  url: string,
  init: HttpInit = {},
): Promise<string> {
  const response = await appFetch(url, init);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} on ${url}`,
    );
  }
  return response.text();
}

/**
 * Plugin-scraper-facing HTTP fetch.
 *
 * Every request is routed through the persistent in-app WebView
 * (see `src-tauri/src/scraper.rs`). That gives us a real browser's
 * TLS fingerprint, Sec-Fetch-* headers, User-Agent and cookie jar.
 * Cloudflare, JA3-fingerprinting CDNs and login-walled sites accept
 * it the same way they accept any browser tab. There is no host-side
 * cookie store: the WebView owns the jar.
 *
 * The response is reconstituted into a standard `Response` object so
 * callers keep the familiar fetch-style API. `Response.url` is patched
 * on so plugins that follow redirects can still see the final URL.
 */
export async function pluginFetch(
  url: string,
  init: HttpInit = {},
): Promise<Response> {
  const wireInit = toWireInit(init);
  const contextUrl = init.contextUrl ?? null;
  const userAgent = scraperUserAgent(wireInit.headers);
  const scraperExecutor =
    init.scraperExecutor ?? activeScraperExecutor(init.sourceId);
  const timeoutMs = requestTimeoutMs(init.timeoutMs);
  const result = isAndroidRuntime()
    ? await androidWebviewFetch(
        url,
        wireInit,
        contextUrl,
        userAgent,
        scraperExecutor,
        timeoutMs,
      )
    : await invoke<FetchResultWire>("webview_fetch", {
        url,
        init: wireInit,
        contextUrl,
        userAgent,
        queue: scraperExecutor,
        timeoutMs,
      });
  const response = new Response(bodyFromWire(result), {
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

export function createPluginFetch(
  contextUrl: string,
  sourceId?: string,
  scraperExecutor?: ScraperExecutorId,
): (url: string, init?: HttpInit) => Promise<Response> {
  return (url, init = {}) =>
    pluginFetch(url, {
      ...init,
      contextUrl: init.contextUrl ?? contextUrl,
      sourceId: init.sourceId ?? sourceId,
      scraperExecutor: init.scraperExecutor ?? scraperExecutor,
    });
}

export function createPluginFetchText(
  contextUrl: string,
  sourceId?: string,
  scraperExecutor?: ScraperExecutorId,
): (url: string, init?: HttpInit) => Promise<string> {
  return (url, init = {}) =>
    pluginFetchText(url, {
      ...init,
      contextUrl: init.contextUrl ?? contextUrl,
      sourceId: init.sourceId ?? sourceId,
      scraperExecutor: init.scraperExecutor ?? scraperExecutor,
    });
}

function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  if (Array.isArray(headers)) {
    const obj: Record<string, string> = {};
    for (const [key, value] of headers) {
      obj[key] = value;
    }
    return obj;
  }
  return headers as Record<string, string>;
}

/**
 * Adapter from the native `fetch(input, init)` signature to
 * `pluginFetch`. Sandboxed plugin code that uses raw `fetch()`
 * during search/listing, novel metadata parsing, update checks, or
 * chapter downloads gets routed through the scraper-WebView-backed
 * IPC the same way explicit `fetchApi` callers are.
 */
export function pluginFetchShim(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return createPluginFetchShim()(input, init);
}

export function createPluginFetchShim(
  contextUrl?: string,
  sourceId?: string,
  scraperExecutor?: ScraperExecutorId,
): (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response> {
  return (input, init) => {
    const pluginInit = init as
      | (RequestInit & {
          contextUrl?: string;
          scraperExecutor?: ScraperExecutorId;
          sourceId?: string;
          timeoutMs?: number;
        })
      | undefined;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return pluginFetch(url, {
      method: pluginInit?.method,
      headers: normalizeHeaders(pluginInit?.headers),
      body: pluginInit?.body,
      contextUrl: pluginInit?.contextUrl ?? contextUrl,
      sourceId: pluginInit?.sourceId ?? sourceId,
      scraperExecutor: pluginInit?.scraperExecutor ?? scraperExecutor,
      timeoutMs: pluginInit?.timeoutMs,
      signal: pluginInit?.signal ?? undefined,
    });
  };
}
