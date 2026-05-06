import { invoke } from "@tauri-apps/api/core";
import { load } from "cheerio";
import dayjs from "dayjs";
import { Parser } from "htmlparser2";
import { androidWebviewExtract } from "../android-scraper";
import {
  createPluginFetch,
  createPluginFetchText,
  pluginFetch,
  pluginFetchText,
} from "../http";
import { isAndroidRuntime } from "../tauri-runtime";
import { NovelStatus } from "./types";

interface WebViewFetchOptions {
  beforeContentScript?: string;
  /** Reserved for v0.2; no host hook today. */
  afterContentScript?: string;
  /** Reserved for v0.2; the scraper webview's own UA is used. */
  userAgent?: string;
  timeoutMs?: number;
}

/**
 * Mirror of upstream `@libs/webView.webViewFetch`. Navigates the
 * scraper WebView to `url`, runs `beforeContentScript` before any
 * page script via the SCRAPER_INIT_SCRIPT bridge, and resolves with
 * whatever the page emits via `window.ReactNativeWebView.postMessage`.
 *
 * Used by plugins (e.g. Booktoki) whose chapter content is locked
 * behind closed shadow roots that only a real Chromium session can
 * read after the page's own JS finishes decrypting.
 */
async function webViewFetch(
  url: string,
  options: WebViewFetchOptions = {},
): Promise<string> {
  if (isAndroidRuntime()) {
    return androidWebviewExtract(
      url,
      options.beforeContentScript ?? null,
      options.timeoutMs ?? 30_000,
    );
  }

  return invoke<string>("webview_extract", {
    url,
    beforeScript: options.beforeContentScript ?? null,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
}

/**
 * Filter-input enum values upstream plugins expect from
 * `@libs/filterInputs`. Plugins use these as discriminators when
 * building their `filters` schema.
 */
export const FilterTypes = {
  TextInput: "Text",
  Picker: "Picker",
  CheckboxGroup: "Checkbox",
  Switch: "Switch",
  ExcludableCheckboxGroup: "XCheckbox",
} as const;

export const defaultCover =
  "https://placehold.co/200x300?text=No+Cover";

export function isUrlAbsolute(url: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(url);
}

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToUtf8(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

interface NamespacedStorage {
  set(key: string, value: string): void;
  get(key: string): string | null;
  delete(key: string): void;
  getAllKeys(): string[];
  clearAll(): void;
}

function makeNamespacedStorage(
  prefix: string,
  persistent: boolean,
): NamespacedStorage {
  // Defer `localStorage` / `sessionStorage` access until method
  // invocation so node-env tests can construct a resolver without
  // a DOM as long as they don't actually use storage.
  const getBacking = (): Storage =>
    persistent ? globalThis.localStorage : globalThis.sessionStorage;
  const key = (suffix: string): string => `${prefix}${suffix}`;

  return {
    set(suffix, value) {
      getBacking().setItem(key(suffix), value);
    },
    get(suffix) {
      return getBacking().getItem(key(suffix));
    },
    delete(suffix) {
      getBacking().removeItem(key(suffix));
    },
    getAllKeys() {
      const backing = getBacking();
      const keys: string[] = [];
      for (let i = 0; i < backing.length; i += 1) {
        const fullKey = backing.key(i);
        if (fullKey !== null && fullKey.startsWith(prefix)) {
          keys.push(fullKey.slice(prefix.length));
        }
      }
      return keys;
    },
    clearAll() {
      const backing = getBacking();
      const toRemove: string[] = [];
      for (let i = 0; i < backing.length; i += 1) {
        const fullKey = backing.key(i);
        if (fullKey !== null && fullKey.startsWith(prefix)) {
          toRemove.push(fullKey);
        }
      }
      for (const fullKey of toRemove) {
        backing.removeItem(fullKey);
      }
    },
  };
}

/**
 * Build the `_require` resolver for a sandboxed plugin instance.
 *
 * Mirrors the upstream lnreader whitelist from the plugin contract
 * reference. Modules outside the whitelist throw. Plugins that touch
 * `window`/`document` directly are unsupported.
 */
export function createShimResolver(
  pluginId: string,
  siteUrl?: string,
): (id: string) => unknown {
  const prefix = `plugin:${pluginId}:`;
  const storage = makeNamespacedStorage(prefix, true);
  const sessionStg = makeNamespacedStorage(prefix, false);
  const fetchApi = siteUrl ? createPluginFetch(siteUrl) : pluginFetch;
  const fetchText = siteUrl
    ? createPluginFetchText(siteUrl)
    : pluginFetchText;

  return (id) => {
    switch (id) {
      case "htmlparser2":
        return { Parser };
      case "cheerio":
        return { load };
      case "dayjs":
        return dayjs;
      case "urlencode":
        return { encode: encodeURIComponent, decode: decodeURIComponent };
      case "@libs/fetch":
        return {
          fetchApi,
          fetchText,
          fetchProto: () =>
            Promise.reject(
              new Error(
                "fetchProto is not yet implemented (planned in a later Sprint 2 iteration).",
              ),
            ),
        };
      case "@libs/novelStatus":
        return { NovelStatus };
      case "@libs/filterInputs":
        return { FilterTypes };
      case "@libs/defaultCover":
        return { defaultCover };
      case "@libs/isAbsoluteUrl":
        return { isUrlAbsolute };
      case "@libs/utils":
        return { utf8ToBytes, bytesToUtf8 };
      case "@libs/storage":
        return {
          storage,
          localStorage: storage,
          sessionStorage: sessionStg,
        };
      case "@libs/webView":
        return { webViewFetch };
      // TODO Sprint 2 part 3c: @libs/cookies, @libs/aes
      default:
        throw new Error(
          `Module '${id}' is not whitelisted in the plugin sandbox.`,
        );
    }
  };
}
