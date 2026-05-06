import { isAndroidRuntime } from "./tauri-runtime";

interface AndroidScraperBridge {
  fetch(payload: string): void;
  extract(payload: string): void;
  hide(): void;
  navigate(payload: string): void;
  setBounds(payload: string): void;
}

interface AndroidFetchInitWire {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface AndroidFetchResultWire {
  status: number;
  statusText: string;
  body?: string;
  bodyBase64?: string;
  headers: Record<string, string>;
  finalUrl: string;
}

interface NativeEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

declare global {
  interface Window {
    __LNReaderAndroidScraper?: AndroidScraperBridge;
    __lnrAndroidScraperResolve?: (id: string, payload: string) => void;
  }
}

let nextRequestId = 1;

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeoutId: number;
  }
>();

function installResolver(): void {
  if (typeof window === "undefined" || window.__lnrAndroidScraperResolve) {
    return;
  }

  window.__lnrAndroidScraperResolve = (id, payload) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    window.clearTimeout(entry.timeoutId);

    let envelope: NativeEnvelope<unknown>;
    try {
      envelope = JSON.parse(payload) as NativeEnvelope<unknown>;
    } catch (error) {
      entry.reject(error);
      return;
    }

    if (envelope.ok) {
      entry.resolve(envelope.result);
    } else {
      entry.reject(new Error(envelope.error ?? "Android scraper failed"));
    }
  };
}

function bridge(): AndroidScraperBridge {
  if (!isAndroidRuntime() || typeof window === "undefined") {
    throw new Error("Android scraper bridge is only available on Android");
  }
  const nativeBridge = window.__LNReaderAndroidScraper;
  if (!nativeBridge) {
    throw new Error("Android scraper bridge is not available");
  }
  return nativeBridge;
}

function callNative<T>(
  method: "fetch" | "extract" | "navigate",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  installResolver();
  const id = `android-scraper-${nextRequestId}`;
  nextRequestId += 1;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Android scraper ${String(method)} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timeoutId,
    });

    try {
      bridge()[method](
        JSON.stringify({
          id,
          ...payload,
        }),
      );
    } catch (error) {
      pending.delete(id);
      window.clearTimeout(timeoutId);
      reject(error);
    }
  });
}

export function androidWebviewFetch(
  url: string,
  init: AndroidFetchInitWire,
  contextUrl: string | null,
): Promise<AndroidFetchResultWire> {
  return callNative<AndroidFetchResultWire>(
    "fetch",
    {
      url,
      init,
      contextUrl,
    },
    75_000,
  );
}

export function androidWebviewExtract(
  url: string,
  beforeScript: string | null,
  timeoutMs: number,
): Promise<string> {
  return callNative<string>(
    "extract",
    {
      url,
      beforeScript,
      timeoutMs,
    },
    timeoutMs + 5_000,
  );
}

export function androidScraperSetBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  const viewport = window.visualViewport;
  bridge().setBounds(
    JSON.stringify({
      ...bounds,
      viewportWidth: viewport?.width ?? window.innerWidth,
      viewportHeight: viewport?.height ?? window.innerHeight,
    }),
  );
}

export function androidScraperHide(): void {
  bridge().hide();
}

export function androidScraperNavigate(url: string): Promise<boolean> {
  return callNative<boolean>(
    "navigate",
    {
      url,
    },
    10_000,
  );
}
