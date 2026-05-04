# Onboarding + Utility Screens

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/onboarding/OnboardingScreen.tsx` (lines 1-99) — first-launch wrapper
> - `src/screens/onboarding/ThemeSelectionStep.tsx` (lines 1-191) — theme picker step
> - `src/screens/WebviewScreen/WebviewScreen.tsx` (lines 1-126) — in-app browser
> - `src/screens/WebviewScreen/components/Appbar.tsx` (lines 1-102) — webview top bar
> - `src/screens/WebviewScreen/components/Menu.tsx` (lines 1-103) — webview overflow menu
> - `src/screens/StatsScreen/StatsScreen.tsx` (lines 1-210) — library statistics
> - `src/database/queries/StatsQueries.ts` (lines 1-129) — stats data layer
> - `src/screens/browse/migration/Migration.tsx` (lines 1-72) — pick source to migrate from
> - `src/screens/browse/migration/MigrationNovels.tsx` (lines 1-166) — search-across-plugins screen
> - `src/screens/browse/migration/MigrationNovelList.tsx` (lines 1-149) — per-source result strip + confirm modal
> - `src/screens/browse/migration/MigrationSourceItem.tsx` (lines 1-81) — source row card
> - `src/services/migrate/migrateNovel.ts` (lines 1-176) — `MIGRATE_NOVEL` background task
> - `src/components/NewUpdateDialog.tsx` (lines 1-73) — release prompt
> - `src/hooks/common/useGithubUpdateChecker.ts` (lines 1-94) — release polling
> - `src/navigators/Main.tsx` (lines 33-126) — root stack registration + onboarding gate
> - `src/navigators/MoreStack.tsx` (lines 19-49) — `Statistics` route
> - `src/navigators/types/index.ts` (lines 9-155) — route param shapes
> - `strings/languages/en/strings.json` (lines 149-154, 220, 242-249, 529-538, 559-566) — i18n keys

This document covers five small, mostly-utility surfaces that do not
fit the main reading flow: first-launch onboarding, the in-app browser
(used both as a manual fallback for source pages and as the manual-
clearance path for Cloudflare-hardened sources), the library
statistics dashboard, the novel-source migration pair, and the GitHub
update prompt. Each sub-section follows the same micro-template.

## 1. OnboardingScreen

### 1.1 Purpose

First-launch gate. The Tauri app must show this **before** any
navigator mounts so the user picks a theme/mode and Onboarded flag is
set. Once `IS_ONBOARDED === true`, `OnboardingScreen` is never shown
again unless the user wipes the MMKV `IS_ONBOARDED` key (no in-app
"reset onboarding" affordance exists in upstream).

Upstream wires this in `Main.tsx:48,73-75`:

```tsx
const [isOnboarded] = useMMKVBoolean('IS_ONBOARDED');
// ...
if (!isOnboarded) {
  return <OnboardingScreen />;
}
```

### 1.2 Routes

- **Not** part of `RootStackParamList`. Rendered as the entire app tree
  when the gate flips false (`Main.tsx:73-75`). It owns the screen,
  there is no nav wrapper, no app bar, no back button.
- Exit: pressing **Complete** writes `MMKVStorage.set('IS_ONBOARDED', true)`
  (`OnboardingScreen.tsx:64-66`); the `useMMKVBoolean` hook in `Main.tsx`
  re-renders and swaps to the `NavigationContainer` tree.

### 1.3 Layout

`SafeAreaView` with `paddingTop: 40, paddingHorizontal: 16, paddingBottom: 16,`
`height: 100%` (`OnboardingScreen.tsx:72-78`). From top to bottom:

1. **App logo** — `assets/logo.png`, 90×90, `tintColor={theme.primary}`
   (`OnboardingScreen.tsx:38-42`).
2. **Headline** — `headlineLarge` Paper variant, color `theme.onBackground`,
   text `onboardingScreen.welcome` (`OnboardingScreen.tsx:43-48`).
3. **Help text** — single line, currently always `onboardingScreen.pickATheme`
   (the `renderHelptext` switch returns the same string for every step;
   the multi-step machinery exists but only one step is implemented —
   `OnboardingScreen.tsx:11-13,27-34`).
4. **Step container** — rounded rectangle (`borderRadius: 8`), background
   `theme.surfaceVariant`, `flexGrow: 1, marginBottom: 16, paddingTop: 16`
   (`OnboardingScreen.tsx:91-98`). Hosts the current step component.
5. **Bottom button** — `Button` with `mode="contained"`, label
   `onboardingScreen.complete` (`OnboardingScreen.tsx:61-67`).

### 1.4 Components

- `OnboardingScreen` (root). Holds a `step` state with a single value
  enum `OnboardingStep.PICK_THEME`. The setter is destructured-out
  (`const [step] = useState(...)`), so today there is no transition
  between steps — only the single `ThemeSelectionStep`.
- `ThemeSelectionStep` (`ThemeSelectionStep.tsx:62-141`):
  - `SegmentedControl` with three options (`system / light / dark`),
    sourced from `themeModeOptions` (`ThemeSelectionStep.tsx:73-89`),
    bound to MMKV key `THEME_MODE` via `useMMKVString`.
  - Horizontal `ScrollView` of `ThemePicker` cards. The list is
    `theme.isDark ? darkThemes : lightThemes` from `@theme/md3`
    (`ThemeSelectionStep.tsx:69-71,127-135`). Tapping a card calls
    `setThemeId(item.id)` and switches `THEME_MODE` to match the
    selected theme's `isDark` (`ThemeSelectionStep.tsx:104-107`).
  - `AmoledToggle` — only renders when current theme is dark
    (`ThemeSelectionStep.tsx:26-28`). Toggles MMKV key `AMOLED_BLACK`.
    Custom-built switch using `Pressable` + `View` with a sliding
    thumb (no native `Switch`).

### 1.5 States

- **Onboarding pending** (`IS_ONBOARDED` unset or `false`): screen
  visible, app navigators not mounted.
- **Onboarding complete** (`IS_ONBOARDED === true`): never re-renders;
  the gate in `Main.tsx` swaps to the `NavigationContainer`.
- Within `ThemeSelectionStep`:
  - `themeMode === 'system'`: theme follows OS dark/light preference;
    `ThemePicker` cards listed match the *current* effective dark/light
    set.
  - `themeMode === 'light' | 'dark'`: explicit override. If the
    currently selected `theme.id` is not present in the new mode's
    list, the first theme of that list is auto-applied
    (`ThemeSelectionStep.tsx:91-101`).
  - AMOLED toggle is hidden in light mode.

### 1.6 Interactions

- **Mode segmented control change** → `setThemeMode(mode)`. May also
  re-pick a theme id when the previously selected one is not in the
  new mode's list (`ThemeSelectionStep.tsx:91-102`).
- **Theme card tap** → set both `APP_THEME_ID` and `THEME_MODE` so the
  segmented control updates immediately
  (`ThemeSelectionStep.tsx:104-107`).
- **AMOLED toggle press** → flips `AMOLED_BLACK`.
- **Complete button** → `MMKVStorage.set('IS_ONBOARDED', true)`. No
  validation, no required selection — every default is already
  acceptable.

### 1.7 Affecting settings

- `IS_ONBOARDED` (`MMKVStorage` boolean). See
  [settings/catalog.md §1](../settings/catalog.md) row for this key.
- `THEME_MODE` (`'system' | 'light' | 'dark'`).
- `APP_THEME_ID` (numeric id matching one of the 9 themes in
  `src/theme/md3/`).
- `AMOLED_BLACK` (boolean, dark-only).

### 1.8 Data

No DB reads. No network. Pure MMKV writes.

### 1.9 Edge cases

- **Step machinery is single-stepped.** `OnboardingStep` enum has one
  value. The `setStep` setter is intentionally not exposed — the
  Complete button just flips `IS_ONBOARDED`. Tauri rewrite should keep
  the same shape (one step → one button) unless onboarding scope
  expands.
- **No keyboard / form inputs** — onboarding cannot fail.
- **Theme list relies on current `theme.isDark`.** On very first
  launch, no theme is persisted and the default (system) `theme.isDark`
  drives the initial card list. Switching `THEME_MODE` re-derives the
  list via `useMemo` on `theme.isDark`.

### 1.10 Tauri-side notes

- The first-launch gate in `Main.tsx:73-75` is the only place that
  conditionally renders `OnboardingScreen`. Reproduce that exact
  pattern: read `IS_ONBOARDED`, render onboarding before mounting any
  router.
- `useMMKVBoolean` is reactive. The Tauri equivalent (likely a
  `tauri-plugin-store` or local-tauri-state hook) must trigger a
  re-render when the flag flips, otherwise tapping Complete strands
  the user on the onboarding screen until the next app launch.
- Asset reference `require('../../../assets/logo.png')` resolves at
  bundle time. Tauri rewrite should expose the same logo from the
  static asset pipeline.
- AMOLED toggle is hand-rolled (not native `Switch`). Match the
  visual: 52×32 track, 28×28 thumb, slide via `alignSelf: 'flex-end'`.

### 1.11 Refs

- OnboardingScreen.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/onboarding/OnboardingScreen.tsx>
- ThemeSelectionStep.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/onboarding/ThemeSelectionStep.tsx>
- Onboarding gate: <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/Main.tsx#L48-L75>
- i18n: `onboardingScreen.*` (`strings/languages/en/strings.json:559-566`).

## 2. WebviewScreen

### 2.1 Purpose

Embedded browser used in three contexts:

1. **Plugin-page inspection** — opened from the source detail screen
   header (`PluginListItem.tsx:64`) to view a source's homepage in-app
   without leaving LNReader.
2. **Novel/chapter on the source site** — opened from
   `NovelScreenButtonGroup.tsx:80`, `BrowseSourceScreen.tsx:64`,
   `ReaderScreen.tsx:113`, `ReaderFooter.tsx:120`. Lets the user view
   the original page (e.g. to compare a parsed chapter to the live HTML).
3. **Manual Cloudflare clearance** — when the hidden-WebView path
   cannot solve a challenge (Turnstile, etc.), users open the source
   in this visible WebView and complete the challenge by hand. See
   [cloudflare-bypass.md §10](../plugins/cloudflare-bypass.md).
   Cookies acquired here persist into the system / WKWebView store and
   subsequent `fetchApi` calls from plugins succeed.

### 2.2 Routes

`Stack.Screen name="WebviewScreen"` registered in
`Main.tsx:126`. Param shape (`navigators/types/index.ts:26-31`):

```ts
WebviewScreen: {
  name: string;       // initial title shown in app bar
  url: string;        // path or absolute URL
  pluginId: string;   // for resolveUrl + per-plugin storage
  isNovel?: boolean;  // hint to plugin.resolveUrl
};
```

`url` is fed through `resolveUrl(pluginId, url, isNovel)`
(`services/plugin/fetch.ts:49-63`) so plugins can rewrite a relative
path into an absolute source URL.

### 2.3 Layout

Top-down (`WebviewScreen.tsx:80-122`):

1. **`Appbar`** (custom — `WebviewScreen/components/Appbar.tsx`).
   Layout: `flexDirection: 'row'`, padded by safe-area `top`,
   background `theme.surface`. Left: `close` icon (calls `goBack`,
   first persisting localStorage/sessionStorage if applicable). Center:
   single-line title (current page title or initial `name`). Right:
   `arrow-left`, `arrow-right` (history nav, disabled when not
   applicable), `dots-vertical` (toggles overflow menu).
2. **`ProgressBar`** (Paper) — drawn under the app bar. `progress`
   property snapped to 3 decimals, hidden when `progress === 1`
   (`WebviewScreen.tsx:94-98`).
3. **`WebView`** (RN react-native-webview) filling the remaining area,
   `containerStyle.paddingBottom = insets.bottom`. UA is the persisted
   `APP_USER_AGENT` or `react-native-device-info`'s
   `getUserAgentSync()` (`useUserAgent.ts:7-13`).
4. **Overflow menu** (`Menu.tsx`) — only when `menuVisible`. Full-
   viewport `Pressable` overlay (taps anywhere outside the menu close
   it), with a small floating column of buttons anchored top-right.

### 2.4 Components

- `Appbar` (`Appbar.tsx`): `IconButtonV2 close`, title `Text`
  (`numberOfLines={1}`), trio of `IconButtonV2` (back / forward /
  menu).
- `Menu` (`Menu.tsx`): four rows, all Pressables with `theme.surface2`
  background:
  - **Refresh** → `webView.reload()`.
  - **Share** → `Share.share({ message: currentUrl })` (RN
    `Share` API; native share sheet).
  - **Open in browser** → `expo-linking` `Linking.openURL(currentUrl)`.
  - **Clear data** → `webView.clearCache(true)` + reload + toast
    `webview.dataDeleted`. Note: i18n catalog also has
    `webview.clearCookies` / `webview.cookiesCleared` strings, but the
    upstream menu does **not** wire a clear-cookies action — only the
    cache+reload path. Likely legacy keys (`strings.json:242-249`).
- `WebView` injects:
  ```js
  window.ReactNativeWebView.postMessage(
    JSON.stringify({ localStorage, sessionStorage }),
  );
  ```
  on every load (`WebviewScreen.tsx:77-78,106`). The host parses the
  payload into `tempData`.

### 2.5 States

- `progress: 0..1` — drives `ProgressBar`. Set on
  `onLoadProgress`. Hidden at exactly 1.
- `title: string` — set on `onNavigationStateChange` when
  `e.loading === false`. Initial value = route param `name`.
- `currentUrl: string` — last navigated URL (used by Share / Open in
  browser).
- `canGoBack`, `canGoForward: boolean` — enable/disable the history
  arrows.
- `tempData?: { localStorage?, sessionStorage? }` — buffer of the most
  recent web storage snapshot from the page.
- `menuVisible: boolean`.

### 2.6 Interactions

- **System back / Appbar close** (`useBackHandler` + `goBack` prop):
  1. If menu open → close menu, swallow event.
  2. Else if WebView can go back → `webView.goBack()`, swallow.
  3. Else → `saveData()` (persist `tempData` to per-plugin MMKV) then
     `navigation.goBack()` (`WebviewScreen.tsx:64-75,89-92`).
- **Forward / Back arrows** → `webView.goBack()` / `goForward()`.
- **Refresh / Share / Open / Clear** — see §2.4.
- **`saveData`** runs only when `pluginId && tempData &&`
  `getPlugin(pluginId).webStorageUtilized` is true
  (`WebviewScreen.tsx:51-62`). Stores under
  `<pluginId>_LocalStorage` and `<pluginId>_SessionStorage` keys in
  the `plugin_db` MMKV instance (`plugins/helpers/storage.ts:6-7,
  102-117,123`). Plugins read these later via the `LocalStorage` and
  `SessionStorage` proxy classes.

### 2.7 Affecting settings

- `APP_USER_AGENT` (`MMKVStorage` string). When unset, falls back to
  `getUserAgentSync()`. See
  [settings/catalog.md §1](../settings/catalog.md).
- Per-plugin `webStorageUtilized` flag (`plugins/types/index.ts:128`).
  When true, the screen mirrors the page's `localStorage` /
  `sessionStorage` into MMKV so the plugin can read them server-side.

### 2.8 Data

- Reads: `getPlugin(pluginId)?.webStorageUtilized` flag,
  `APP_USER_AGENT`, `resolveUrl(pluginId, url, isNovel)`.
- Writes: `<pluginId>_LocalStorage`, `<pluginId>_SessionStorage` (MMKV
  `plugin_db`), only when the plugin opts in.
- No DB reads/writes.

### 2.9 Edge cases

- **`webStorageUtilized` is the only way the page's storage survives.**
  Plugins that need cookies but not localStorage rely on the WebView
  cookie store — that path is unrelated to `tempData`.
- **`Clear data` only clears the cache** (and reloads). It does **not**
  clear cookies, web storage MMKV mirrors, or revoke `cf_clearance`.
  Users hitting a CF wall still need to nuke cookies through OS or
  WebKit-specific APIs.
- **Title can flicker.** First render uses the route-param `name`, then
  flips to `e.title` on first non-loading nav event. If a page never
  resolves a title, the initial `name` sticks.
- **The injected JS runs on every load.** That includes the CF
  challenge page itself; the message stream from the challenge HTML
  would be discarded by `JSON.parse` (the challenge page doesn't post
  back a `{localStorage, sessionStorage}` envelope), so this isn't
  visible — but a buggy page that posts a different shape could throw.

### 2.10 Tauri-side notes

- Tauri 2 `WebviewWindow` is the substrate. Reuse the same window
  factory used by the hidden-WebView pipeline
  ([cloudflare-bypass.md §4](../plugins/cloudflare-bypass.md)) but
  render visibly inside the app shell.
- Implement the four menu actions via Tauri APIs:
  - Refresh: `webview.eval("location.reload()")` or built-in reload.
  - Share: platform-specific. macOS/iOS `NSSharingService`, Windows
    fall back to copy-to-clipboard, Android `Intent.ACTION_SEND`.
  - Open in browser: `tauri::api::shell::open` (or the v2 plugin
    equivalent).
  - Clear data: equivalent to `WKWebView`'s
    `removeDataOfTypes`/Webview2's clear cache call.
- Web storage mirroring uses `injectJavaScript`. Tauri exposes
  `webview.eval(...)` and an IPC channel — wire the same envelope
  shape `{ localStorage, sessionStorage }` so the plugin contract
  ([plugins/contract.md §9](../plugins/contract.md)) keeps working.
- The visible-WebView path is the **fallback** for unsolvable CF
  challenges. The hidden path (cloudflare-bypass.md §1-3) tries first;
  when it gives up, the user is directed here. Make sure cookies set
  here are visible to the plugin runtime's `fetchApi`.

### 2.11 Refs

- WebviewScreen.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/WebviewScreen.tsx>
- Appbar.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/components/Appbar.tsx>
- Menu.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/components/Menu.tsx>
- Plugin storage helpers: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/storage.ts>
- i18n: `webview.*` (`strings/languages/en/strings.json:242-249`).
- Cross-ref: [cloudflare-bypass.md §10](../plugins/cloudflare-bypass.md)
  (manual clearance fallback).

## 3. StatsScreen

### 3.1 Purpose

Library statistics dashboard. Read-only, scroll-only summary of how
many novels / chapters / sources / genres / statuses the user has in
their library. Reachable from More → Statistics
(`MoreScreen.tsx:160-167`).

### 3.2 Routes

- `MoreStack.tsx:49`: `<Stack.Screen name="Statistics" component={StatsScreen} />`
- Param list: `MoreStackParamList.Statistics: undefined`
  (`navigators/types/index.ts:67-73`).
- Navigated to via `navigation.navigate('MoreStack', { screen: 'Statistics' })`
  (`MoreScreen.tsx:163-167`).

### 3.3 Layout

- `SafeAreaView` with `excludeTop` (`StatsScreen.tsx:86`), so the
  custom `Appbar` owns the status-bar inset.
- Header: standard `Appbar` (back + title `statsScreen.title`).
- Below: vertically scrolling `ScrollView` with `paddingBottom: 40`,
  `paddingHorizontal: 16`. Each section is rendered as:
  - Section header `Text` (`fontWeight: 'bold', paddingVertical: 16,`
    `color: theme.onSurfaceVariant`).
  - One or more `Row` (from `@components/Common`) of `StatsCard`s.

Sections in order (`StatsScreen.tsx:92-144`):

1. **General** (`getString('generalSettings')` — yes, the section
   reuses the General Settings i18n key as its label):
   - Row 1: `Titles in library` (`stats.novelsCount`),
     `Read chapters` (`stats.chaptersRead`),
     `Total chapters` (`stats.chaptersCount`).
   - Row 2: `Unread chapters` (`stats.chaptersUnread`),
     `Downloaded chapters` (`stats.chaptersDownloaded`).
   - Row 3: `Sources` (`stats.sourcesCount`).
2. **Genre distribution** (`statsScreen.genreDistribution`): one
   `StatsCard` per genre (`flexWrap: 'wrap'`, `genreRow` style),
   label = genre, value = count.
3. **Status distribution** (`statsScreen.statusDistribution`): one
   `StatsCard` per `NovelStatus`, label translated via
   `translateNovelStatus(status)`.

`StatsCard` (`StatsScreen.tsx:152-177`) is a small rounded box:
- Light theme: `theme.secondaryContainer` background.
- Dark theme: `overlay(2, theme.surface)` (Paper utility).
- Box shadow: `0px 2px 4px rgba(0,0,0,0.25)`.
- Stack: large primary-coloured value, then label below.

### 3.4 Components

- `Appbar`, `ErrorScreenV2`, `LoadingScreenV2`, `SafeAreaView` from
  `@components`.
- `Row` from `@components/Common` (flex-row helper).
- `StatsCard` (locally defined).

### 3.5 States

- `isLoading: boolean` (initial `true`).
- `error: any | undefined`.
- `stats: LibraryStats` (initial `{}`).

Render branches (`StatsScreen.tsx:68-83`):

- `error` truthy → `ErrorScreenV2 error={error}` under the header.
- `isLoading && !error` → `LoadingScreenV2` under the header.
- Otherwise → the scroll content.

### 3.6 Interactions

- Back button only (`Appbar` `handleGoBack={goBack}`).
- No taps on cards. Read-only.
- No filtering/sorting controls.

### 3.7 Affecting settings

- `LibraryStats` is computed against `novelSchema.inLibrary === true`
  (every query in `StatsQueries.ts`) — the **Downloaded only** mode
  flag does *not* affect this screen. It always reflects the full
  library.
- `incognitoMode` (paused reading history) doesn't change anything
  here either; reading state is already persisted, just not updated
  while incognito is on.

### 3.8 Data

`StatsScreen.tsx:37-58` runs `Promise.all` over seven Drizzle queries
(`StatsQueries.ts`) and merges results via `Object.assign(...res)`:

| Query | Returns | SQL essence |
|---|---|---|
| `getLibraryStatsFromDb` | `{ novelsCount, sourcesCount }` | `SELECT count(*), count(distinct pluginId) FROM novel WHERE inLibrary = 1` |
| `getChaptersTotalCountFromDb` | `{ chaptersCount }` | join `chapter` × `novel` filtered to `inLibrary` |
| `getChaptersReadCountFromDb` | `{ chaptersRead }` | + `chapter.unread = 0` |
| `getChaptersUnreadCountFromDb` | `{ chaptersUnread }` | + `chapter.unread = 1` |
| `getChaptersDownloadedCountFromDb` | `{ chaptersDownloaded }` | + `chapter.isDownloaded = 1` |
| `getNovelGenresFromDb` | `{ genres: { genre: count } }` | reads `novel.genres` for in-library novels, splits by `,`, `lodash.countBy` |
| `getNovelStatusFromDb` | `{ status: { status: count } }` | same pattern on `novel.status` |

`LibraryStats` shape (`database/types/index.ts:90-99`): every field
optional, all merged into one record by `Object.assign(...res)`.

### 3.9 Edge cases

- **Empty library** — every count is `0`, all distribution rows
  render zero `StatsCard`s. The section headers still render, leaving
  small empty bands.
- **Genres / statuses splitting** — comma-separated fields, split
  with `/\s*,\s*/`. Trailing whitespace in genres can produce
  duplicate buckets; same caveat applies in upstream (no
  normalization beyond the regex).
- **`StatsCard` skips itself when `!label`** (`StatsScreen.tsx:158-160`)
  — `Object.entries({ '': 5 })` would silently drop the empty-key
  bucket.
- **Concurrency** — `Promise.all` with 7 queries; first error rejects
  and shows `ErrorScreenV2`. There is no per-query retry.

### 3.10 Tauri-side notes

- Same SQLite schema (verbatim Drizzle copy under `src/database/`),
  so the same queries port directly. Use the Tauri SQLite plugin or
  `rusqlite` from a command.
- Drizzle's `Object.assign(...res)` merge pattern requires each query
  to return a non-null object with exactly the named field — keep
  this contract or rewrite the merge.
- Reading-time / chapters-per-day / streak metrics are **not** in the
  upstream stats screen. Don't add them in v1; match upstream first.

### 3.11 Refs

- StatsScreen.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/StatsScreen/StatsScreen.tsx>
- StatsQueries.ts: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/StatsQueries.ts>
- i18n: `statsScreen.*` (`strings/languages/en/strings.json:529-538`).
- Domain model: [domain/model.md](../domain/model.md) for `inLibrary`.

## 4. Migration / MigrateNovel

The migration flow is **two stacked screens** plus a confirm modal,
backed by a long-running background task. The user's mental model:
"this novel went stale on source A, find the same novel on source B,
move my read progress / bookmarks / downloads over."

### 4.1 Purpose

- **Migration** (`Migration.tsx`): pick a *source plugin* the user has
  novels from. Lists installed plugins filtered to those with at least
  one library novel.
- **MigrateNovel** (`MigrationNovels.tsx`): the actual search-across-
  sources screen. Given a `fromNovel`, fan out a search query across
  every pinned plugin and let the user pick a target.
- The confirm modal lives in `MigrationNovelList.tsx:92-127` and
  enqueues a `MIGRATE_NOVEL` background task.

### 4.2 Routes

- `Stack.Screen name="Migration"` (`Main.tsx:123`). Param: `undefined`.
  Entry: Browse tab top-bar action `swap-vertical-variant`
  (`BrowseScreen.tsx:35-37`).
- `Stack.Screen name="SourceNovels"` (`Main.tsx:124`). Picks one
  novel from the library that uses the picked plugin
  (`browse/SourceNovels.tsx:12-29`). Tapping a row navigates to
  `MigrateNovel`.
- `Stack.Screen name="MigrateNovel"` (`Main.tsx:125`). Param:
  `{ novel: NovelInfo }` (`navigators/types/index.ts:25`). Also
  reachable directly from Novel-detail header via
  `NovelScreenButtonGroup.tsx:87-91`.

The full chain from Browse: **Browse → Migration → SourceNovels →
MigrateNovel → confirm modal → background task**. From Novel detail:
**Novel → MigrateNovel → confirm modal → background task** (skips the
source picker since the source novel is already known).

### 4.3 Layout

#### Migration (`Migration.tsx`)

- Container `View` with `flex: 1`.
- Standard `Appbar` (back + title `browseScreen.migration.selectSource`).
- `FlatList` of `MigrationSourceItem` rows. List header `Text`
  reads `browseScreen.migration.selectSourceDesc`, uppercased,
  `padding: 20, paddingBottom: 10`.

`MigrationSourceItem` (`MigrationSourceItem.tsx:14-55`) is a
`TouchableRipple` row: 40×40 source icon, name + `(noOfNovels)`
counter, language sub-label.

#### MigrateNovel (`MigrationNovels.tsx`)

- `SafeAreaView excludeTop`.
- Standard `Appbar` (back + title = the source novel's `name`).
- Conditional `ProgressBar` (theme.primary). `progress` accumulates by
  `1 / pluginCount` per finished search (`MigrationNovels.tsx:79`).
  Hidden when `progress === 0` (initial frame).
- `FlatList` of `SourceSearchResult`s, one row per pinned plugin.

Each row (`MigrationNovels.tsx:98-122`):

1. Plugin name + language label header.
2. Body branches:
   - `error` set → red error message.
   - `loading` → `GlobalSearchSkeletonLoading`.
   - else → `MigrationNovelList` (horizontal strip of cover cards).

Empty list emoji icon `__φ(．．)` + description — note: this empty
description string is hardcoded English ("Search a novel in your
pinned plugins"), not yet wired through `getString` in upstream
(`MigrationNovels.tsx:144-149`). Tauri rewrite should i18n it.

#### MigrationNovelList (`MigrationNovelList.tsx`)

- Horizontal `FlatList` of `GlobalSearchNovelCover` thumbnails.
  Empty list message: `sourceScreen.noResultsFound`.
- Tap → `showModal(path, name)`:
  - If `inLibrary(path)` → toast
    `browseScreen.migration.novelAlreadyInLibrary` and abort.
  - Else → store `selectedNovel`, open the modal.
- Long-press → push `ReaderStack > Novel` (preview the candidate).

Confirm modal (`MigrationNovelList.tsx:92-127`):
- `Portal` + `Modal` from `@components`.
- Body text: `browseScreen.migration.dialogMessage` interpolated with
  `selectedNovel.name`.
- Two buttons in a row: `common.cancel` (just dismiss) and
  `novelScreen.migrate` (dismiss + enqueue task).

### 4.4 Components

- `Migration` consumes:
  - `useLibraryNovels()` — full library novel list.
  - `usePlugins().filteredInstalledPlugins` — current install set
    minus filtered-out languages.
- `MigrationNovels` runs the search fan-out:
  - Initialises `searchResults` to the plugin set with `loading:true`.
  - For each plugin, `getPlugin(item.id).searchNovels(novel.name, 1)`.
  - On success: `{ ...item, novels: data, loading: false }`.
  - On failure: `{ ...item, loading: false, error: e.message }`.
  - Always increments `progress` by `1/length` after the await.
  - `useRef(true) → false` on unmount to cut off late state updates.
- `MigrationNovelList` is per-plugin and owns the local
  `selectedNovel` + `migrateNovelDialog` state.
- `ServiceManager.manager.addTask({ name: 'MIGRATE_NOVEL', data:
  { pluginId, fromNovel, toNovelPath } })`
  (`MigrationNovelList.tsx:113-122`).

### 4.5 States

- **Migration**: derived only — list = plugins ∩ library-pluginIds.
  Empty when the user has no library novels at all (no empty state
  defined → blank list area).
- **MigrateNovel**:
  - `progress: 0..1` rolling count.
  - `searchResults: SourceSearchResult[]` — per-plugin
    `{ id, name, lang, loading, novels[], error? }`.
  - `selectedNovel: { path, name }` (in `MigrationNovelList`).
  - `migrateNovelDialog: boolean`.

### 4.6 Interactions

- **Pick source** (`Migration`) → push `SourceNovels` with that
  pluginId. (`Migration.tsx:31`).
- **Pick from-novel** (`SourceNovels`) → push `MigrateNovel` with that
  novel.
- **Cover tap** (`MigrationNovelList`) → confirm modal or
  already-in-library toast.
- **Cover long-press** → push `ReaderStack > Novel` to preview the
  candidate (lets the user verify it's the same series before
  migrating).
- **Confirm migrate** → enqueue background task; modal closes; user
  returns to whichever screen they were on. Progress is monitored from
  More → Task Queue, not from this flow.

### 4.7 Affecting settings

- `BrowseSettings` filtered installed plugins (lang filter, MAL/AL
  toggles) drive the fan-out plugin list.
- `incognitoMode` — irrelevant; migration touches DB directly.

### 4.8 Data

The `MIGRATE_NOVEL` task (`services/migrate/migrateNovel.ts:51-176`):

1. Read `fromNovel`'s chapters and the target novel by
   `(pluginId, toNovelPath)`.
2. If target doesn't exist locally yet, `fetchNovel(...)` then
   `insertNovelAndChapters(...)`.
3. **Single transactional rewrite** (`migrateNovel.ts:77-97`):
   - `UPDATE novel` → carry over cover/summary/author/artist/status/
     genres from `fromNovel`, falling back to existing target values.
   - `UPDATE novel_category` → reassign all category memberships from
     `fromNovel.id` to target id.
   - `DELETE novel WHERE id = fromNovel.id` (cascade removes
     fromNovel's chapters via FK).
4. MMKV settings carry-over:
   - `NOVEL_SETTINGS_<pluginId>_<path>` copied to the new key.
   - `LAST_READ_<pluginId>_<path>` looked up and reapplied to the
     equivalent target chapter once the chapter walk reaches it.
5. **Chapter merge by chapterNumber**:
   - Both lists sorted by `chapterNumber`. Missing numbers filled by
     `parseChapterNumber(novelName, chapterName)` (heuristic).
   - Two-pointer walk: when numbers match, copy
     `bookmark`, `unread`, `readTime`, `progress` from `fromChapter`
     to the target.
   - If the from-chapter was downloaded, enqueue
     `DOWNLOAD_CHAPTER` for the target and `await sleep(1000)`
     (per-chapter cooldown).
   - If from-chapter was the last-read, mark the target as last-read.

### 4.9 Edge cases

- **Same plugin, same novel** — confirmed via `inLibrary(path)` toast
  before the modal even opens. The migrate path itself does not
  re-check; if a caller bypassed the UI, the DELETE step would wipe
  the fromNovel and leave the matching target untouched (still safe
  because the `fromNovel.id !== toNovel.id`).
- **`chapterNumber === 0` and other falsy values** — code branches on
  `if (a.chapterNumber && b.chapterNumber)`, so `0` is treated as
  unknown and the pointers both advance (`migrateNovel.ts:134-138`).
- **Plugin search throws** — captured per-plugin into `error`, not
  fatal to the screen. Other plugins keep loading.
- **Unmount mid-search** — `isMounted` ref blocks state updates so
  late results don't crash, but the in-flight HTTP requests are not
  aborted (no abort signal).
- **`novel.id !== 'NO_ID'` guard** when entering from Novel-detail
  header (`NovelScreenButtonGroup.tsx:88`): novels not yet inserted in
  the DB cannot be migrated.
- **No undo**. The DELETE is committed in the same transaction as the
  category remap. Once the task finishes, the source row is gone.

### 4.10 Tauri-side notes

- Reuse the same `MIGRATE_NOVEL` job in the Tauri `ServiceManager`
  port. The transactional shape (UPDATE novel, UPDATE novel_category,
  DELETE novel, then chapter walk) is the contract.
- `parseChapterNumber` is heuristic; keep upstream's implementation
  verbatim to avoid drifting matches.
- The per-chapter `await sleep(1000)` exists to keep the
  `DOWNLOAD_CHAPTER` queue from hammering the source. It's a fixed
  1000ms today; consider routing through the configurable
  `chapterDownloadCooldownMs` AppSetting (introduced in commit
  `639a2538`, see [settings/catalog.md §2](../settings/catalog.md))
  for consistency.
- The hardcoded "Search a novel in your pinned plugins" empty-state
  string in `MigrationNovels.tsx:146-148` is **not** in the i18n
  catalog — Tauri rewrite should add a key.
- Long-press preview pushes into `ReaderStack > Novel`. Make sure the
  Tauri router allows that nested push (Novel detail must accept a
  raw `{ name, path, pluginId, cover }` payload, see
  `navigators/types/index.ts:96-104`).

### 4.11 Refs

- Migration.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/Migration.tsx>
- MigrationNovels.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationNovels.tsx>
- MigrationNovelList.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationNovelList.tsx>
- MigrationSourceItem.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationSourceItem.tsx>
- migrateNovel.ts: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/migrate/migrateNovel.ts>
- ServiceManager `MIGRATE_NOVEL`: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/ServiceManager.ts#L31-L268>
- i18n: `browseScreen.migration.*`
  (`strings/languages/en/strings.json:149-154`).

## 5. NewUpdateDialog

### 5.1 Purpose

Notify the user that a newer GitHub release exists, show its release
notes, and offer a one-tap download. Polling and gating live in the
hook (`useGithubUpdateChecker`); the dialog is a thin presenter.

### 5.2 Routes

- Not a screen. Rendered as a `Portal`+`Modal` overlay from
  `Main.tsx:110`:

  ```tsx
  {isNewVersion && <NewUpdateDialog newVersion={latestRelease} />}
  ```

  The modal sits inside `LibraryContextProvider > UpdateContextProvider`
  but outside `Stack.Navigator`, so it is visible regardless of the
  current screen.
- No deep link.

### 5.3 Layout

- `Portal > Modal` from `@components`.
- Header `Text`: `${common.newUpdateAvailable} ${tag_name}` (i18n
  `common.newUpdateAvailable` + raw release tag, e.g.
  `New update available v3.4.1`). 20pt, bold, 16pt bottom margin.
- Body: vertical `ScrollView` with **fixed height = window.height / 2**
  (`Dimensions.get('window').height / 2`), so the body never grows
  past 50% of the screen even for very long changelogs. Body text has
  `\n` collapsed to `\n\n` (markdown-ish double-newline) before
  rendering.
- Footer: row of two `Button`s, right-aligned, top margin 16:
  - `common.cancel` → close modal.
  - `common.install` → `Linking.openURL(downloadUrl)`.

### 5.4 Components

- `Portal` (Paper).
- `Modal`, `Button` (`@components`).
- `ScrollView` (`react-native-gesture-handler`).
- `Linking` (`expo-linking`).

### 5.5 States

- Local `newUpdateDialog: boolean` (initial `true`). The dialog
  unmounts when set false; nothing re-opens it within the same
  session.
- Hook-side state (`useGithubUpdateChecker.ts`):
  - `checking: boolean` — initial `true`.
  - `latestRelease: { tag_name, body, downloadUrl } | undefined`.

### 5.6 Interactions

- **Cancel** → close modal in-session. The hook does **not** retry
  during the same session because `LAST_UPDATE_CHECK` was already
  written to "now" when the release was fetched
  (`useGithubUpdateChecker.ts:60`).
- **Install** → opens `assets[0].browser_download_url` in the system
  browser. On Android this is the APK; on iOS upstream there is no
  iOS build, so this case doesn't arise. The dialog stays mounted
  until the user dismisses it.

### 5.7 Affecting settings

- `LAST_UPDATE_CHECK` (MMKV number, ms epoch). Updated only on a
  successful fetch with a parseable `tag_name`. Failed fetches do
  **not** update it — next session retries.
- No user-facing setting toggles update checks. There is no "disable
  update checker" preference. The check is unconditional.

### 5.8 Data

`useGithubUpdateChecker.ts:14-94`:

1. On mount: read `LAST_UPDATE_CHECK`. If less than 24h
   (`ONE_DAY_MS = 24 * 60 * 60 * 1000`) has passed, skip. Otherwise:
2. `fetch('https://api.github.com/repos/rajarsheechatterjee/lnreader/releases/latest')`.
   The repo is hardcoded to the upstream owner/repo
   (`useGithubUpdateChecker.ts:15-16`).
3. Validate response: `res.ok`, JSON parses, has `data.tag_name`.
4. Build `release = { tag_name, body, downloadUrl: assets[0]?.browser_download_url }`.
5. Persist `LAST_UPDATE_CHECK = Date.now()` and store `latestRelease`
   in state.
6. Compare via `newer(stripped(latestRelease.tag_name), package.json#version)`
   (`utils/compareVersion.ts`). Both strings have non-digit/dot
   characters stripped before comparison.
7. Return `{ isNewVersion, latestRelease }`. Dialog renders only when
   both are truthy (`Main.tsx:110`).

### 5.9 Edge cases

- **Offline / fetch error** → silently swallowed (catch-all
  `catch {}`). No toast, no retry within the same session, but
  `LAST_UPDATE_CHECK` is **not** updated, so the next launch retries.
- **GitHub rate-limit (HTTP 403/429)** → `res.ok` false → silent
  skip. `LAST_UPDATE_CHECK` not written.
- **Malformed JSON / missing `tag_name`** → silent skip.
- **`assets[0]` missing** → `downloadUrl = undefined`. Install button
  still renders (`Linking.openURL(undefined)`); on Android, `expo-
  linking` would throw. There is no nullability guard in the dialog.
  In practice every published release has an APK asset, so this hasn't
  been a problem in upstream.
- **Hardcoded repo URL** — forks/builds want to retarget this
  (`useGithubUpdateChecker.ts:15-16`). Not configurable.
- **Sub-1-day re-launches** — skipped because of `LAST_UPDATE_CHECK`.
  No way to force a check from inside the app.

### 5.10 Tauri-side notes

- The Tauri rewrite should reuse Tauri's official updater
  (`tauri-plugin-updater`) instead of hand-rolling this against
  GitHub's API. That plugin handles signature verification, delta
  updates, and OS-correct install flow. The "check at most once per
  24h" gate translates to the plugin's standard config.
- If you must keep the GitHub-API path (e.g. for self-hosted CI), the
  exact upstream contract is:
  - Endpoint: `https://api.github.com/repos/<owner>/<repo>/releases/latest`.
  - Trigger: at most once per 24h, on app launch.
  - Asset: `assets[0].browser_download_url`.
  - Compare: strip non-`/[\d.]/` chars, do per-segment numeric
    comparison.
  - Storage: single MMKV number `LAST_UPDATE_CHECK`.
- The body's `\n → \n\n` transformation is upstream's poor-man's
  markdown spacing. If the rewrite includes a real markdown renderer
  (e.g. `react-markdown` or upstream's existing one), drop this hack
  and render the raw release body.
- The dialog must render outside the router (currently between the
  context providers and the navigator) so it appears on top of any
  active screen. In Tauri / web, render it at the application root
  with appropriate z-index.

### 5.11 Refs

- NewUpdateDialog.tsx: <https://github.com/lnreader/lnreader/blob/639a2538/src/components/NewUpdateDialog.tsx>
- useGithubUpdateChecker.ts: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/common/useGithubUpdateChecker.ts>
- compareVersion.ts: <https://github.com/lnreader/lnreader/blob/639a2538/src/utils/compareVersion.ts>
- Mount point: <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/Main.tsx#L107-L110>
- i18n: `common.newUpdateAvailable`, `common.cancel`, `common.install`
  (`strings/languages/en/strings.json:202,217,220`).

## 6. Tauri-side cross-cutting notes

These notes apply to all five surfaces above and are intentionally
collected in one place to avoid repetition.

### 6.1 MMKV → Tauri persistent storage

Every "remember this between launches" key in this document
(`IS_ONBOARDED`, `THEME_MODE`, `APP_THEME_ID`, `AMOLED_BLACK`,
`APP_USER_AGENT`, `<pluginId>_LocalStorage`, `<pluginId>_SessionStorage`,
`LAST_UPDATE_CHECK`) currently lives in MMKV. Pick **one** Tauri
substrate (likely `tauri-plugin-store`) and provide a single hook
shaped like `useMMKVBoolean` so the surface code in §1-§5 ports as
cleanly as possible — same key names, same reactive semantics.

### 6.2 In-app browser substrate

`WebviewScreen` (§2) and the hidden-WebView pipeline
([cloudflare-bypass.md](../plugins/cloudflare-bypass.md)) share the
same `WebviewWindow` substrate. The visible variant differs in:

- It is rendered inline inside the app shell (not a hidden window).
- It exposes navigation chrome (back/forward, refresh, share, open
  externally, clear cache).
- It mirrors `localStorage`/`sessionStorage` into MMKV when
  `webStorageUtilized === true`.

Build the visible flow on top of the same Rust factory used for the
hidden flow. The IPC / `eval` channel for the storage-mirror script is
the same shape (`window.<host-bridge>.postMessage(JSON.stringify(...))`).

### 6.3 Background task ordering for migration

`MIGRATE_NOVEL` enqueues `DOWNLOAD_CHAPTER` jobs as a side-effect (§4.8).
Both task names live in the same queue (`ServiceManager`). Make sure
the queue is FIFO per `BackgroundTaskMetadata.isRunning` slot, so the
chapter merge transaction commits before any of the spawned downloads
run. Upstream relies on `await sleep(1000)` between download enqueues
to space them out — keep that, or wire it through
`chapterDownloadCooldownMs` (see [settings/catalog.md §2](../settings/catalog.md)).

### 6.4 The onboarding gate is the first render gate

Before mounting any router or background services, read `IS_ONBOARDED`.
If false, render `OnboardingScreen` only. Do **not** initialise plugin
loading, library updates, the GitHub update checker, or any
background tasks until the gate flips. Upstream `Main.tsx:50-69`
guards `refreshPlugins()` and `UPDATE_LIBRARY` task on `isOnboarded`.

### 6.5 Update-prompt placement

`NewUpdateDialog` (§5) renders **above** the navigator (between
`UpdateContextProvider` and `Stack.Navigator`). In a Tauri/web setup,
that means top of the React tree, with high z-index, so the modal
covers any in-app screen including the in-app WebView. Verify on
WebViewScreen specifically — the underlying `WebView` element can
otherwise eat pointer events from the modal in some platforms.

### 6.6 String keys to preserve

Tauri rewrite should keep these i18n keys verbatim (so the existing
language packs in `strings/languages/` work without touch-up):

- `onboardingScreen.welcome | pickATheme | light | dark | system | complete`
- `webview.refresh | share | openInBrowser | clearData | dataDeleted`
  (and the unused-but-defined `clearCookies | cookiesCleared`).
- `statsScreen.title | titlesInLibrary | readChapters | totalChapters |`
  `unreadChapters | downloadedChapters | sources | genreDistribution |`
  `statusDistribution`
- `browseScreen.migration.selectSource | selectSourceDesc |`
  `dialogMessage | novelAlreadyInLibrary`
- `common.newUpdateAvailable | install | cancel`
- `notifications.MIGRATE_NOVEL`

### 6.7 UNKNOWNs

- The exact ordering rule when `MIGRATE_NOVEL` and a concurrently
  running `UPDATE_LIBRARY` both want to write to the same novel is
  not pinned down here — it relies on `ServiceManager`'s scheduler
  semantics, which are out of scope for this doc. UNKNOWN.
- Whether iOS / WKWebView cookies set by `WebviewScreen` are visible
  to plugin runtime `fetchApi` calls is verified in
  [cloudflare-bypass.md §10](../plugins/cloudflare-bypass.md) for the
  hidden flow — the visible flow inherits the same caveat. UNKNOWN
  for Tauri 2 specifically until tested in Sprint 2.
- The first-launch "what theme should be selected by default" is
  driven by whatever `useTheme()` returns when no MMKV value is set —
  upstream's default chain is in `src/theme/`. UNKNOWN whether this
  picks system-default or a fixed theme; check `useTheme` defaults
  during port.

## 7. References

- OnboardingScreen: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/onboarding/OnboardingScreen.tsx>
- ThemeSelectionStep: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/onboarding/ThemeSelectionStep.tsx>
- WebviewScreen: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/WebviewScreen.tsx>
- WebviewScreen Appbar: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/components/Appbar.tsx>
- WebviewScreen Menu: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/WebviewScreen/components/Menu.tsx>
- StatsScreen: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/StatsScreen/StatsScreen.tsx>
- StatsQueries: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/StatsQueries.ts>
- Migration: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/Migration.tsx>
- MigrationNovels: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationNovels.tsx>
- MigrationNovelList: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationNovelList.tsx>
- MigrationSourceItem: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/browse/migration/MigrationSourceItem.tsx>
- migrateNovel task: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/migrate/migrateNovel.ts>
- ServiceManager: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/ServiceManager.ts>
- NewUpdateDialog: <https://github.com/lnreader/lnreader/blob/639a2538/src/components/NewUpdateDialog.tsx>
- useGithubUpdateChecker: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/common/useGithubUpdateChecker.ts>
- compareVersion utility: <https://github.com/lnreader/lnreader/blob/639a2538/src/utils/compareVersion.ts>
- Plugin storage helpers: <https://github.com/lnreader/lnreader/blob/639a2538/src/plugins/helpers/storage.ts>
- Root navigator: <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/Main.tsx>
- More stack: <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/MoreStack.tsx>
- Route param types: <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/types/index.ts>
- Cross-doc: [cloudflare-bypass.md](../plugins/cloudflare-bypass.md)
  (visible-WebView fallback for unsolvable challenges).
- Cross-doc: [settings/catalog.md](../settings/catalog.md)
  (`IS_ONBOARDED`, `APP_USER_AGENT`, `chapterDownloadCooldownMs`).
- Cross-doc: [domain/model.md](../domain/model.md) (`inLibrary`,
  `novel_category`, novel/chapter cascade rules).
- Cross-doc: [more.md](./more.md) (Statistics entry point).
