# Critical User Paths

> Sourced from upstream lnreader at commit 639a2538.
>
> Each journey below is a real user flow that must work end-to-end in
> the Tauri rewrite before we declare parity. These are the regression
> tests; if any of them break, we have a release-blocker.

## How to use this list

- Each journey has: **Preconditions**, **Steps**, **Expected outcome**, **Linked spec docs**.
- Steps are written from the user's POV with system reactions in `→` arrows.
- "Linked spec docs" link to the screen-or-domain doc that defines each step's behavior. Where a screen-level doc does not yet exist (the
  `docs/screens/` tree is intentionally empty per [HANDOFF.md](../HANDOFF.md)), the closest existing spec doc is linked.
- A step prefixed with `UNKNOWN:` means the step's behavior could not be confirmed from the upstream code at commit 639a2538 and needs
  product-owner clarification.

## Journey 1: Fresh install -> first read

Preconditions: blank install, no MMKV state, no SQLite rows.

Steps:

1. Launch app -> `useMMKVBoolean('IS_ONBOARDED')` is `false`, so `Main.tsx:73` short-circuits to `OnboardingScreen` -> theme picker shown.
2. Pick a theme in `ThemeSelectionStep` -> `MMKVStorage.set('IS_ONBOARDED', true)` and the navigation tree mounts.
3. Library tab opens by default with empty state because no novels exist yet.
4. Tap Browse tab -> `BrowseScreen` lands on the **Installed** tab, which is empty. Switch to the **Available** tab -> `AvailableTab` shows the empty-view CTA "No repositories yet. Add your first plugin repository to get started." with an "Add Repository" action.
5. Tap "Add Repository" -> navigates to `MoreStack > SettingsStack > RespositorySettings`. Tap the FAB "Add" -> modal accepts a URL matching `https?://.*plugins\.min\.json`. Submit -> `createRepository(url)` runs, `refreshPlugins()` fires.
6. Back on Browse -> Available tab now lists plugins. Tap install icon on one plugin -> `installPlugin` succeeds, plugin moves to Installed tab.
7. From Installed tab, tap a plugin -> `SourceScreen` (`BrowseSourceScreen`) loads the source catalog via `popularNovels(1)`.
8. Tap a novel -> `ReaderStack > Novel` opens, `NovelContextProvider` fetches via `parseNovel` and inserts the row.
9. Tap "Add to library" in the novel app-bar -> novel's `inLibrary` flips, default category attached.
10. Tap a chapter -> `ReaderStack > Chapter` opens, `parseChapter` fetches HTML, `WebViewReader` renders it.
11. Read to bottom -> `scrollend` posts `{type:'save', data: progress}` -> chapter `progress` is persisted; reading the last 95% marks the chapter read.
12. Back-navigate to Library -> the novel appears in the default category tab with unread/downloaded badges.

Expected: novel is visible in Library; History tab shows the chapter just read; Updates tab is still empty (no library update has run yet).

Linked: [reader/specification.md](../reader/specification.md) §1 §7, [plugins/contract.md](../plugins/contract.md) §1, [domain/model.md](../domain/model.md), [settings/catalog.md](../settings/catalog.md).

## Journey 2: Migrate from upstream lnreader (.zip restore, overwrite mode)

Preconditions: user has a `lnreader_backup_<datetime>.zip` produced by upstream, no library on the new install.

Steps:

1. Launch app -> finish onboarding theme step.
2. Go to More -> Settings -> Backup -> "Restore Backup" tile (overwrite mode).
3. `ServiceManager.addTask({name:'LOCAL_RESTORE', data:{mode:'overwrite'}})` -> background task starts, persistent notification shows progress.
4. File picker prompts -> user selects the upstream `.zip`. Picker copies file to cache (`keepLocalCopy`).
5. Task unzips outer archive -> finds `data.zip` and `download.zip` siblings.
6. `restoreData(CACHE_DIR_PATH, 'overwrite')` truncates current tables, replays `Category.json`, `Setting.json`, and each `NovelAndChapters/<id>.json` file.
7. `download.zip` extracted into `ROOT_STORAGE` so chapter HTML and images land at the upstream-compatible path.
8. Task finishes -> toast "Backup restored".
9. Library tab now lists every restored novel under the original categories with original reading progress and downloaded badges.
10. Open a previously-downloaded chapter -> `WebViewReader` renders from disk, no network call required.

