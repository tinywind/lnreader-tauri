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
import { getScraperUserAgent } from "../../store/user-agent";
import {
  createPluginInputsApi,
  deletePluginInputValue,
  getPluginInputPrefix,
  getPluginInputValue,
  setPluginInputValue,
} from "./inputs";
import { NovelStatus } from "./types";

interface WebViewFetchOptions {
  beforeContentScript?: string;
  /** Accepted for upstream compatibility; no host hook today. */
  afterContentScript?: string;
  /** Overrides the scraper WebView User-Agent for this request. */
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
  const userAgent = options.userAgent?.trim() || getScraperUserAgent();
  if (isAndroidRuntime()) {
    return androidWebviewExtract(
      url,
      options.beforeContentScript ?? null,
      options.timeoutMs ?? 30_000,
      userAgent,
    );
  }

  return invoke<string>("webview_extract", {
    url,
    beforeScript: options.beforeContentScript ?? null,
    timeoutMs: options.timeoutMs ?? 30_000,
    userAgent,
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

type PluginByteInput = ArrayBuffer | Uint8Array | number[];

export interface PluginZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isFile: boolean;
}

interface PluginZipEntryInfoWire {
  name: string;
  compressed_size: number;
  uncompressed_size: number;
  is_file: boolean;
}

export interface PluginZipReadOptions {
  path?: string;
  extension?: string;
  encoding?: string;
  maxBytes?: number;
}

export interface CsvParseOptions {
  header?: boolean;
  delimiter?: string;
}

function byteInputToArray(input: PluginByteInput): number[] {
  if (Array.isArray(input)) return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return Array.from(bytes);
}

function toZipEntryInfo(entry: PluginZipEntryInfoWire): PluginZipEntryInfo {
  return {
    name: entry.name,
    compressedSize: entry.compressed_size,
    uncompressedSize: entry.uncompressed_size,
    isFile: entry.is_file,
  };
}

export async function listZipEntries(
  input: PluginByteInput,
): Promise<PluginZipEntryInfo[]> {
  const entries = await invoke<PluginZipEntryInfoWire[]>("plugin_zip_list", {
    bytes: byteInputToArray(input),
  });
  return entries.map(toZipEntryInfo);
}

export async function readZipFile(
  input: PluginByteInput,
  options: PluginZipReadOptions = {},
): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("plugin_zip_read_file", {
    bytes: byteInputToArray(input),
    options: {
      path: options.path,
      extension: options.extension,
      max_bytes: options.maxBytes,
    },
  });
  return new Uint8Array(bytes);
}

export async function readZipText(
  input: PluginByteInput,
  options: PluginZipReadOptions = {},
): Promise<string> {
  const bytes = await readZipFile(input, options);
  return new TextDecoder(options.encoding ?? "utf-8").decode(bytes);
}

export function parseCsv(
  text: string,
  options: CsvParseOptions = {},
): string[][] | Record<string, string>[] {
  const delimiter = options.delimiter ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!options.header) return rows;

  const headers = rows.shift() ?? [];
  return rows.map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

interface NamespacedStorage {
  set(key: string, value: string): void;
  get(key: string): string | null;
  delete(key: string): void;
  getAllKeys(): string[];
  clearAll(): void;
}

export {
  deletePluginInputValue as deletePluginStorageValue,
  getPluginInputValue as getPluginStorageValue,
  setPluginInputValue as setPluginStorageValue,
};

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
  const prefix = getPluginInputPrefix(pluginId);
  const storage = makeNamespacedStorage(prefix, true);
  const sessionStg = makeNamespacedStorage(prefix, false);
  const pluginInputs = createPluginInputsApi(pluginId);
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
                "fetchProto is not implemented in this runtime.",
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
      case "@libs/archive":
        return { listZipEntries, readZipFile, readZipText };
      case "@libs/csv":
        return { parseCsv };
      case "@libs/storage":
        return {
          storage,
          localStorage: storage,
          sessionStorage: sessionStg,
        };
      case "@libs/pluginInputs":
        return {
          inputs: pluginInputs,
          pluginInputs,
        };
      case "@libs/webView":
        return { webViewFetch };
      default:
        throw new Error(
          `Module '${id}' is not whitelisted in the plugin sandbox.`,
        );
    }
  };
}
