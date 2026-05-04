# Novel Detail

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/novel/NovelScreen.tsx` (lines 1-403) — top-level screen, app bar, action bar, modals
> - `src/screens/novel/NovelContext.tsx` (lines 1-74) — wraps `useNovel` with safe-area + chapter-text cache
> - `src/screens/novel/components/NovelScreenList.tsx` (lines 1-593) — virtualized chapter list, FABs, refresh
> - `src/screens/novel/components/Info/NovelInfoHeader.tsx` (lines 1-531) — header (cover, status, summary, chapter count)
> - `src/screens/novel/components/Info/NovelInfoComponents.tsx` (lines 1-352) — `CoverImage` backdrop, `NovelThumbnail` cover-zoom portal, `NovelGenres`
> - `src/screens/novel/components/Info/ReadButton.tsx` (lines 1-58) — inline Resume/Start CTA
> - `src/screens/novel/components/NovelSummary/NovelSummary.tsx` (lines 1-92) — collapsible summary
> - `src/screens/novel/components/NovelScreenButtonGroup/NovelScreenButtonGroup.tsx` (lines 1-180) — action row (library, tracker, migrate, WebView)
> - `src/screens/novel/components/NovelAppbar.tsx` (lines 1-263) — top app bar with download/edit menus
> - `src/screens/novel/components/ChapterItem.tsx` (lines 1-231) — single row, also reused by Updates
> - `src/screens/novel/components/Chapter/ChapterDownloadButtons.tsx` (lines 1-159) — per-chapter download/delete affordances
> - `src/screens/novel/components/NovelBottomSheet.tsx` (lines 1-224) — Filter / Sort / Display tabs
> - `src/screens/novel/components/JumpToChapterModal.tsx` (lines 1-298) — number/name search + scroll-vs-open mode
> - `src/screens/novel/components/SetCategoriesModal.tsx` (lines 1-154) — category multi-select on long-press of library button
> - `src/screens/novel/components/EditInfoModal.tsx` — manual title/author/genres/status override
> - `src/screens/novel/components/DownloadCustomChapterModal.tsx` (lines 1-60+) — "Download next N" prompt
> - `src/screens/novel/components/PageNavigationBottomSheet.tsx`, `PagePaginationControl.tsx` — multi-page novel pager (chapters split across source pages)
> - `src/screens/novel/components/Tracker/TrackSheet.tsx` and siblings — tracker integration sheet
> - `src/hooks/persisted/useNovel.ts` (lines 1-695) — chapter loading, batch pagination, mutation helpers
> - `src/hooks/persisted/useNovelSettings.ts` (lines 1-147) — per-novel sort/filter/showChapterTitles
> - `src/database/queries/NovelQueries.ts` (lines 31-566) — `getNovelByPath`, `switchNovelToLibraryQuery`, `pickCustomNovelCover`, `updateNovelCategories`
> - `src/database/queries/ChapterQueries.ts` (lines 35-664) — `getPageChaptersBatched`, `getChapterCount`, `bookmarkChapter`, `markChaptersRead/Unread`, `deleteChapter(s)`, `getNovelChaptersByNumber/Name`
> - `src/services/download/downloadChapter.ts` (lines 1-110) — single-chapter background download task body
> - `src/navigators/types/index.ts` (lines 87-109) — `NovelScreenProps` and `ReaderStackParamList.Novel` route shape

## 1. Purpose

Single-novel detail page reached from anywhere a novel can be tapped (Library card,
Browse search hit, Updates feed, History feed, deep link). Three concurrent jobs:

- Render novel metadata (cover, author, status, genres, summary) and let the user
  add/remove the title from the library, set categories, edit overrides, kick off
  trackers, migrate to a different source, or jump to the source's WebView.
- Render the chapter list — sorted, filtered, virtualized, paginated for novels
  whose source splits chapters across pages (`pages` array, `getCustomPages`).
- Drive bulk chapter operations — download (next N / unread / all / custom),
  delete downloads, mark read/unread, mark previous read/unread, bookmark — and
  per-chapter tap → reader.

The screen is also the **only** place that mutates `inLibrary`, `NovelCategory`
membership, custom cover image, and the manual info override.

## 2. Routes / Entry points

Stack route `Novel` lives on the `ReaderStack` (a parent stack also hosting the
`Chapter` reader screen so they share `NovelContext` — see `NovelContext.tsx:23-36`).
`navigation.navigate('ReaderStack', { screen: 'Novel', params })` from anywhere.

Param shape — `ReaderStackParamList.Novel` (`navigators/types/index.ts:96-104`)
accepts either of two unions:

```ts
type NovelRouteParams =
  | { name: string; path: string; pluginId: string;
      cover: string | null; isLocal?: boolean | null }
  | Omit<NovelInfo, 'id'>; // full row when caller already loaded the novel