Expected: full library, categories, downloaded chapters, reading progress, and per-novel reader settings round-trip from upstream without manual reconfiguration.

Linked: [backup/format.md](../backup/format.md) §1 §6, [domain/model.md](../domain/model.md), [settings/catalog.md](../settings/catalog.md) §1.

## Journey 3: Add to library, download N chapters offline, read offline

Preconditions: at least one plugin installed, novel detail open.

Steps:

1. From a novel detail screen, tap "Add to library" -> `inLibrary` flips, novel appears in Library.
2. Tap the appbar download menu -> pick "Download next 10" (`downloadChs(10)` filters undownloaded, slices first 10).
3. `useDownload.downloadChapters` enqueues 10 `DOWNLOAD_CHAPTER` tasks via `ServiceManager.addTask` (multiplicable task type).
4. Task queue runs each chapter: `parseChapter` -> `downloadFiles` writes `index.html` plus inline `<img>` files under `NOVEL_STORAGE/<pluginId>/<novelId>/<chapterId>/`. `chapterDownloadCooldownMs` throttles between chapters.
5. Persistent notification updates "Downloading <novelName>" with progress bar; chapter rows in NovelScreen flip their `isDownloaded` flag (badge turns green).
6. Disable network on device.
7. Open Library -> tap the novel -> tap a downloaded chapter.
8. Reader loads the chapter from local disk; images render via `file://` URLs rewritten by `downloadFiles`.
9. Read forward, swipe to next chapter -> next downloaded chapter loads without network.

Expected: full offline reading session works for the downloaded range; an attempt to advance into a non-downloaded chapter shows the standard plugin-fetch error.

Linked: [plugins/contract.md](../plugins/contract.md) §1, [reader/specification.md](../reader/specification.md), [settings/catalog.md](../settings/catalog.md) (`chapterDownloadCooldownMs`).

## Journey 4: Continue reading across window-size changes (DeX / freeform / desktop resize)

Preconditions: novel with at least one chapter started, device that supports resizable windows (Android freeform / DeX / desktop window).

Steps:

1. Open the chapter on phone form factor -> reader renders in scroll mode (`pageReader = false`).
2. Read to ~50% progress, confirm `scrollend` save posted at least once.
3. Move/snap the window to a larger freeform size or extend to DeX/external display.
4. Reader JS receives `window.resize` (debounced 150 ms) -> `layoutHeight`, `layoutWidth` re-read from `window.innerHeight/innerWidth` (NOT `screen.*`); chapter re-flows; existing scroll position preserved.
5. Switch reader to paged mode via the bottom sheet -> body class `page-reader` toggles, after 100 ms the layout is rebuilt and the prior scroll ratio is mapped to the matching page so position is not lost.
6. Resize again -> ResizeObserver on `chapterElement` re-runs `calculatePages()`; current page number stays valid.

