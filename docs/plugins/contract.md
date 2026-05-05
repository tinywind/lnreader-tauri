# Plugin Scraper Contract

> Tier 1.4. The exact JS module shape that source plugins must export.
> Reproduced verbatim so the **existing plugin ecosystem** at
> [lnreader/lnreader-plugins](https://github.com/lnreader/lnreader-plugins)
> continues to work in the Tauri rewrite. Sourced from upstream
> `src/plugins/types/index.ts`, `src/plugins/types/filterTypes.ts`,
> `src/plugins/pluginManager.ts`, and `src/plugins/helpers/*` at
> commit `639a2538`.

The economic case for keeping this contract identical: hundreds of
community-authored plugins already exist. If the new app re-uses this
contract, users get continuity on day one and the lnreader-plugins
repository becomes the shared catalog. Breaking the contract is only
acceptable as a last resort.

## 1. Plugin module shape

A plugin is a CommonJS module evaluated through `Function('require', 'module', code)(_require, {})`. It must populate `module.exports.default` with an object satisfying the `Plugin` interface:

```ts
export interface PluginItem {
  id: string;
  name: string;
  site: string;       // canonical URL, e.g. "https://boxnovel.com"
  lang: string;       // ISO 639 code, e.g. "en", "ko", "zh"
  version: string;    // semver
  url: string;        // raw source URL of this index.js (used for updates)
  iconUrl: string;
  customJS?: string;  // optional override URL injected into reader
  customCSS?: string;
  hasUpdate?: boolean;
  hasSettings?: boolean;
}

export interface Plugin extends PluginItem {
  imageRequestInit: {
    method?: string;
    headers: Record<string, string>; // must include User-Agent (filled if missing)
    body?: string;
  };
  filters?: Filters;          // see §3
  pluginSettings?: PluginSettings; // see §4
  popularNovels: (
    pageNo: number,
    options?: { showLatestNovels?: boolean; filters?: FilterToValues<Filters> },
  ) => Promise<NovelItem[]>;
  parseNovel: (novelPath: string) => Promise<SourceNovel>;
  parsePage?: (novelPath: string, page: string) => Promise<SourcePage>;
  parseChapter: (chapterPath: string) => Promise<string>;  // returns HTML
  searchNovels: (searchTerm: string, pageNo: number) => Promise<NovelItem[]>;
  resolveUrl?: (path: string, isNovel?: boolean) => string;
  webStorageUtilized?: boolean;
}
```

The host always **enforces** `imageRequestInit.headers['User-Agent']`. If the plugin omits one, the host injects the device UA before any image fetch. This stops broken plugins from leaking the underlying engine's UA.

## 2. Domain types

```ts
export interface NovelItem {
  id: undefined;        // server-side id; the host assigns the local DB id
  name: string;
  path: string;         // plugin-specific identifier; passed back as-is
  cover?: string;
}

export interface ChapterItem {
  name: string;
  path: string;
  chapterNumber?: number;
  releaseTime?: string; // ISO8601 preferred; UI does best-effort parse
  page?: string;        // pagination cursor for parsePage()
}

export enum NovelStatus {
  Unknown = 'Unknown',
  Ongoing = 'Ongoing',
  Completed = 'Completed',
  Licensed = 'Licensed',
  PublishingFinished = 'Publishing Finished',
  Cancelled = 'Cancelled',
  OnHiatus = 'On Hiatus',
}

export interface SourceNovel extends NovelItem {
  genres?: string;       // comma- or pipe-delimited; UI splits/normalizes
  summary?: string;
  author?: string;
  artist?: string;
  status?: NovelStatus;
  chapters: ChapterItem[];
  totalPages?: number;   // for novels with paginated chapter lists
}

export interface SourcePage {
  chapters: ChapterItem[];
}
```

## 3. Filters (`Filters`)

`Filters` is `Record<string, { label: string } & FilterShape>`. The host renders these as form controls in the source's filter sheet.

```ts
enum FilterTypes {
  TextInput              = 'Text',
  Picker                 = 'Picker',
  CheckboxGroup          = 'Checkbox',
  Switch                 = 'Switch',
  ExcludableCheckboxGroup = 'XCheckbox',
}
```

| `type` | Value type | UI |
|---|---|---|
| `Text` | `string` | text input |
| `Picker` | `string` (one of `options.value`) | radio / dropdown |
| `Checkbox` | `string[]` | multi-select |
| `Switch` | `boolean` | toggle |
| `XCheckbox` | `{ include?: string[]; exclude?: string[] }` | tri-state checkbox |

`popularNovels` receives the resolved values via `options.filters`. The
helper guards `isPickerValue`, `isCheckboxValue`, `isSwitchValue`,
`isTextValue`, `isXCheckboxValue` are exported from
`@libs/filterInputs` for narrowing inside plugins.

## 4. Plugin settings (`PluginSettings`)

Plugins that need user-configurable values (login tokens, region, etc.)
declare:

```ts
type PluginSetting =
  | { type?: 'Text'; value: string; label: string }
  | { type: 'Switch'; value: boolean; label: string }
  | { type: 'Select'; value: string; label: string; options: { label: string; value: string }[] }
  | { type: 'CheckboxGroup'; value: string[]; label: string; options: { label: string; value: string }[] }

type PluginSettings = Record<string, PluginSetting>;
```

`hasSettings: true` opts the plugin into a "Plugin Settings" entry on
its tile in More → Browse settings. The host persists current values
under `@libs/storage`.

## 5. Module sandbox & `require()` whitelist

The host evaluates the plugin source with a custom `_require` that
exposes only these modules:

| Import | Provides |
|---|---|
| `htmlparser2` | `{ Parser }` from `htmlparser2` |
| `cheerio` | `{ load }` from `cheerio` |
| `dayjs` | the `dayjs` default export |
| `urlencode` | `{ encode, decode }` from `urlencode` |
| `@libs/novelStatus` | `{ NovelStatus }` |
| `@libs/fetch` | `{ fetchApi, fetchText, fetchProto }` (see §6) |
| `@libs/isAbsoluteUrl` | `{ isUrlAbsolute }` |
| `@libs/filterInputs` | `{ FilterTypes }` |
| `@libs/defaultCover` | `{ defaultCover }` |
| `@libs/aes` | `{ gcm }` from `@noble/ciphers/aes.js` |
| `@libs/utils` | `{ utf8ToBytes, bytesToUtf8 }` |
| `@libs/cookies` | `{ cookies }` (see §7) |
| `@libs/webView` | `{ webViewFetch }` (see §8) |
| `@libs/storage` | `{ storage, localStorage, sessionStorage }` (per-plugin scoped MMKV) |

No other node/browser globals are guaranteed. Plugins that touch
`window`, `document`, or unsupported APIs will fail.

The new Tauri host must reproduce this same `require` shape. Plugins
should **not** notice the runtime change.

## 6. `@libs/fetch`

Three exports, all `Promise`-returning:

```ts
fetchApi(url: string, init?: FetchInit): Promise<Response>;
fetchText(url: string, init?: FetchInit, encoding?: string): Promise<string>;
fetchProto(protoInit: ProtoRequestInit, url: string, init?: FetchInit): Promise<unknown>;

type FetchInit = {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: FormData | string;
};
```

`fetchApi` semantics — exactly what the rewrite must reproduce:

1. Always merge a default header set: `Connection: keep-alive`, `Accept: */*`, `Accept-Language: *`, `Sec-Fetch-Mode: cors`, `Accept-Encoding: gzip, deflate`, `Cache-Control: max-age=0`, `User-Agent: getUserAgent()`. Caller-provided headers override these by key.
2. Run the network fetch.
3. **Cloudflare detection** — only if the response status is 403 or 503 AND the content-type is `text/html`. Read the body once; check the regex `Just a moment\.\.\.|cf_chl_opt|challenge-platform|cf-mitigated`. If any match, escalate to the WebView fallback. The v0.1 implementation lives in `src-tauri/src/scraper.rs` (cookie jar via the embedded scraper Webview) and `src/lib/http.ts` (`pluginFetch` / `pluginFetchText`). Otherwise return the original response.

`fetchText` is the same merge-headers wrapper but reads the body as
text via `FileReader.readAsText(blob, encoding)` so legacy non-UTF8
sites can be decoded (Korean cp949, Japanese sjis, etc.).

`fetchProto` builds a length-prefixed gRPC-web body from a protobufjs
schema, POSTs it, and decodes the response. Used by the very small
number of sources that speak gRPC-web. Implementation detail; copy as
is.

## 7. `@libs/cookies`

Wraps `@preeternal/react-native-cookie-manager` in upstream:

```ts
cookies.get(url: string, useWebKit?: boolean): Promise<Record<string, { value: string }>>
cookies.set(
  url: string,
  cookie: { name: string; value: string; domain?: string; path?: string; secure?: boolean },
  useWebKit?: boolean,
): Promise<void>
cookies.clearByName(url: string, name: string, useWebKit?: boolean): Promise<void>
```

In the rewrite, this maps to Tauri 2's `Webview::cookies_for_url()` for
reads, and the (upcoming) cookie-set API or a manual `Set-Cookie`
header injection in the HTTP plugin's cookie store for writes. The
two-store sync rule from `prd.md §6.1` applies: webview store is the
authoritative source, mirror writes into the `reqwest` store before
HTTP requests.

`useWebKit` is iOS-only (toggles the WebKit cookie store vs the
default `WKHTTPCookieStore`). On Android it is ignored. The new app
can ignore it on desktop too.

## 8. `@libs/webView`

```ts
webViewFetch(url: string, options?: {
  beforeContentScript?: string;
  afterContentScript?: string;
  userAgent?: string;
  timeoutMs?: number; // default 30000
}): Promise<string>;
```

The host opens a hidden WebView, navigates to `url`, injects the
provided JS, and resolves with whatever the page calls
`window.ReactNativeWebView.postMessage(...)` with.

The v0.1 implementation diverges: instead of an opt-in hidden
WebView per call, a single persistent embedded scraper Webview
(`src-tauri/src/scraper.rs`) holds the cookie jar, and
`webview_fetch` in Rust + `src/lib/http.ts` issues the request
through reqwest with those cookies attached. The visible
"Open site" overlay reuses the same Webview for manual
challenge-clearing; cookies persist across requests.

## 9. `@libs/storage`

Each plugin gets its own scope by `plugin.id`:

```ts
import { storage, localStorage, sessionStorage } from '@libs/storage';

storage.set('foo', 'bar');
storage.get('foo'); // 'bar'
```

`storage` persists across launches. `localStorage` is the same in
upstream (treat as alias). `sessionStorage` is in-memory and clears
when the app process exits.

## 10. Lifecycle & install

Implemented in `src/plugins/pluginManager.ts`:

- **fetchPlugins** — for every `repository` row in DB, GET `repository.url`, parse JSON as `PluginItem[]`, dedup by `id` (last write wins).
- **installPlugin(item)**:
  1. GET `item.url` with `pragma: no-cache` and `cache-control: no-cache` headers.
  2. Evaluate the body (sandboxed `Function`).
  3. If the in-memory `plugins[plugin.id]` is missing or older (semver `compareVersion`), persist:
     - Write `index.js` to `${PLUGIN_STORAGE}/${plugin.id}/index.js`.
     - If `customJS`, download to `custom.js` next to it; else delete any existing `custom.js`.
     - Same for `customCSS` → `custom.css`.
- **uninstallPlugin(item)** — drop in-memory entry, remove all
  storage keys starting with `plugin.id`, delete `index.js`.
- **getPlugin(id)** — in-memory lookup with disk fallback. Returns
  `undefined` for `LOCAL_PLUGIN_ID = 'local'` (the local-files
  pseudo-plugin).
- **updatePlugin** — same code path as install.

## 11. The `local` pseudo-plugin

`pluginId === 'local'` is reserved for novels imported from a local
EPUB or HTML directory. It does not have a JS module — the host's
local-import path produces `Novel` rows directly. Plugin-aware code
must treat `'local'` specially (no scrape, no update check, no
unfollow → uninstall).

## 12. Repository registry

Plugin sources are organized into "repositories" — JSON files hosted
at any URL that contain `PluginItem[]`. The user adds a repository
URL in **More → Browse settings → Repositories**. The DB table is
`Repository(id, url)` with a uniqueness constraint on `url`.

The default repository is the user's choice (commit `0bda5fd0` removed
the bundled default — the user must add at least one). The most common
choice is the [official lnreader-plugins repo](https://github.com/lnreader/lnreader-plugins).

## 13. Required vs. optional methods checklist

When porting the plugin runtime, the host MUST tolerate plugins that:

- Throw on any of the optional methods (`parsePage`, `resolveUrl`).
- Return cover URLs that are relative (the host should `resolveUrl()` them).
- Return chapter lists with duplicate `path` values (the DB unique
  index dedupes; the runtime should not crash).
- Return `releaseTime` in any string format (the UI uses dayjs with
  best-effort parsing).
- Return giant `summary` blocks (no length limit specified).

## 14. Versioning & update prompt

`hasUpdate` is set on the in-memory `PluginItem` when fetched
repository version > installed version (`compareVersion.newer`). The
Browse settings tile shows an "Update" CTA. The plugin auto-update
runner does not exist — updates are user-initiated.

## 15. Testing a plugin port

Smoke test recipe:

1. Pick the simplest upstream plugin (suggested: BoxNovel — pure
   cheerio HTML scraping, no protobuf, no cookies).
2. Place it at `<plugin_storage>/boxnovel/index.js`.
3. Insert a row into `Repository(url)` pointing at the upstream raw
   index URL.
4. Call `popularNovels(1)` → expect non-empty `NovelItem[]`.
5. Call `parseNovel(item.path)` for one item → expect `chapters.length > 0`.
6. Call `parseChapter(chapter.path)` → expect HTML string.
7. Repeat against a Cloudflare-protected source (e.g.
   `Boxnovel.club` historically) and confirm `webViewFetch` engages.

## 16. References

- Plugin types: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/types/index.ts>
- Filter types: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/types/filterTypes.ts>
- Plugin manager: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/pluginManager.ts>
- fetch helpers: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/fetch.ts>
- WebView fetch: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/webViewFetch.ts>
- Plugins repository: <https://github.com/lnreader/lnreader-plugins>