```

Behaviours triggered by the param shape:

- `'id' in params` → caller already loaded the row, `useNovel` skips refetch
  (`NovelContext.tsx:33-36`, `useNovel.ts:65-71`).
- Only `path` / `pluginId` known → `useNovel` calls `getNovelByPath` then falls
  through to plugin `fetchNovel` + `insertNovelAndChapters` if missing
  (`useNovel.ts:213-231`).
- `pluginId === 'local'` → local novel branch (no WebView/migrate buttons, no
  download/delete affordances, no source-refresh).
- `route.params.isLocal` is consumed only to draw the appbar on the early
  loading frame before `novel` is hydrated (`NovelScreen.tsx:289`).

## 3. Layout

```
+---------------------------------------------------------+
|  Appbar (transparent → tinted as you scroll past 50px)  |  ← NovelAppbar (NovelScreen.tsx:278-292)
|  ←  [export-epub] [share] [jump-to] [download▼] [⋮]    |
+---------------------------------------------------------+
|  ╔═════════════════════════════════════════════════╗   |
|  ║   ImageBackground = cover                        ║   |
|  ║   + 70 % theme.background overlay                ║   |  ← CoverImage / hideBackdrop kills this layer
|  ║   + LinearGradient(transparent → bg) bottom     ║   |
|  ║                                                  ║   |
|  ║   ┌────────┐  Title (4-line clamp)              ║   |
|  ║   │ cover  │  ✎  Author                         ║   |
|  ║   │ 100×150│  🎨 Artist                         ║   |
|  ║   │  thumb │  ⏱ Status • Plugin name           ║   |
|  ║   └────────┘                                     ║   |
|  ╚═════════════════════════════════════════════════╝   |
|                                                         |
|  [♡ Add/In library] [✓ Tracking] [⇅ Migrate] [🌐 Web] |  ← NovelScreenButtonGroup (Tracker hidden if no service, Migrate hidden when not in library or local, WebView hidden for local)
|                                                         |
|  Summary text (3-line clamp, pressable to expand)       |  ← NovelSummary (auto-expanded if not yet in library)
|       ⌄  ⌄  ⌄                                          |
|                                                         |
|  [chip] [chip] [chip]  ← horizontal genre row          |
|                                                         |
|  [   Resume / Start reading <chapter name>    ]         |  ← ReadButton, hidden when useFabForContinueReading=true
|                                                         |
|  ────────────────────────────────────────────────       |
|  N chapters                              [⇩ filter]    |  ← opens Filter/Sort/Display sheet
|                                                         |
|  Page 1   2 …  k   ←  → ⋯                              |  ← PagePaginationControl (only multi-page novels)
|                                                         |
|  ●  Chapter 1                              [↓]          |  ← ChapterItem rows (virtualized via LegendList, 64px each)
|     2026-01-04                                          |
|  ●  Chapter 2  ⌫  in-progress 42%          [✓]         |
|  …                                                      |
+---------------------------------------------------------+
                                          [▶ Resume] FAB  ← AnimatedFAB, only when useFabForContinueReading=true
                                          [↑]    FAB     ← scroll-to-top, shown after scroll > viewportHeight/2
