import { load } from "cheerio";
import dayjs from "dayjs";
import { Parser } from "htmlparser2";
import { pluginFetch, pluginFetchText } from "../http";
import { NovelStatus } from "./types";

/**
 * Filter-input enum values upstream plugins expect from
 * `@libs/filterInputs`. Plugins use these as discriminators when
 * building their `filters` schema (per `docs/plugins/contract.md §3`).
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
 * Mirrors the upstream lnreader whitelist from
 * `docs/plugins/contract.md §5`. Modules outside the whitelist
 * throw — plugins that touch `window`/`document` directly are
 * unsupported (and would still partially work today since the
 * sandbox runs on the main thread; that gets fixed when we
 * relocate to a Web Worker in a later Sprint 2 iteration).
 */
export function createShimResolver(
  pluginId: string,
): (id: string) => unknown {
  const prefix = `plugin:${pluginId}:`;
  const storage = makeNamespacedStorage(prefix, true);
  const sessionStg = makeNamespacedStorage(prefix, false);

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
          fetchApi: pluginFetch,
          fetchText: pluginFetchText,
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
      // TODO Sprint 2 part 3c: @libs/cookies, @libs/webView, @libs/aes
      default:
        throw new Error(
          `Module '${id}' is not whitelisted in the plugin sandbox.`,
        );
    }
  };
}
