# Updates Tab

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/updates/UpdatesScreen.tsx:1-181`
> - `src/screens/updates/components/UpdateNovelCard.tsx:1-242`
> - `src/screens/updates/components/UpdatesSkeletonLoading.tsx:1-108`
> - `src/components/Context/UpdateContext.tsx:1-32`
> - `src/hooks/persisted/useUpdates.ts:1-113`
> - `src/services/updates/index.ts:1-90` (`updateLibrary` task entry)
> - `src/services/updates/LibraryUpdateQueries.ts:1-269` (`updateNovel`)
> - `src/services/ServiceManager.ts:217-272` (UPDATE_LIBRARY dispatch), `:453-479` (deduped `addTask`)
> - `src/services/download/downloadChapter.ts:1-110` (cooldown consumer)
> - `src/hooks/persisted/useSettings.ts:11-30, 36-83, 151-191` (settings, default cooldown)
> - `src/database/queries/ChapterQueries.ts:604-621` (`getUpdatedOverviewFromDb`), `:623-...` (`getDetailedUpdatesFromDb`)
> - `src/navigators/Main.tsx:46-69` (launch trigger), `src/navigators/BottomNavigator.tsx:22-94` (tab visibility)

## 1. Purpose

Surface chapters that arrived in the user's library since the last library
update so the user can read or download them without opening each novel.
Acts as the read-side view for the `UPDATE_LIBRARY` background task and as
the user's manual trigger for that task.

## 2. Routes / Entry points

- Bottom tab `Updates` (registered in `BottomNavigator.tsx:94-110`, hidden
  when `AppSettings.showUpdatesTab` is `false`).
- Tapping the Updates tab while it is already focused does NOT refresh —
  it preempts navigation and pushes `MoreStack > TaskQueue` instead, so
  the user can watch the background queue
  (`UpdatesScreen.tsx:39-51`).
- Manual refresh: top-bar reload icon and pull-to-refresh, both call
  `ServiceManager.manager.addTask({ name: 'UPDATE_LIBRARY' })`
  (`UpdatesScreen.tsx:62-68, 137-145`).
- Auto-trigger on app launch when `AppSettings.updateLibraryOnLaunch` is
  on (`Main.tsx:61-69`).

## 3. Layout

Group-by-day list with novel cover thumbnails and chapter names.

- `SafeAreaView` wraps `SearchbarV2` + `SectionList`
  (`UpdatesScreen.tsx:53-149`).
- `SectionList` sections are calendar-day groups derived in JS from the
  flat `updatesOverview` array via a reduce that splits on
  `updateDate` boundaries (`UpdatesScreen.tsx:86-105`).
- Section header renders `dayjs(date).calendar()` (e.g. "Today",
  "Yesterday", "Last Friday") (`UpdatesScreen.tsx:81-85`).
- Optional list header shows "Library last updated: <relative time>"
  when `showLastUpdateTime` and `lastUpdateTime` are both set
  (`UpdatesScreen.tsx:75-79, 154-163`).

## 4. Major UI components

| Component | Source | Role |
|---|---|---|
| `SearchbarV2` | `UpdatesScreen.tsx:55-69` | Search by `novelName` substring + reload button |
| `SectionList` | `UpdatesScreen.tsx:73-146` | Day-grouped list, pull-to-refresh, empty view |
| `LastUpdateTime` | `UpdatesScreen.tsx:154-163` | Header showing `dayjs(lastUpdateTime).fromNow()` |
| `UpdateNovelCard` | `components/UpdateNovelCard.tsx` | Per-novel row; collapsed `ChapterItem` for 1 update, `List.Accordion` of chapters for >1 |
| `ChapterItem` | `screens/novel/components/ChapterItem.tsx` | Shared row; rendered with `isUpdateCard` flag (smaller text, no progress meta) |
| `UpdatesSkeletonLoading` | `components/UpdatesSkeletonLoading.tsx` | Shimmer fallback inside `<Suspense>` for accordion expansion |
| `EmptyView` | `UpdatesScreen.tsx:129-135` | "No recent updates" with kaomoji icon |
| `ErrorScreenV2` | `UpdatesScreen.tsx:70-72` | Replaces list when `useUpdates().error` is non-empty |

## 5. States

| State | Trigger | UI |
|---|---|---|
| Empty | `updatesOverview.length === 0` after load | `EmptyView` (`UpdatesScreen.tsx:129-135`) |
| Running (background fetch) | `UPDATE_LIBRARY` queued via `ServiceManager` | No in-screen spinner; progress is shown in the foreground notification + TaskQueue screen (`ServiceManager.ts:230-238`) |
| Error | `useUpdates().error` set in `getUpdates().catch` | `ErrorScreenV2` (`useUpdates.ts:77`, `UpdatesScreen.tsx:70-72`) |
| Loaded | `getUpdates()` resolved, `isLoading=false` | `SectionList` |
| Refreshing | `RefreshControl onRefresh` enqueues task | `RefreshControl` is hard-coded `refreshing={false}` (`UpdatesScreen.tsx:136-145`) — the spinner is dismissed immediately; long-running progress lives in the notification, not in-list |

`useFocusEffect` re-runs `getUpdates()` every time the tab gains focus
(`useUpdates.ts:81-90`), so once the background task finishes the user
sees fresh data the next time they tap into the tab.

## 6. Interactions

| Gesture | Effect |
|---|---|
| Pull-to-refresh | `ServiceManager.addTask({ name: 'UPDATE_LIBRARY' })` (`UpdatesScreen.tsx:136-145`) |
| Reload icon | Same as pull-to-refresh (`UpdatesScreen.tsx:62-68`) |
| Search text | Filters `updatesOverview` by `novelName.toLowerCase().includes(...)` before grouping (`UpdatesScreen.tsx:86-91`) |
| Tap chapter | Navigates to `ReaderStack > Chapter` with the parent novel (`UpdateNovelCard.tsx:93-111`) |
| Tap novel cover or accordion title | Navigates to `ReaderStack > Novel` (`UpdateNovelCard.tsx:113-125, 152-163`) |
| Tap download / delete glyph on `ChapterItem` | `downloadChapter` (enqueues `DOWNLOAD_CHAPTER` via `useDownload`) or `deleteChapter` from DB; on delete, refresh via `getUpdates` and `showToast` (`UpdatesScreen.tsx:107-128`, `UpdateNovelCard.tsx:69-91`) |
| Re-tap Updates bottom tab | Navigates to `MoreStack > TaskQueue` instead of refreshing (`UpdatesScreen.tsx:39-51`) |
| Long-press chapter | NOT wired in this screen — `UpdateNovelCard` does not pass `onSelectLongPress` to `ChapterItem` (`UpdateNovelCard.tsx:170-187, 196-208`). UNKNOWN whether this is intentional or a missing feature; the spec template implied it. |
| Mark read | NOT wired in this screen — there is no "mark read" affordance on Update rows (UNKNOWN if expected). Read state is updated only by opening the chapter in the reader. |

## 7. Affecting settings

All under `AppSettings` (MMKV key `APP_SETTINGS`,
`useSettings.ts:11, 36-83, 151-191`):

| Setting | Default | Effect |
|---|---|---|
| `showUpdatesTab` | `true` | Hides/shows the bottom tab entirely (`BottomNavigator.tsx:22-94`) |
| `updateLibraryOnLaunch` | `false` | Auto-enqueue `UPDATE_LIBRARY` on app start (`Main.tsx:61-69`) |
| `onlyUpdateOngoingNovels` | `false` | `updateLibrary` filters the library query to `status = 'Ongoing'` (`updates/index.ts:32-54`) |
| `downloadNewChapters` | `false` | When a new chapter row is inserted by `updateNovelChapters`, immediately enqueue a `DOWNLOAD_CHAPTER` task (`LibraryUpdateQueries.ts:122-131`) |
| `refreshNovelMetadata` | `false` | `updateNovel` also refetches cover/summary/author/genres/status (`LibraryUpdateQueries.ts:193-198`) — heavier, off by default |
| `chapterDownloadCooldownMs` | `1000` (`DEFAULT_CHAPTER_DOWNLOAD_COOLDOWN_MS`) | Sleep applied between sequential `DOWNLOAD_CHAPTER` tasks (`downloadChapter.ts:100`, resolved via `getChapterDownloadCooldownMs` at `useSettings.ts:24-30`) |

`SHOW_LAST_UPDATE_TIME` (separate MMKV bool, default `true`,
`useUpdates.ts:13, 16-26`) toggles the header label on this screen only.
UNKNOWN where this is exposed in settings UI — I did not find a toggle,
only the storage hook.

## 8. Data this screen reads/writes

Reads (via `UpdateContext` -> `useUpdates`):

- `getUpdatedOverviewFromDb` (`ChapterQueries.ts:604-621`): one row per
  `(novel, DATE(updatedTime))` joined to `novelSchema`, ordered newest
  first. Key field is `updatedTime` set by the writer below.
- `getDetailedUpdatesFromDb(novelId)` (`ChapterQueries.ts:623-...`):
  per-novel chapter list when an accordion expands, optionally filtered
  to downloaded chapters. Result is mapped to format `releaseTime` via
  `dayjs(...).format('LL')` and to fill missing `chapterNumber`
  (`useUpdates.ts:37-61`).
- MMKV `LAST_UPDATE_TIME` (string), `SHOW_LAST_UPDATE_TIME` (bool).

Writes:

- `LAST_UPDATE_TIME` is written from two places:
  - The background task itself when there is at least one library novel
    to update (`updates/index.ts:56-57`,
    `dayjs().format('YYYY-MM-DD HH:mm:ss')`).
  - The `getUpdates` reader, which fast-forwards the value to the
    newest `updateDate` it sees if the stored value is older
    (`useUpdates.ts:67-78`).
- Triggers `DOWNLOAD_CHAPTER` tasks (indirectly, via `useDownload`
  inside `UpdateNovelCard`).
- `deleteChapter(pluginId, novelId, chapterId)` removes a downloaded
  chapter from disk + DB and re-runs `getUpdates`
  (`UpdatesScreen.tsx:110-122`).
- The actual `chapter.updatedTime` column is written by the writer in
  `updateNovelChapters` using `datetime('now','localtime')` for both
  inserts and qualifying updates (`LibraryUpdateQueries.ts:114, 138`).

## 9. Edge cases / gotchas

- **Per-novel sleep is hard-coded.** `updateLibrary` does
  `await sleep(1000)` after each novel (`updates/index.ts:72`); only the
  per-chapter download cooldown is configurable via
  `chapterDownloadCooldownMs`. Plugin-specific delay is UNKNOWN — there
  is no `usePluginDownloadDelay` hook in this commit, despite the spec
  template referencing one.
- **`UPDATE_LIBRARY` is non-multiplicable.** `ServiceManager.addTask`
  drops a duplicate `UPDATE_LIBRARY` if one is already queued
  (`ServiceManager.ts:101-110, 453-460`). Repeated reload-icon taps are
  effectively a no-op until the running task finishes.
- **"Ongoing only" filter applies to category and global modes.** With a
  `categoryId` it goes through `getLibraryWithCategory(..., true)`;
  without it, it adds `status = 'Ongoing'` to `getLibraryNovelsFromDb`
  (`updates/index.ts:40-54`). Novels with `status != 'Ongoing'` (incl.
  `null`) are skipped silently.
- **Empty library shows a toast, not an error.** When no novels match,
  `showToast("There's no novel to be updated")` and the task ends
  successfully (`updates/index.ts:78-80`).
- **Cloudflare cancellation is queue-wide.** A CF error during
  `DOWNLOAD_CHAPTER` (which `UPDATE_LIBRARY` enqueues when
  `downloadNewChapters` is on) drains all pending `DOWNLOAD_CHAPTER`
  entries from the queue and emits `lnreader-cf-blocked` to surface a
  toast/banner via `BackgroundAlertHost`
  (`ServiceManager.ts:316-335, 347-350`). The library update itself is
  not cancelled — only chapter downloads.
- **Section grouping happens in JS on every render.** With many
  updates this is O(n) per keystroke in the searchbar
  (`UpdatesScreen.tsx:86-105`).
- **`RefreshControl` never spins.** `refreshing={false}` is hard-coded;
  the only feedback for a running update is the foreground notification
  and the TaskQueue screen (`UpdatesScreen.tsx:136-145`).
- **First focus is intentionally deferred.** `useFocusEffect` schedules
  `getUpdates` via `setTimeout(..., 0)` to avoid blocking the focus
  transition on a SQL roundtrip (`useUpdates.ts:81-90`).

## 10. Tauri-side notes

- **List/grouping**: TanStack Query against a `getUpdatedOverviewFromDb`
  equivalent. Group-by-day can stay client-side (matches upstream) or
  push into the SQL `GROUP BY DATE(updatedTime)` already used here.
- **Detailed expansion**: separate query keyed by `novelId`; show a
  Mantine `Skeleton` while pending (replaces `UpdatesSkeletonLoading` +
  `<Suspense>`).
- **List primitive**: Mantine `Accordion` for the multi-update case,
  plain row for single-update; reuse the Library/Novel `ChapterItem`
  equivalent with an `isUpdateCard` variant.
- **Refresh trigger**: keep "explicit user trigger only" — there is no
  background polling in upstream; the queue is owned by
  `ServiceManager`. Bridge to a Tauri command that enqueues
  `UPDATE_LIBRARY`. Re-tap-to-jump-to-TaskQueue is desktop-equivalent
  to "if the user clicks the already-active tab, take them to the
  running tasks page."
- **Pull-to-refresh** has no desktop analog; replace with the existing
  reload icon + a keyboard shortcut.
- **Search debouncing**: upstream filters per keystroke. On desktop with
  potentially larger libraries, debounce 100-200ms before re-grouping.
- **Cooldown plumbing**: surface `chapterDownloadCooldownMs` from the
  settings store; the per-novel 1000ms gap is hard-coded upstream and
  should stay constant unless we choose to expose it. See
  [`docs/settings/catalog.md`](../settings/catalog.md) for the full
  settings shape.

## 11. References

- Settings shape and defaults:
  [`docs/settings/catalog.md`](../settings/catalog.md) §2 `AppSettings`.
- Background-task queue contract:
  `src/services/ServiceManager.ts` (no dedicated doc yet — UNKNOWN, may
  warrant `docs/services/background-tasks.md`).
- DB columns referenced (`chapterSchema.updatedTime`, `novelSchema.*`):
  `src/database/schema/` (verbatim copy in the Tauri repo).
- Cloudflare-blocked event surface:
  [`docs/plugins/cloudflare-bypass.md`](../plugins/cloudflare-bypass.md).
- Backup round-trip for `LAST_UPDATE_TIME` and `APP_SETTINGS`:
  [`docs/backup/format.md`](../backup/format.md).