```

Selection-mode top bar replaces the appbar with `[×] N selected [select-all]`
(`NovelScreen.tsx:293-313`) and the bottom shows an `Actionbar` with up to seven
icons (`NovelScreen.tsx:121-212`).

Z-order, top to bottom (all wrapped in a single `Portal.Host` at
`NovelScreen.tsx:275`):

1. Background container with `theme.background` (`NovelScreen.tsx:269-271`).
2. `SafeAreaView excludeTop` containing the `LegendList` whose first item is
   `NovelInfoHeader` and whose remaining items are `ChapterItem` rows.
3. `Portal` group 1 — appbar (or selection top bar). Uses `Portal` so the
   absolutely-positioned `Animated.View` floats above the list while still
   participating in safe-area math.
4. `Portal` group 2 — `Actionbar` and the delete-downloads `Snackbar`.
5. `Portal` group 3 — `JumpToChapterModal`, `EditInfoModal`, and
   `DownloadCustomChapterModal`, each gated on `novel ? ... : null`.
6. Inside `NovelScreenList`, the FABs (`scroll-to-top` and `Continue/Resume`)
   render after the list and before the bottom-sheet refs, so they sit above
   the chapter rows but below any open sheet/modal.

## 4. Major UI components

| Component | File:lines | Role |
|---|---|---|
| `Novel` | `NovelScreen.tsx:36-380` | Composition root. Owns `selected[]`, modal flags, snackbar, `headerOpacity` shared value. |
| `NovelContextProvider` | `NovelContext.tsx:19-68` | Wraps `useNovel(...)` so the chapter reader can read the same chapters/lastRead without duplicating MMKV listeners. Also caches chapter HTML in `chapterTextCache: Map<chapterId, string>` so reader prefetch is reusable. |
| `NovelAppbar` | `NovelAppbar.tsx:74-260` | Animated header that fades from transparent to `theme.surface2` via `interpolateColor(headerOpacity)`. Hosts share, jump-to, download menu (Next / Next 5 / Next 10 / Custom / Unread / All / Delete), overflow menu (Edit info / Edit cover), and an EPUB export button. Hides the download menu for local novels. |
| `NovelScreenList` | `NovelScreenList.tsx:56-570` | LegendList over `chapters[]` with `estimatedItemSize=64`, `recycleItems`, `drawDistance=1000`, `onEndReached → getNextChapterBatch`. Owns the bottom-sheet refs, FAB visibility, and pull-to-refresh. |
| `NovelInfoHeader` | `NovelInfoHeader.tsx:235-454` | Cover backdrop, title, three meta rows, button group, summary, genres, ReadButton, and the "N chapters / filter" footer. Heavy use of skeleton placeholders while `loading || fetching`. |
| `CoverImage` | `NovelInfoComponents.tsx:46-82` | `ImageBackground` + 70 % overlay + LinearGradient. Returns plain `<View>` when `hideBackdrop=true`. |
| `NovelThumbnail` | `NovelInfoComponents.tsx:86-134` | 100×150 cover thumbnail. Tap toggles fullscreen `Portal` with save/edit icon buttons (calls `pickCustomNovelCover` or `saveNovelCover` via SAF). |
| `NovelScreenButtonGroup` | `NovelScreenButtonGroup.tsx:65-152` | Library / Tracker / Migrate / WebView. Long-press on the library button opens `SetCategoryModal`. Hides Tracker when no tracker is connected (`useTracker`), hides Migrate when not in library or `isLocal`, hides WebView when `isLocal`. |
| `NovelSummary` | `NovelSummary.tsx:14-67` | Pressable card. `numberOfLines = 3` collapsed / `MAX_SAFE_INTEGER` expanded. Initial `isExpanded` is `!novel.inLibrary` (collapses by default once tracked). Falls back to `novelScreen.noSummary`. |
| `ReadButton` | `ReadButton.tsx:16-51` | Returns `null` when `useFabForContinueReading=true`. Otherwise renders a contained "Resume <name>" or "Start reading <name>" button using `lastRead ?? firstUnreadChapter`. |
| `ChapterItem` | `ChapterItem.tsx:29-185` | Pressable row, 64 px tall. Title color is `outline` (read), `primary` (bookmarked), `onSurface` (unread). Unread badge dot, optional bookmark icon on the left, optional progress text "Progress 42 %", optional release-time text, right-side `DownloadButton` (download / spinner / check menu with delete) hidden for local novels. |
| `DownloadButton` family | `Chapter/ChapterDownloadButtons.tsx:19-138` | Three states. `isDownloading` → `ActivityIndicator`. `isDownloaded` → check icon that opens a one-item Menu offering "Delete". Otherwise → arrow-down-circle. |
| `NovelBottomSheet` | `NovelBottomSheet.tsx:23-198` | 240 px snap-point bottom sheet with three tabs: **Filter** (downloaded / unread / bookmarked checkboxes via `cycleChapterFilter`), **Sort** (positionAsc/Desc, nameAsc/Desc), **Display** (sourceTitle vs chapterNumber). |
| `JumpToChapterModal` | `JumpToChapterModal.tsx:36-258` | Two switches: "Open chapter" (jump straight into reader vs scroll the list) and "Chapter name" (numeric vs text search). Number search uses `getNovelChaptersByNumber(novelId, position+1)`; text search uses `getNovelChaptersByName` and shows multi-result list. After scrolling, calls `loadUpToBatch(Math.floor(position/300))` so off-screen chapters get rendered before `scrollToIndex`. |
| `SetCategoryModal` | `SetCategoriesModal.tsx:26-126` | Multi-select checklist of all categories with current membership pre-checked (`getCategoriesWithCount(novelIds)`). OK calls `updateNovelCategories(novelIds, selectedIds)`. Edit button navigates to `MoreStack → Categories`. Reused by Library bulk select. |
| `EditInfoModal` | `EditInfoModal.tsx` | Manual override for name, author, artist, genres, status, summary stored on the local `Novel` row (not pushed back to source). |
| `DownloadCustomChapterModal` | `DownloadCustomChapterModal.tsx:19-60+` | Numeric stepper. Submits `chapters.filter(unread && !isDownloaded).slice(0, n)` to `downloadChapters`. |
| `PagePaginationControl` + `PageNavigationBottomSheet` | `PagePaginationControl.tsx`, `PageNavigationBottomSheet.tsx` | Only rendered when `pages.length > 1 || novel.totalPages > 1`. Numeric pager with ellipses; bottom sheet lists every page string. |
| `TrackSheet` and the dialogs in `Tracker/` | `Tracker/*` | AniList/MAL search, status, score, chapter-progress dialogs. Out of scope for v0.1 — `prd.md §3` cuts trackers. |

## 5. States

| State | Trigger | Visible difference |
|---|---|---|
| `loading` (no novel yet) | `useNovel.ts:67-71`, `NovelInfoHeader.tsx:338-339` | Skeleton title bar, skeleton meta rows, skeleton button group, skeleton chapter-count footer; FABs hidden; appbar download menu still rendered if `route.params.isLocal !== true`. |
| `fetching` (have novel, refreshing chapters) | `useNovel.ts:588-603` | Chapter list shows `ChapterListSkeleton` if currently empty; pull-to-refresh shows the spinner; `totalChapters` skeleton shimmer until `getChapterCount` resolves. |
| `loaded` | both flags false | Full UI; FABs respect `useFabForContinueReading`. |
| `error` (plugin fetch failed) | `useNovel.ts:215-217` throws → `NovelScreen.tsx` lets `Suspense` show loading; `getChapters` failure surfaces via `showToast(e.message)` (`useNovel.ts:594-602`). The screen does **not** have a dedicated empty-error UI — it stays on the skeleton until refresh succeeds. |
| `refreshing` (pull-to-refresh) | `NovelScreenList.tsx:250-266` | `RefreshControl` spinner. Toast "Updated <name>" on success / "Failed updating: …" on failure. |
| `chapter-selection-mode` | `selected.length > 0` | Top bar swaps to count + select-all; `Actionbar` slides up with up-to-seven icons; tapping a row toggles selection instead of navigating. |
| `category-modal-open` | Long-press on library button (`NovelScreenButtonGroup.tsx:104-105`) or bulk select | `SetCategoryModal` portal. Disabled while `novel.id === 'NO_ID'`. |
| `jump-modal-open` | App-bar `text-box-search-outline` | Modal with input, two switches, optional result list (300 px tall). |
| `cover-zoomed` | Tap on thumbnail | Full-screen `Portal` with save/edit icon buttons. Tap anywhere collapses. |
| `downloading-chapter` | row in `downloadingChapterIds: Set<number>` | Spinner replaces download icon. Effect at `NovelScreenList.tsx:114-130` auto-flips `isDownloaded=true` when the id leaves the set. |

## 6. Interactions

- **Tap chapter row** → if no selection, navigate to `ReaderStack > Chapter` with `{ novel, chapter }`. If selecting, toggle in `selected[]`.
- **Long-press chapter row** → enters selection mode; second long-press range-selects from the previously-selected chapter to the new one. Triggers `Haptics.impactAsync(Medium)` unless `disableHapticFeedback` is set (`NovelScreenList.tsx:191-232`).
- **Swipe down on list** → `RefreshControl` runs `updateNovel(pluginId, path, id, { downloadNewChapters, refreshNovelMetadata })` then `getNovel()` (`NovelScreenList.tsx:250-266`). For multi-page novels, the page-nav sheet has a per-page refresh too (`onRefreshPage`).
- **Selection actionbar** (in order, conditional — `NovelScreen.tsx:121-212`):
  1. `download-outline` — only when at least one selected chapter is **not** downloaded and novel is non-local.
  2. `trash-can-outline` — only when at least one selected chapter **is** downloaded and novel is non-local.
  3. `bookmark-outline` — always.
  4. `check` — when at least one selected chapter is unread.
  5. `check-outline` — when at least one selected chapter is read; also calls `updateChapterProgressByIds(ids, 0)` and `refreshChapters()`.
  6. `playlist-check` (mark previous read) / `playlist-remove` (mark previous unread) — only when exactly one chapter is selected, using its read state to pick.
- **Appbar buttons** (`NovelAppbar.tsx`):
  - Back.
  - `ExportNovelAsEpubButton` (kicks off background ServiceManager task).
  - `share-variant` → RN `Share.share({ message: resolveUrl(plugin, path, true) })`.
  - `text-box-search-outline` → JumpToChapterModal.
  - `download-outline` (non-local only) → menu: Next 1 / 5 / 10 / Custom / Unread / All / **Delete downloads** (delete uses `chapters.filter(c => c.isDownloaded)`).
  - `dots-vertical` → menu: **Edit info**, **Edit cover** (`pickCustomNovelCover` opens DocumentPicker → copies to `NOVEL_STORAGE/<plugin>/<id>/cover.png` and writes the URI back to the row, cache-busted with `?<timestamp>`).
- **Continue/Resume FAB** — only when `useFabForContinueReading && (lastRead || firstUnreadChapter)`. `lastRead` wins; falls back to first unread. Extended-FAB collapses when `currentScrollPosition > 0` (`NovelScreenList.tsx:148-162`).
- **Scroll-to-top FAB** — appears once `scrollY > screenHeight/2` (`NovelScreenList.tsx:158-159`).
- **Filter/Sort/Display sheet** — opens by tapping the chapter-count row OR the filter icon next to it. Sort options are `positionAsc`, `positionDesc`, `nameAsc`, `nameDesc` and the bottom sheet treats consecutive presses on the same row as a toggle (`NovelBottomSheet.tsx:78-104`).
- **Tracker button** — opens `TrackSheet` (AniList/MAL search and status). Hidden when `!useTracker().tracker`. v0.1 cut.
- **Migrate** — `navigate('MigrateNovel', { novel })`. Hidden when not in library or for local novels.
- **WebView** — `navigate('WebviewScreen', { name, url: novel.path, pluginId, isNovel: true })`. Hidden for local novels.
- **Title row** — single tap navigates to `GlobalSearchScreen` with `searchText = novel.name` (`NovelInfoHeader.tsx:266-272`); long-press copies the title to clipboard via `expo-clipboard`.
- **Library button long-press** — opens `SetCategoryModal` for this novel (`NovelScreenButtonGroup.tsx:104-105`).
- **Cover thumbnail tap** — toggles a fullscreen `Portal` overlay (`NovelInfoComponents.tsx:96-131`); save and edit `IconButton`s are positioned with `top: insets.top + 6` and `right: insets.right + 6/60` to clear the safe area. Tap the dimmed backdrop (`rgba(0,0,0,0.7)`) to dismiss.
- **Chapter row release-time + progress meta line** — release-time string is rendered by `dayjs(releaseTime).format('LL')` (locale long date, e.g., "January 4, 2026") at `useNovel.ts:166-170`. Progress is shown as `getString('novelScreen.progress', { progress })` only while the chapter is still unread (`ChapterItem.tsx:159-167`).
- **Header opacity tracking** — `headerOpacity` is a `SharedValue<number>` updated in `onScroll` as `y < 50 ? 0 : (y - 50) / 150` (`NovelScreenList.tsx:148-162`); `NovelAppbar` interpolates that into a background color from `transparent` to `theme.surface2`, giving a 150-px crossfade.
- **EPUB export** — `ExportNovelAsEpubButton` lives in the appbar action group; it dispatches a `ServiceManager` background task and is rendered conditionally only when a `novel` exists. v0.1 cut.

## 7. Affecting settings

`AppSettings` (see [`docs/settings/catalog.md §2`](../settings/catalog.md)):

- `defaultChapterSort` — fallback when the per-novel `NovelSettings.sort` is unset (`useNovel.ts:109-110`).
- `useFabForContinueReading` — switches between inline `ReadButton` and the floating `Resume`/`Start reading` FAB (`ReadButton.tsx:21,31`, `NovelScreenList.tsx:96, 555-565`).
- `disableHapticFeedback` — gates `Haptics.impactAsync` on the long-press selection trigger (`NovelScreenList.tsx:195`).
- `disableLoadingAnimations` — turns the linear-gradient shimmer on the chapter-count and skeleton bars into a flat color (`NovelInfoHeader.tsx:90-117, 138-161`).
- `hideBackdrop` — strips the `ImageBackground` + overlay + gradient and renders just a plain View (`NovelInfoComponents.tsx:61-62`).
- `downloadNewChapters` / `refreshNovelMetadata` — passed to `updateNovel` on pull-to-refresh (`NovelScreenList.tsx:251-256`).

`LibrarySettings` — `showDownloadBadges`, `showUnreadBadges` apply to **library cards**, not this screen; not consumed here.

`NovelSettings` (per-novel MMKV key, see [`docs/settings/catalog.md §1`](../settings/catalog.md)) — `sort?: ChapterOrderKey`, `filter: ChapterFilterKey[]`, `showChapterTitles?: boolean`. Mutated only via the bottom-sheet through `useNovelSettings`.

## 8. Data this screen reads/writes

**Reads:**

- `Novel` row by `(path, pluginId)` via `getNovelByPath` (`NovelQueries.ts:104-120`); on miss, calls `fetchNovel(plugin, path)` → `insertNovelAndChapters` then re-queries (`useNovel.ts:213-231`).
- Chapters in batches of 300 via `getPageChaptersBatched(novelId, sort, filter, page, batch)` (`ChapterQueries.ts:412-439`); total via `getChapterCount` (lines 398-410).
- First unread chapter via `getFirstUnreadChapter(novelId, filter, page)` (`ChapterQueries.ts:457-475`).
- MMKV: `NOVEL_PAGE_INDEX_PREFIX_<plugin>_<path>` (number), `NOVEL_SETTINGS_<plugin>_<path>` (object), `LAST_READ_PREFIX_<plugin>_<path>` (chapter object) — `useNovel.ts:43-97`.
- Available plugin metadata for plugin-name display (`NovelInfoHeader.tsx:256-262`).
- Tracker state via `useTrackedNovel(novel.id)`.

**Writes:**

- `Chapter.bookmark`, `Chapter.unread`, `Chapter.progress`, `Chapter.isDownloaded` via the wrapper hooks in `useNovel.ts:369-544` (`bookmarkChapters`, `markChaptersRead/Unread`, `markPreviouschaptersRead`, `markPreviousChaptersUnread`, `updateChapterProgress`, `deleteChapter(s)`).
- `Novel.inLibrary` via `switchNovelToLibraryQuery` (`NovelQueries.ts:126-210`) — also seeds `NovelCategory` with the default category (sort=1) and additionally `categoryId=2` ("Local") when `pluginId === 'local'`.
- `NovelCategory` rows via `updateNovelCategories(novelIds, categoryIds)` (`NovelQueries.ts:372-432`) — keeps the local-category row when `categoryId=2`.
- `Novel.cover` via `pickCustomNovelCover` (`NovelQueries.ts:335-353`) — copies the picked file to `NOVEL_STORAGE/<plugin>/<id>/cover.png`, writes the URI with a `?<timestamp>` cache-buster.
- Saved-cover via SAF (`NovelScreenList.tsx:314-365`) — copies the live cover into a user-picked directory; downloads first if it is an http(s) URL.
- `Novel` metadata refresh via `updateNovel` / `updateNovelPage` from `LibraryUpdateQueries`.
- Chapter HTML via the background `downloadChapter` task (`services/download/downloadChapter.ts:63-110`) — writes `index.html` plus inlined `i.b64.png` images into `NOVEL_STORAGE/<plugin>/<novelId>/<chapterId>/`, then flips `Chapter.isDownloaded` and sleeps `getChapterDownloadCooldownMs()` to throttle the queue.
- MMKV writes for per-novel sort/filter/showChapterTitles.

The screen does **not** push any local edits back to the source plugin.

**Storage layout** for downloaded chapters (`downloadChapter.ts:26-31, 63-103`):

```
NOVEL_STORAGE/
  <pluginId>/
    <novelId>/
      cover.png                 # written by insertNovelAndChapters / pickCustomNovelCover
      <chapterId>/
        .nomedia                # blank file so Android Gallery skips this folder
        index.html              # rewritten HTML where every <img src> points at file://.../<i>.b64.png
        0.b64.png, 1.b64.png    # one per inlined image, downloaded with the plugin's imageRequestInit
```

**`chapterTextCache`** — `NovelContext.tsx:42-44` exposes a `Map<chapterId, string | Promise<string>>` shared across the Novel screen and the Chapter reader. The reader stores resolved HTML keyed by chapter id so the next/previous chapter swipes have an instant render. The Novel screen itself does not read it but holds the reference so the cache survives re-renders of the route.

**Per-novel MMKV keys** (`useNovel.ts:43-97`, formatted `<PREFIX>_<pluginId>_<path>`):

| Prefix | Type | Use |
|---|---|---|
| `NOVEL_PAGE_INDEX_PREFIX` | number | Active page tab when the novel splits chapters across pages. Persists across launches per novel. |
| `NOVEL_SETTINGS` | `NovelSettings` JSON | Per-novel sort/filter/show-titles. |
| `LAST_READ_PREFIX` | `ChapterInfo` JSON | Last chapter the user opened. Drives Resume FAB and `ReadButton`. |

## 9. Edge cases / gotchas

- **Local novels** (`pluginId === 'local'`, `isLocal=true`): hide download menu, WebView, Migrate; chapter rows hide the `DownloadButton` since chapters are already in `NOVEL_STORAGE` (`NovelScreenList.tsx:500`, `ChapterItem.tsx:171-179`). Library toggle still works and a row is added to category id `2` (local-only category) by `switchNovelToLibraryQuery`.
- **Novel removed from source**: `fetchNovel` rejects → `useNovel.ts:215-217` throws → toast `getString('updatesScreen.unableToGetNovel')`; the row stays nil and the screen sticks on the loading state. There is no "this title is gone" empty UI. UNKNOWN: how to surface a permanent removal vs a transient network failure (RN code does not distinguish).
- **Chapter list with thousands of entries**: list uses `LegendList` (recycling, `drawDistance=1000`, `estimatedItemSize=64`). Loading is paged 300 at a time via `getPageChaptersBatched`; `onEndReached` triggers `getNextChapterBatch`. Jump-to-chapter handles unloaded targets by calling `loadUpToBatch(Math.floor(position/300))` before `scrollToIndex` (`JumpToChapterModal.tsx:88-99`).
- **Novel with multiple source pages**: `pages` is either derived from `novel.totalPages` or from `getCustomPages(novelId)` (a `SELECT DISTINCT page` over chapters) — `useNovel.ts:119-132`. Page index is persisted per `(plugin, path)` in MMKV. Pull-to-refresh refreshes the **current page**, not the whole novel; per-page refresh lives on `PageNavigationBottomSheet`.
- **`route.params` without an `id`**: header is rendered against a synthetic `routeNovel` with `id: 'NO_ID'` so the user gets the cover/title from the browse card immediately while `useNovel` is fetching. Buttons that need an id are gated on `novel.id !== 'NO_ID'` (`NovelScreenList.tsx:493, 523`).
- **Backdrop blur quality**: upstream uses `ImageBackground + alpha overlay + LinearGradient`, **no actual blur**. The optical effect is a darkened scaled-up cover. UNKNOWN: whether the Tauri rewrite should add a real `backdrop-filter: blur` — there is no upstream prior art, decision belongs to Sprint design.
- **Filter persistence**: `NovelSettings.filter` is per-novel; the AppSettings `defaultChapterSort` only affects the **default** when no per-novel sort is set. Switching pages does **not** reset filter/sort.
- **Download throttling**: a single `downloadChapter` background job sleeps `getChapterDownloadCooldownMs()` after every chapter (`downloadChapter.ts:100`) — see commit `639a2538` ("feat(downloads): make chapter download cooldown configurable"). The novel screen kicks jobs by calling `useDownload().downloadChapters(novel, chapters)`; the queue is owned by `ServiceManager`.
- **Auto-mark-downloaded effect**: `NovelScreenList.tsx:114-130` watches `downloadingChapterIds` and flips `isDownloaded=true` locally when an id leaves the set. The DB itself is updated by the worker (`downloadChapter.ts:93-97`); this effect just keeps the in-memory list in sync without a refetch.
- **Selection range**: long-press range expansion in `onSelectLongPress` (`NovelScreenList.tsx:191-232`) builds the range by **chapter id**, not by visible position. UNKNOWN: behaves correctly when sort is `nameDesc` and ids are not monotonically aligned with the visible order — likely produces non-contiguous visual selection.
- **`ReadButton` hidden while `useFabForContinueReading=true` even before the FAB exists**: when neither `lastRead` nor `firstUnreadChapter` resolves, the screen has no resume control until chapters load.
- **Snackbar for delete-on-unfollow**: removing a novel from the library while it has downloaded chapters triggers a snackbar offering "Delete" the downloads (`NovelInfoHeader.tsx:280-295`, `NovelScreen.tsx:332-342`). Dismissing keeps the files.
- **`NovelBottomSheet` prop drift**: `NovelScreenList.tsx:526-533` passes `sortAndFilterChapters`, `setShowChapterTitles`, `sort`, `filter`, `showChapterTitles` to `NovelBottomSheet`, but the component's declared props are `{ bottomSheetRef, theme }` (`NovelBottomSheet.tsx:18-21`) — the runtime values are read again via `useNovelSettings()` inside. UNKNOWN: whether the extra props are dead and can be dropped, or if they were left in by a half-finished refactor. The Tauri rewrite should rely on the hook only.

## 10. Tauri-side notes

| RN building block | Tauri replacement |
|---|---|
| `LegendList` (recycled) | `@tanstack/react-virtual` with `estimateSize: 64`, `overscan ~= 6`, item key = `chapterId`. Keep the 300-batch chunked load on `onEndReached`. |
| `react-native-paper` Appbar / FAB / Snackbar | Mantine `AppShell.Header` + `ActionIcon`s + `Affix`/custom FAB + `Notifications`. The translucent-on-scroll pattern is `Intersection`/scroll listener → `style={{ background: alpha }}`. |
| `Portal` + `Modal` + `BottomSheet` | Mantine `Modal` for jump-to / set-categories / edit-info / download-custom; `Drawer` (position="bottom") for filter/sort/display + page nav + tracker sheet. |
| `ImageBackground` + overlay + gradient | CSS: an `<img>` covered by `position: absolute; inset: 0; background: rgba(theme.bg, .7)` and a sibling `linear-gradient(transparent → bg)`. Add `backdrop-filter: blur(20px) saturate(120%)` if visual direction wants real blur (upstream does not have it — capture as design decision). |
| `expo-haptics` | `navigator.vibrate(20)` is a soft fallback on Android Chromium WebView. Most desktop targets have no haptics — gate on `disableHapticFeedback || !('vibrate' in navigator)`. |
| `expo-clipboard` | `navigator.clipboard.writeText`. |
| `expo-document-picker` | Tauri's `dialog.open({ multiple: false, filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','webp'] }] })` then `fs.copyFile` into the novel storage dir. |
| `StorageAccessFramework` save-to-folder | Tauri `dialog.save({ filters: [...] })` for the cover; `fs.writeBinaryFile` for the bytes. |
| `Animated.SharedValue` for header opacity | A `useScrollAreaOpacity` hook that reads `scrollY` from a ref + `requestAnimationFrame` to update a CSS variable; or just a CSS scroll-driven animation (`animation-timeline: scroll(...)`) on supported targets. |
| `MaterialCommunityIcons` | `@tabler/icons-react` mapping: `clock-outline → IconClock`, `check-all → IconChecks`, `fountain-pen-tip → IconPencil`, `palette-outline → IconPalette`, `arrow-down-circle-outline → IconCircleArrowDown`, `bookmark → IconBookmark`, `play → IconPlayerPlay`, `arrow-up → IconArrowUp`, `dots-vertical → IconDots`, `text-box-search-outline → IconFileSearch`, `share-variant → IconShare`, `download-outline → IconDownload`, `swap-vertical-variant → IconArrowsUpDown`, `earth → IconWorld`, `heart`/`heart-outline → IconHeart`/`IconHeart` (filled vs stroke). |
| `react-native-tab-view` (filter sheet tabs) | Mantine `Tabs`. |
| Per-novel MMKV `NOVEL_SETTINGS_<plugin>_<path>` | Same key shape stored via `@tauri-apps/plugin-store` or LocalStorage adapter — see [`docs/settings/catalog.md §1`](../settings/catalog.md). Keep the prefix so backups round-trip per [`docs/backup/format.md`](../backup/format.md). |

Sprint-relevant simplifications for v0.1 (per `prd.md §3`):

- Drop the entire `Tracker/` subtree and the third button slot.
- Drop `ExportNovelAsEpubButton` until the export pipeline lands.
- `MigrateNovel` is out of v0.1 — hide the button, keep the route reservation in the type tree.
- `useFabForContinueReading` defaults to `false` so `ReadButton` is the v0.1 baseline.

## 11. References

- [`docs/HANDOFF.md`](../HANDOFF.md) — overall handoff intent and version pinning.
- [`docs/settings/catalog.md`](../settings/catalog.md) — `AppSettings`, `LibrarySettings`, `NovelSettings` shapes referenced by §7.
- [`docs/domain/model.md`](../domain/model.md) — `Novel`, `Chapter`, `NovelCategory`, `Category` invariants.
- [`docs/screens/more.md`](./more.md) — Categories / Settings hand-off targets used by `SetCategoryModal`'s edit button.
- Upstream commit pin: `639a2538` (`https://github.com/lnreader/lnreader/blob/639a2538/<path>`).