Expected: reader UI fills the entire freeform/DeX/desktop window with no clamped width band; reading progress is preserved across every resize and mode toggle. (This is the upstream issue #1835 that motivated the rewrite; the new app must pass it by construction.)

Linked: [reader/specification.md](../reader/specification.md) §1 §2 §6 §7.

## Journey 5: Library update finds new chapters and (optionally) downloads them

Preconditions: at least one library novel that has gained chapters since the last fetch; `downloadNewChapters` setting toggled on.

Steps:

1. From Library tab top-bar menu tap "Update library" -> `ServiceManager.addTask({name:'UPDATE_LIBRARY'})`.
2. Task reads `APP_SETTINGS` -> `downloadNewChapters: true`, `refreshNovelMetadata`, `onlyUpdateOngoingNovels`.
3. Task iterates library novels via `getLibraryNovelsFromDb`. For each it calls `updateNovel(pluginId, path, id, options)` which fetches the source novel and inserts new chapter rows.
4. `LAST_UPDATE_TIME` MMKV key updated to current ISO.
5. Newly inserted chapters with `downloadNewChapters` enabled are enqueued as `DOWNLOAD_CHAPTER` tasks (one chapter at a time, 1 s sleep between novels).
6. Updates tab now shows a section grouped by date with the newly added chapters.
7. Open Updates tab -> `UpdatesScreen` lists the new entries; tap one -> Reader opens the new chapter, already downloaded if option was on.

Expected: the new chapters appear under today's section in Updates with correct novel grouping; library novel rows show updated unread/downloaded badges; update completes within the same time budget as upstream for an N-novel library.

Linked: [domain/model.md](../domain/model.md), [settings/catalog.md](../settings/catalog.md) (`APP_SETTINGS`).

## Journey 6: Cloudflare-protected source first access

Preconditions: a plugin pointing at a CF-protected site (e.g. one of the `cloudflare-bypass.md` reference sites). User has the plugin installed but has never browsed it on this device.

Steps:

1. Browse -> Installed -> tap the plugin -> `SourceScreen` calls `popularNovels(1)`.
2. `fetchApi` returns 403 / 503 with HTML body matching `Just a moment\.\.\.|cf_chl_opt|challenge-platform|cf-mitigated`.
3. Host detects the CF gate and routes to the hidden-WebView controller (Tauri rewrite: `cf_webview.rs`).
4. Hidden WebView navigates to the source URL invisibly; user sees a brief loading state but no Turnstile UI.
5. Once `cf_clearance` cookie appears (or DOM marker resolves), cookies are pumped from the WebView store into the `reqwest` cookie jar; hidden window closes.
6. Original `popularNovels(1)` request retries with the new cookies and succeeds.
7. Source catalog renders.
8. Subsequent calls during the session reuse the cookie jar; no further bypass round-trip.

Expected: user never sees a CF challenge dialog; first-call latency is bounded (target sub-3 s on warm connection); pending download tasks for the same source no longer get cancelled because of the bypass having succeeded.

Linked: [plugins/cloudflare-bypass.md](../plugins/cloudflare-bypass.md) §1.1 §1.3, [plugins/contract.md](../plugins/contract.md) §1.

## Journey 7: Global search across all sources

Preconditions: at least 3 plugins installed, network available.

Steps:

1. From Browse tab, tap the searchbar `book-search` icon (or tap the Browse tab while focused, which navigates straight to `GlobalSearchScreen`).
2. Type a query -> `useGlobalSearch` runs `searchNovels(query, 1)` against every installed plugin in parallel; progress bar at top reflects completed/total.
3. Results render grouped by source. Toggle "Has results" chip -> sources with zero hits collapse out.
4. Tap a result -> Novel detail opens; novel is fetched/inserted via `parseNovel`.
5. Hit Library searchbar with the same query and tap the global-search button -> jumps back into `GlobalSearchScreen` with the query preserved.

Expected: every installed plugin is queried, slow plugins do not block fast ones, results stream in. Plugins that throw degrade gracefully (their group shows the error, the search continues).

Linked: [plugins/contract.md](../plugins/contract.md) §1 (`searchNovels`).

## Journey 8: Mark a long range of chapters as read in bulk

Preconditions: novel with 100+ chapters in library, none read.

Steps:

1. Open novel detail.
2. Long-press chapter row 50 -> selection mode activates, appbar replaced by selection appbar showing `1`.
3. Long-press chapter row 1 -> single selection. Tap `playlist-check` (mark previous as read) action -> `markPreviouschaptersRead(1)` flips chapter rows 1..50 to `unread = false`.
4. Selection clears, chapter list refreshes; novel `chaptersUnread` count updates accordingly.
5. Alternative: in selection mode, tap "select all" appbar action -> all chapters selected; tap `check` icon -> `markChaptersRead(selected)` runs across all of them in one DB transaction.

Expected: bulk mark-as-read scales without lag for 1k+ chapter novels (drizzle batched update, single UI re-render); History tab does NOT receive bulk-marked chapters as separate rows (only actual reads create history entries).

Linked: [domain/model.md](../domain/model.md), [reader/specification.md](../reader/specification.md) §7.

## Journey 9: Bookmark a chapter and jump to it later

Preconditions: novel with several chapters, user is browsing the chapter list.

Steps:

1. Long-press a chapter -> selection mode. Tap `bookmark-outline` action -> `bookmarkChapters(selected)` flips `chapter.bookmark` to true.
2. Selection clears; the bookmark icon now shows on that chapter row.
3. Days later, open the same novel -> tap appbar `Jump to chapter` icon -> `JumpToChapterModal` opens.
4. Toggle "By chapter name" mode (or use number mode); type the chapter name -> matching results listed.
5. Alternative: enable a bookmarks-only filter (UNKNOWN: confirm whether upstream's chapter list filter sheet exposes bookmarks-only at 639a2538 — check `LibraryBottomSheet` source).
6. Tap the bookmarked chapter -> `navigation.navigate('Chapter', {novel, chapter})` opens the reader at that chapter.

Expected: bookmark survives app restart, library-update operations, and backup round-trip; Jump-to-chapter list is responsive even on 1k+ chapter novels (uses lazy `loadUpToBatch`).

Linked: [domain/model.md](../domain/model.md), [backup/format.md](../backup/format.md) §6.

## Journey 10: Switch reader from scroll to paged mid-chapter without losing place

Preconditions: a chapter open in scroll mode, scrolled to ~40% progress.

Steps:

1. While reading, tap the center third (`y` in 0.33..0.66) -> reader chrome appears.
2. Tap the footer settings icon -> `ReaderBottomSheet` opens to the Reader tab.
3. Switch to General tab -> toggle "Page reader" -> `chapterGeneralSettings.pageReader = true`.
4. Reader JS reaction: body class `page-reader` added; after 100 ms the layout is rebuilt; current scroll ratio `(window.scrollY + layoutHeight) / chapterHeight` mapped to the matching paged-mode page index.
5. Reader chrome auto-hides; user is now on the same chunk of text in paged mode.
6. Tap left/right thirds -> page navigation via the upstream `detectTapPosition` rules works as expected.
7. Toggle paged mode off -> reader returns to scroll mode; existing chunk maps back to the equivalent scrollY.

Expected: position is conserved across every paged<->scroll toggle; chrome visibility is independent of the toggle; ResizeObserver does not double-fire during the rebuild.

Linked: [reader/specification.md](../reader/specification.md) §1 §3 §4 §6 §7.

## Journey 11: Change reader theme/font; settings persist across chapter navigation

Preconditions: user is reading any chapter.

Steps:

1. Open `ReaderBottomSheet` Reader tab.
2. Pick a different reader theme via `ReaderThemeSelector` -> CSS variable `--readerSettings-theme` and `--readerSettings-textColor` rewritten by the JS reaction; chapter background and text color update live.
3. Adjust `TextSizeSlider` -> `--readerSettings-textSize` updates; in paged mode `calculatePages()` re-runs (debounced via ResizeObserver) so total pages and current page index stay valid.
4. Pick a font via `ReaderFontPicker` -> JS loads the font face from `assets/reader-fonts/<fontFamily>.ttf` (Tauri rewrite serves this from the bundled assets dir); body font family applied.
5. Tap next-chapter footer button -> Reader screen mounts the next chapter; `CHAPTER_READER_SETTINGS` MMKV key already updated, so the new chapter loads with the new theme/font without flashing the default.
6. Force-quit and relaunch the app, reopen any chapter -> the same theme/font are applied (settings restored from MMKV).

Expected: settings round-trip via backup as part of `Setting.json` (`CHAPTER_READER_SETTINGS` key); per-novel overrides at `<novelId>` MMKV key shadow the global value when present.

Linked: [reader/specification.md](../reader/specification.md) §9 §12, [settings/catalog.md](../settings/catalog.md) §1.

## Journey 12: Backup -> write `.zip`, transfer to another device, restore

Preconditions: source device has a populated library with downloaded chapters; destination device has a clean install.

Steps:

1. On source device: More -> Settings -> Backup -> "Create backup". `ServiceManager.addTask({name:'LOCAL_BACKUP'})`.
2. Task `prepareBackupData(CACHE_DIR_PATH)` writes `Version.json`, `Category.json`, `Setting.json`, and `NovelAndChapters/<id>.json` files to cache.
3. Task `NativeZipArchive.zip(ROOT_STORAGE, CACHE_DIR_PATH/download.zip)` archives downloaded chapter files.
4. Task `NativeZipArchive.zip(CACHE_DIR_PATH, CACHE_DIR_PATH.zip)` archives cache into final backup zip.
5. `saveDocuments` invokes the native file picker -> user picks a destination (Android SAF document tree on mobile, normal dialog on desktop). File saved as `lnreader_backup_<YYYY-MM-DD_HH_mm>.zip`.
6. Transfer the file to destination device (USB / cloud / direct share).
7. On destination device: More -> Settings -> Backup -> "Restore Backup" -> select the file. Restore runs as in Journey 2.

Expected: the round-trip is byte-exact for `data.zip` member set; library content, categories, settings, downloaded chapters, and reading progress all survive. The `.zip` is also valid for the upstream React-Native lnreader app (bidirectional compatibility).

Linked: [backup/format.md](../backup/format.md) §1 §2 §3 §4 §6.

## Journey 13: Self-hosted backup target round-trip

Preconditions: user has configured a self-host endpoint via Backup -> Self-host modal (URL + headers stored under `SELF_HOST_BACKUP` MMKV key, intentionally excluded from backup zip per [settings/catalog.md](../settings/catalog.md)).

Steps:

1. From Backup screen, open the Self-host modal -> enter URL and headers, save -> `SELF_HOST_BACKUP` MMKV updated.
2. Trigger `SELF_HOST_BACKUP` task -> the same `prepareBackupData` + zipping path runs; final zip is HTTP PUT (or POST per upstream `selfhost/index.ts`) to the configured URL.
3. Task notification reports "Uploading...". Server stores the file.
4. Wipe the local app or move to a new device with the same self-host configuration entered.
5. Trigger `SELF_HOST_RESTORE` task with `mode: 'overwrite'` -> task downloads the latest archive from the configured URL, writes to cache, then runs the same `restoreData` path as Journey 2.
6. Library reappears.

Expected: lossless round-trip equivalent to Journey 12; user credentials (`SELF_HOST_BACKUP` headers) are NEVER serialized into the backup zip itself.

Linked: [backup/format.md](../backup/format.md), [settings/catalog.md](../settings/catalog.md) §1 (`SELF_HOST_BACKUP` excluded).

## Journey 14: Add a new repository URL, install and uninstall a plugin, re-install

Preconditions: at least one repository already configured.

Steps:

1. More -> Settings -> Repositories -> tap FAB Add -> enter a second repository URL matching `https?://.*plugins\.min\.json` -> `createRepository` succeeds, `refreshPlugins` runs.
2. Browse -> Available tab now lists plugins from both repositories; languages grouped by header.
3. Tap install on plugin A -> `installPlugin(A)`; toast confirms; plugin A moves to Installed.
4. Browse -> Installed -> long-press plugin A -> uninstall (or use the plugin's row menu) -> plugin removed from MMKV plugin map and disk cache invalidated.
5. Library entries that were sourced from plugin A still exist but show a "plugin missing" affordance when opened (their `pluginId` no longer resolves via `getPlugin`).
6. Re-install plugin A from Available tab -> `installPlugin` writes the new module; existing library novels resolve again with no data loss.
7. Deep link: send `lnreader://repo/add` to the app -> `Main.tsx` linking config routes to `MoreStack > SettingsStack > RespositorySettings`. UNKNOWN: confirm at 639a2538 whether the deep link auto-opens the Add Repository modal or only navigates to the screen — the `linking.config.screens` block routes to the screen, but the `route.params?.url` effect in `SettingsRepositoryScreen` only acts when the URL is passed as a param, not implicitly.

Expected: install/uninstall is idempotent; cache invalidation is correct (no stale plugin code on re-install); deep link reaches the repo settings screen; existing library entries survive plugin uninstall.

Linked: [plugins/contract.md](../plugins/contract.md), [domain/model.md](../domain/model.md).

## Journey 15: Migrate a single novel from source A to source B

Preconditions: novel exists in library under plugin A; plugin B installed; plugin B carries the same novel under a different path.

Steps:

1. Browse -> tap migration icon `swap-vertical-variant` -> `MigrationScreen` lists installed plugins that have at least one library novel.
2. Tap plugin A -> `SourceNovels` screen shows novels currently in library from plugin A.
3. Pick the novel to migrate -> `MigrateNovel` screen prompts for the matching novel on plugin B (search + select).
4. Confirm -> `ServiceManager.addTask({name:'MIGRATE_NOVEL', data:{pluginId: B.id, fromNovel, toNovelPath}})`.
5. Task `migrateNovel`:
   - fetches B's novel via `parseNovel` if not present, inserts the row.
   - copies metadata fields (`cover`, `summary`, `author`, ...) preferring source A where set.
   - reassigns `NovelCategory` rows from A to B.
   - deletes A's novel row.
   - for chapters with matching `chapterNumber`, copies `bookmark`, `unread`, `readTime`, `progress` from A to B.
   - re-enqueues a `DOWNLOAD_CHAPTER` task per A-downloaded chapter so files migrate to B's storage path (1 s sleep between).
   - moves the `LAST_READ_PREFIX` MMKV pointer to the matching B chapter.
6. Library refresh -> the novel now appears under plugin B with categories, bookmarks, and progress preserved.

Expected: bookmarks/progress for chapters that match by number are preserved; mismatched chapters fall through silently; previously downloaded chapters re-download against plugin B (not retained from A); per-novel reader settings carry over via `NOVEL_SETTINGS_PREFIX`.

Linked: [domain/model.md](../domain/model.md), [plugins/contract.md](../plugins/contract.md) §1.

## Journey 16: Reader fullscreen mode toggle

Preconditions: chapter open with reader chrome visible.

Steps:

1. Open `ReaderBottomSheet` -> General tab -> toggle "Full screen mode" -> `chapterGeneralSettings.fullScreenMode = true`.
2. `useFullscreenMode` hook: hides the React Native `StatusBar` and `react-native-edge-to-edge` `SystemBars`. (Tauri rewrite: hide window decorations on desktop via `WindowExt::set_decorations(false)`; equivalent SystemBars plugin call on Android/iOS.)
3. Reader content renders edge-to-edge; tap the center third toggles chrome but the system bars stay hidden.
4. Tap the back button or system back gesture -> `navigation.addListener('beforeRemove', ...)` restores the system status bar, navigation bar color (`expo-navigation-bar` / `setBarColor`), and reader-exit theme bar colors.
5. Re-enter the reader -> fullscreen state restored from setting.

Expected: fullscreen toggle is symmetric (entering and exiting do not leave bar state in an inconsistent shade); on desktop the window chrome hides/restores cleanly without resizing the WebView region.

Linked: [reader/specification.md](../reader/specification.md) §11.

## Journey 17: Plugin throws on parseChapter — graceful failure UX

Preconditions: a plugin that fails on a specific chapter path (HTTP 404, scrape mismatch, or thrown error inside `parseChapter`).

Steps:

1. Open the chapter -> `useChapterContext` calls `parseChapter(chapter.path)` which throws.
2. Reader screen displays `ErrorScreenV2` with the error message and two actions: `refresh` (retry) and `WebView` (`navigation.navigate('WebviewScreen', {url: chapter.path, pluginId})`).
3. Tap WebView -> `WebviewScreen` loads the chapter URL in a visible WebView so the user can read it directly. (Tauri rewrite: opens an embedded webview route or external `tauri-plugin-shell.open` per platform.)
4. Tap retry -> `refetch()` runs `parseChapter` again; if it now succeeds (transient error), the reader renders normally.
5. If the failure is during a `DOWNLOAD_CHAPTER` background task and the error is detected as `Cloudflare` (regex `^Cloudflare/i`), the manager drains queued downloads and emits `lnreader-cf-blocked` -> snackbar via `BackgroundAlertHost` shows `"<error> (N pending downloads cancelled)"`.

Expected: a single broken chapter never crashes the reader screen or aborts the whole queue (except the explicit Cloudflare drain case); the user has a recovery action available; the error message comes from the plugin, not a generic stack trace.

Linked: [plugins/cloudflare-bypass.md](../plugins/cloudflare-bypass.md) §1.3, [plugins/contract.md](../plugins/contract.md).

## Journey 18: App-update prompt (NewUpdateDialog) flow

Preconditions: app has been built with a version older than the latest GitHub release tag.

Steps:

1. Launch app, complete onboarding if needed.
2. `Main.tsx` mounts `MainNavigator` -> `useGithubUpdateChecker` hook fetches the latest GitHub release via the public API.
3. If `isNewVersion === true`, `NewUpdateDialog` portal renders inside the navigation tree showing tag name, release notes (markdown body split into paragraphs), and Cancel / Install buttons.
4. Tap Cancel -> dialog dismisses for this session; reopens on next launch.
5. Tap Install -> `Linking.openURL(newVersion.downloadUrl)` opens the release asset URL in the system browser. (Tauri rewrite: `tauri-plugin-shell.open(url)`.)
6. UNKNOWN: whether the rewrite should ship its own update channel or continue piggybacking on GitHub Releases — open question, see `prd.md §13.1` style decisions.

Expected: dialog shows once per launch on stale versions; release notes render with double-newline paragraphing; download URL opens externally rather than navigating in-app.

Linked: (no existing handoff doc) — this flow is a wrapper around the GitHub release feed and is not codified beyond `Main.tsx` and `NewUpdateDialog.tsx`.

## Performance budgets

Targets the rewrite must meet on a 6-year-old mid-range Android device (S23-class is overkill per `prd.md §10`):

| Surface | Budget | Notes |
|---|---|---|
| Cold start to Library (post-onboarding) | <= 2.5 s | Includes drizzle migrations + first library read. |
| Library tab scroll on 500-novel library | 60 fps sustained | Uses `LegendList` recycling upstream; rewrite must match. |
| Reader page transition (paged mode) | <= 16 ms per swipe end-of-frame | `transform: translateX` only; no layout thrash. |
| Reader scroll mode at 60 fps | <= 16 ms per frame | No JS work on `scroll`; only debounced `scrollend` saves. |
| Source list first paint after `popularNovels(1)` | <= 1.5 s on warm cookie jar | Excludes CF bypass round-trip. |
| CF bypass first call (cold) | <= 5 s | After cookies cached, subsequent calls behave like normal HTTP. |
| Backup `.zip` write for 200-novel library | <= 30 s on mid-range Android | Bottlenecked by zip + SAF write. |

## Cross-platform parity checks

- **Desktop window resize** — reader and library re-flow on every drag, no clamped width band; this is the original failure mode that triggered the rewrite. Verify on Windows, macOS, Linux at: 320, 768, 1024, 1440, 1920 widths.
- **Android freeform / DeX** — the bug that triggered the rewrite (upstream issue #1835) must be gone by construction; verify on a Galaxy device in DeX freeform and in stock multi-window.
- **iOS background download** — single chapter completes, but queued chapters pause when the app is backgrounded (matches upstream limitation). User-facing notification reflects pause state.
- **Deep link `lnreader://repo/add`** — opens the app and routes to `MoreStack > SettingsStack > RespositorySettings`. UNKNOWN: confirm whether the URL parameter auto-opens the Add Repository modal at 639a2538 or only deep-links to the screen.
- **System theme follow** — when `appTheme` is set to a system-following variant (UNKNOWN: confirm if 639a2538's theme catalog has an explicit "follow system" entry beyond the 9 named themes), the reader theme respects OS dark/light without restart.

## Out of scope (mirroring prd.md §3)

The following journeys are intentionally absent because the underlying features are dropped from the rewrite:

- TTS reading and lockscreen media controls (`expo-speech`, `NativeTTSMediaControl`).
- Volume-button page turn (`NativeVolumeButtonListener`).
- Google Drive backup (`@react-native-google-signin/google-signin`).

Any regression report against these features is closed as `wontfix` per `prd.md §3`.

## References

- Upstream lnreader at commit 639a2538: <https://github.com/lnreader/lnreader/tree/639a2538>
- [HANDOFF.md](../HANDOFF.md) — entry point to all handoff specs.
- [reader/specification.md](../reader/specification.md) — reader behavior contract.
- [plugins/contract.md](../plugins/contract.md) — plugin scraper contract.
- [plugins/cloudflare-bypass.md](../plugins/cloudflare-bypass.md) — hidden-WebView bypass.
- [backup/format.md](../backup/format.md) — backup zip wire format and restore semantics.
- [settings/catalog.md](../settings/catalog.md) — every persisted MMKV key and its default.
- [domain/model.md](../domain/model.md) — entities, relationships, lifecycles.
- `prd.md` — product requirements and out-of-scope cuts.
