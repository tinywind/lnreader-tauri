# History Tab

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/history/HistoryScreen.tsx:1-171`
> - `src/screens/history/components/HistoryCard/HistoryCard.tsx:1-130`
> - `src/screens/history/components/ClearHistoryDialog.tsx:1-61`
> - `src/screens/history/components/HistorySkeletonLoading.tsx:1-115`
> - `src/hooks/persisted/useHistory.ts:1-66`
> - `src/database/queries/HistoryQueries.ts:1-67`
> - `src/database/queries/ChapterQueries.ts:224-249` (progress writes the `readTime`-paired column)
> - `src/database/utils/convertDateToISOString.ts:1-14`
> - `src/database/schema/chapter.ts:20` (`readTime`), `src/database/schema/novel.ts:28` (`lastReadAt`)
> - `src/database/queryStrings/triggers.ts:21,34` (`Novel.lastReadAt = MAX(Chapter.readTime)`)
> - `src/navigators/BottomNavigator.tsx:23,103-111` (tab gating)
> - `src/hooks/persisted/useSettings.ts:41,48,156,163` (`incognitoMode`, `showHistoryTab`)
> - `src/screens/reader/hooks/useChapter.ts:67,264-272,319-330` (incognito suppresses history writes)

## 1. Purpose

Show the user's recently-read chapters as a chronological feed so they can resume reading with one tap, and let them clean up history (single row or all rows). The list is *one entry per novel* — the most recently read chapter of each novel — not one entry per chapter read (`HistoryQueries.ts:11-28`).

## 2. Routes / Entry points

- Bottom-tab `History`, registered in `src/navigators/BottomNavigator.tsx:103-111`. The tab is only mounted when `AppSettings.showHistoryTab` is true (default true; `useSettings.ts:163`).
- `tabPress` handler (`HistoryScreen.tsx:80-99`): if the user taps the already-focused History tab, the navigator preventDefaults the tab change and pushes `ReaderStack/Novel` for `history[0]` — i.e. tapping History again jumps straight to the most recently read novel.
- Card tap navigates to `ReaderStack/Chapter`; cover tap navigates to `ReaderStack/Novel` (`HistoryCard.tsx:34-66`).

## 3. Layout

Group-by-day list of recently-read chapters with novel cover.

- `SafeAreaView` (`excludeBottom`) wrapping a `SearchbarV2` and a `SectionList` (`HistoryScreen.tsx:101-156`).
- `SearchbarV2` placeholder `getString('historyScreen.searchbar')`, left icon `magnify`, right icon `delete-sweep-outline` opens the clear-all dialog.
- `SectionList` sections come from `groupHistoryByDate` (`HistoryScreen.tsx:47-72`): items are bucketed by `convertDateToISOString(item.readTime)` (year-month-day, local). Section header is `dayjs(date).calendar()` (e.g. `Today`, `Yesterday`, `Last Monday`, fallback to `MM/DD/YYYY`).
- Each row is a `HistoryCard` (`HistoryCard.tsx`):
  - 56x80 cover (`defaultCover` fallback) tappable to Novel screen.
  - Novel name, two-line clamped.
  - Subtitle: `Chapter <chapterNumber> • <readTime LT upper>` plus ` • <progress>%` when progress > 0 (`HistoryCard.tsx:74-81`).
  - Trailing `delete-outline` `IconButtonV2` removing this row only.

## 4. Major UI components

| Component | File | Role |
|---|---|---|
| `HistoryScreen` | `HistoryScreen.tsx:25-160` | Container; owns search state, dialog state, list rendering. |
| `SearchbarV2` | `@components` | Top searchbar with right-icon slot. |
| `SectionList` (RN) | `HistoryScreen.tsx:123-145` | Day-grouped list. |
| `HistoryCard` | `HistoryCard.tsx:23-93` | Row: cover + novel/chapter info + delete button. |
| `ClearHistoryDialog` | `ClearHistoryDialog.tsx:16-44` | `react-native-paper` Dialog confirming wipe (Cancel / OK). |
| `HistorySkeletonLoading` | `HistorySkeletonLoading.tsx:13-72` | Shimmer placeholder rows shown while `isLoading`. |
| `EmptyView` | `@components` | Shown when search/list yields zero rows; `(˘･_･˘)` icon plus `historyScreen.nothingReadRecently`. |
| `ErrorScreenV2` | `@components` | Shown when `useHistory().error` is set. |

## 5. States

- **Loading**: `useHistory().isLoading === true` → renders `HistorySkeletonLoading` (3-5 fake rows with random width date strips).
- **Error**: `useHistory().error` truthy → `ErrorScreenV2`.
- **Empty**: list empty → `EmptyView` with `historyScreen.nothingReadRecently`.
- **Loaded**: section list populated, sections sorted by `Chapter.readTime DESC` from the DB (`HistoryQueries.ts:26`).
- **Searching**: when `searchText` non-empty, list switches to `searchResults` filtered case-insensitively on `novelName` (`HistoryScreen.tsx:38-45,125`).
- **Clearing**: `ClearHistoryDialog` visible until user picks Cancel or OK; OK fires `clearAllHistory` then closes (`HistoryScreen.tsx:147-152`, `useHistory.ts:40-43`).

## 6. Interactions

- **Tap card** → resume in reader (`Chapter` route, `HistoryCard.tsx:34-46`).
- **Tap cover** → open Novel screen (`HistoryCard.tsx:49-66`).
- **Tap delete icon on a row** → `removeChapterFromHistory(chapter.id)` (sets `chapters.readTime = NULL`, `HistoryQueries.ts:47-56`).
- **Tap `delete-sweep-outline`** → `ClearHistoryDialog`. Confirming calls `deleteAllHistory()` which `UPDATE chapters SET readTime = NULL` for *all* rows then toasts `historyScreen.deleted` (`HistoryQueries.ts:61-66`). No multi-select / long-press is implemented in upstream — only the per-row delete and the global sweep.
- **Re-tap History tab when focused** → resume the most recent novel directly (`HistoryScreen.tsx:80-99`).
- **Search box** filters the in-memory list by novel name (no DB round trip).

## 7. Affecting settings

- `AppSettings.showHistoryTab` (default `true`, `useSettings.ts:48,163`): when `false`, `BottomNavigator.tsx:103-111` does not mount the History tab at all. Toggled from `SettingsAppearanceScreen.tsx:260-261`.
- `LibrarySettings.incognitoMode` (default `false`, `useSettings.ts:99,270`; the prompt's "AppSettings.incognitoMode" in fact lives on `LibrarySettings`): suppresses *writes* to history. The reader only calls `insertHistory(chapter.id)` and `updateChapterProgress` when `!incognitoMode` (`useChapter.ts:264-272,319-330`). The History tab itself ignores this flag — it always reads existing rows.
- `AppSettings.disableLoadingAnimations` (used by `HistorySkeletonLoading.tsx:14`): freezes the shimmer animation.
- `dayjs` calendar plugin + active locale govern section-header strings (`HistoryScreen.tsx:129`); the `LT` token in `HistoryCard.tsx:76` is a localized short time. Locale wiring is global (UNKNOWN exact init path inside this repo's dayjs setup).

## 8. Data this screen reads/writes

Reads (`HistoryQueries.ts:11-28`):

```sql
SELECT chapter.*, novel.pluginId, novel.name AS novelName,
       novel.path AS novelPath, novel.cover AS novelCover, novel.id AS novelId
FROM Chapter INNER JOIN Novel ON Chapter.novelId = Novel.id
WHERE Chapter.readTime IS NOT NULL
GROUP BY Chapter.novelId
HAVING Chapter.readTime = MAX(Chapter.readTime)
ORDER BY Chapter.readTime DESC;
```

`History` row shape: `ChapterInfo` plus `pluginId`, `novelName`, `novelPath`, `novelCover`, `readTime` (`database/types/index.ts:51-57`). After fetch, `useHistory.ts:19-38` post-processes each row: `releaseTime` is reformatted via `dayjs(...).format('LL')` and a missing `chapterNumber` is back-filled by `parseChapterNumber(novelName, name)`.

Writes:

- `insertHistory(chapterId)` — `UPDATE Chapter SET readTime = datetime('now','localtime')` (`HistoryQueries.ts:33-42`). Called from the reader (`useChapter.ts:319-323`) only when `!incognitoMode`.
- `deleteChapterHistory(chapterId)` — sets one row's `readTime = NULL` (`HistoryQueries.ts:47-56`).
- `deleteAllHistory()` — sets `readTime = NULL` for every Chapter row (`HistoryQueries.ts:61-66`).
- Side effect via SQL trigger: `Novel.lastReadAt = (SELECT MAX(readTime) FROM Chapter WHERE Chapter.novelId = Novel.id)` (`triggers.ts:21,34`). Library sort/filters consume `lastReadAt`; History does not query it directly.

`Chapter.progress` (`ChapterQueries.ts:224-233`) is written by the reader alongside `readTime` in the same un-incognito path and is rendered on the card (`HistoryCard.tsx:77-80`).

## 9. Edge cases / gotchas

- **Incognito**: reading in incognito does *not* update `Chapter.readTime` or `Chapter.progress`, so history never gains the row and `lastReadAt` does not advance. There is no UI hint inside History that incognito is active. The screen still happily shows pre-incognito rows.
- **`convertDateToISOString` is local-time, lossy**: it splits the SQLite `datetime('now','localtime')` string `YYYY-MM-DD HH:MM:SS` on `-`, takes the first 2 chars of the day component, and reconstructs a `Date` at midnight local before serializing back to ISO (`convertDateToISOString.ts:1-13`). All chapters read on the same calendar day fall in the same section regardless of timezone shifts; cross-DST midnights may stack into the wrong bucket. Reproduce this behavior in the Tauri port to keep section-grouping identical.
- **`dayjs(date).calendar()` requires the calendar plugin** to be registered globally; otherwise headers fall back to formatted dates (UNKNOWN where the plugin is registered in upstream — likely `App.tsx` or a dayjs init file).
- **`LT` time format depends on active dayjs locale** (`HistoryCard.tsx:76`); 12/24h cycle changes per locale. The `.toUpperCase()` is harmless for 24h locales but uppercases AM/PM in 12h locales.
- **One row per novel**: the `GROUP BY ... HAVING MAX(readTime)` collapses every previous chapter of a novel into a single most-recent row. Switching from chapter 12 to chapter 11 will re-time-stamp 11 and the history row jumps to chapter 11. Users can not browse a "chapters previously read" trail per novel from this screen.
- **Search is in-memory** on `searchResults` and only filters by `novelName` (case-insensitive substring) — chapter name / number is not searched (`HistoryScreen.tsx:38-45`).
- **`tabPress` shortcut** silently navigates away when re-tapping the History tab while focused. Implementing the same UX in Tauri requires equivalent re-click detection on the tab control.
- **No multi-select / long-press**: the prompt's spec mention of "long-press for actions" is not implemented in `639a2538`; only single-row delete and a global Clear-all exist. UNKNOWN whether a multi-select flow existed historically — current upstream has none.
- **No virtualization tuning**: `SectionList` is left at defaults. Very long histories (thousands of rows) rely on RN windowing. The Tauri port must add explicit virtualization (`@tanstack/react-virtual` or Mantine `ScrollArea` + virtualizer) because Mantine list/Stack does not virtualize.

## 10. Tauri-side notes

- **List**: Mantine has no SectionList equivalent. Build the data as `Array<{ date: string; data: History[] }>` (same shape as `groupHistoryByDate`) and render with a virtualizer (`@tanstack/react-virtual`) where each virtual row is either a sticky day header (`Text` styled like `theme.onSurface`) or a `HistoryCard`. Sticky headers can be done with `position: sticky` on the day header inside a single scroll container.
- **Card**: Mantine `Group` + `Image` (radius 4, 56x80) + two-line clamped `Text` (`lineClamp={2}`) + `Text c="dimmed"` for the subtitle + trailing `ActionIcon` for delete.
- **Searchbar**: reuse the same `SearchbarV2` analog already used elsewhere in the Tauri port; right-icon slot for `IconTrash` opening a Mantine `Modal` (replaces `react-native-paper` Dialog + Portal).
- **Confirmation dialog**: Mantine `Modal` with title `historyScreen.clearHistorWarning` and two `Button`s. Match the OK-then-dismiss order from `ClearHistoryDialog.tsx:22-25`.
- **Skeleton**: Mantine `Skeleton` (with `visible` plus `animate={!disableLoadingAnimations}`) replicating the row shape (3-5 rows, randomized date widths). Keep the same per-row layout so first-paint matches the loaded state.
- **Date grouping**: port `convertDateToISOString` verbatim (do not "improve" it — see gotcha above). Keep `dayjs` + `calendar` plugin and the active locale; ensure `dayjs/locale/<id>.js` is loaded matching the user's app locale.
- **Tab re-tap to resume**: the Tauri router needs equivalent "re-click on active tab" detection. With `react-router`/`@tanstack/router` add a `<NavLink>` `onClick` that checks `isActive` and navigates to the `Reader > Novel` route for `history[0]` instead of re-running the index route.
- **Incognito**: ensure the Tauri reader's progress/`readTime` writer respects `LibrarySettings.incognitoMode` so the History feed remains consistent across both apps.
- **Hot refresh**: upstream uses `useFocusEffect(getHistory)` (`useHistory.ts:50-54`) so the screen re-queries on every focus. In the Tauri port, refetch on route enter (e.g. `useEffect` keyed on the location pathname) or on a `chapter:read` event bus message emitted from the reader.

## 11. References

- Reader spec (writes the `readTime` consumed here): [`docs/reader/specification.md`](../reader/specification.md)
- Plugin catalog (provider IDs surfaced via `History.pluginId`): [`docs/plugins/catalog.md`](../plugins/catalog.md)
- Settings scaffolding: `AppSettings.showHistoryTab`, `LibrarySettings.incognitoMode` defined in `src/hooks/persisted/useSettings.ts:41-48,156-163,99,270` (upstream).
- Tab gating: `src/navigators/BottomNavigator.tsx:103-111` (upstream).
- DB triggers that mirror `Chapter.readTime` to `Novel.lastReadAt`: `src/database/queryStrings/triggers.ts:21,34` (upstream).
