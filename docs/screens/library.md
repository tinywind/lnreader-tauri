# Library + Categories

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/library/LibraryScreen.tsx`
> - `src/screens/library/SelectionContext.tsx`
> - `src/screens/library/hooks/useLibrary.ts`
> - `src/screens/library/constants/constants.ts`
> - `src/screens/library/components/LibraryListView.tsx`
> - `src/screens/library/components/LibraryNovelItem.tsx`
> - `src/screens/library/components/Banner.tsx`
> - `src/screens/library/components/LibraryBottomSheet/LibraryBottomSheet.tsx`
> - `src/screens/Categories/CategoriesScreen.tsx`
> - `src/screens/Categories/components/CategoryCard.tsx`
> - `src/screens/Categories/components/AddCategoryModal.tsx`
> - `src/screens/Categories/components/DeleteCategoryModal.tsx`
> - `src/screens/Categories/components/CategorySkeletonLoading.tsx`
> - `src/components/Context/LibraryContext.tsx`
> - `src/hooks/persisted/useSettings.ts` (LibrarySettings, AppSettings)
> - `src/hooks/persisted/useCategories.ts`
> - `src/database/queries/CategoryQueries.ts`
> - `src/database/queries/LibraryQueries.ts`
> - `src/database/queries/NovelQueries.ts` (`switchNovelToLibraryQuery`, `removeNovelsFromLibrary`)
> - `src/database/queries/ChapterQueries.ts` (`markAllChaptersRead`, `markAllChaptersUnread`)
> - `src/database/queryStrings/populate.ts` (system category seeding)
> - `src/navigators/BottomNavigator.tsx`, `src/navigators/MoreStack.tsx`, `src/navigators/types/index.ts`
> - `strings/languages/en/strings.json` (libraryScreen, categories)

For shared concepts referenced below, see (do NOT duplicate):
[`docs/HANDOFF.md`](../HANDOFF.md),
[`docs/reader/specification.md`](../reader/specification.md),
[`docs/plugins/contract.md`](../plugins/contract.md),
[`docs/plugins/cloudflare-bypass.md`](../plugins/cloudflare-bypass.md),
[`docs/backup/format.md`](../backup/format.md),
[`docs/settings/catalog.md`](../settings/catalog.md),
[`docs/domain/model.md`](../domain/model.md).

## 1. Purpose
The Library tab is the user's home for novels they have saved (in-library). It groups them into user-defined categories, supports filtering, sorting, three grid display modes plus a list mode, multi-select bulk actions, and a "resume reading" FAB. The Categories management screen lets the user add, rename, delete, and reorder the categories that drive the Library tabs.

## 2. Routes / Entry points
- **Library**: bottom-tab route, `Tab.Screen name="Library"` in `BottomNavigator.tsx:88-93`. Always visible (the only required tab). Navigation prop type: `LibraryScreenProps` = `CompositeScreenProps<MaterialBottomTabScreenProps<BottomNavigatorParamList,'Library'>, StackScreenProps<RootStackParamList>>` (`src/navigators/types/index.ts:42-45`). Param shape: `undefined` (no params).
- **Categories**: stack route inside `MoreStack`, `Stack.Screen name="Categories"` in `MoreStack.tsx:48`. Param shape: `undefined`. Reached via *More tab > Categories* (see [`docs/screens/more.md`](./more.md)).
- **Tab-press behavior** (`LibraryScreen.tsx:143-153`): pressing the Library tab while it is already focused intercepts `tabPress`, calls `e.preventDefault()`, and presents the filter/sort/display bottom sheet instead of re-navigating.

## 3. Layout

### Library tab

```
+--------------------------------------------------------------+
| SearchbarV2                                                  |  <- LibraryScreen.tsx:454-464
|  [magnify|close] [placeholder or "<n> selected"] [icons] [...] |
+--------------------------------------------------------------+
| Banner: cloud-off-outline  "Downloaded only"  (theme.primary)|  <- if downloadedOnlyMode
| Banner: incognito         "Incognito mode"   (theme.tertiary)|  <- if incognitoMode
+--------------------------------------------------------------+
| TabBar: scrollable, one tab per category                     |  <- LibraryScreen.tsx:189-222
|   "Default(12)"  "Reading(3)"  "Local"  "Webnovel(7)"  ...   |     hidden if categories.length===0
+--------------------------------------------------------------+
| Optional global-search button (when searchText non-empty):   |  <- LibraryScreen.tsx:251-263
|   [ Search for "<text>" globally ]                           |
+--------------------------------------------------------------+
|                                                              |
|  Novel grid / list (LibraryView -> NovelList)                |  <- LibraryListView.tsx
|  - DisplayModes.Comfortable: cover + 2-line title            |
|  - DisplayModes.Compact:     cover with title overlay        |
|  - DisplayModes.CoverOnly:   cover only                      |
|  - DisplayModes.List:        list rows                       |
|                                                              |
|  Pull-to-refresh -> ServiceManager UPDATE_LIBRARY            |
|                     (skipped for the Local category id=2)    |
|                                                              |
|  Empty: "Sigma(o_o)" + "Your library is empty..."            |
|        Action: Browse  (or Import EPUB on Local tab)         |
+--------------------------------------------------------------+
                                                       [ > Resume ] FAB
                                                       (if useLibraryFAB && history)
```

Selection-active overlay (`react-native-paper` `Portal` + `Actionbar`) sits above the bottom of the screen when `selectedNovelIds.length > 0` (`LibraryScreen.tsx:524-530`):

```
+--------------------------------------------------------------+
| [label-outline] [check] [check-outline] [delete-outline]     |
|   set categories  mark read  mark unread  remove from lib    |
+--------------------------------------------------------------+
```

The filter/sort/display bottom sheet is a tabbed `BottomSheet` with snap height 520 (`LibraryBottomSheet.tsx:257`):

```
+--------------------------------------------------------------+
| [ Filter ]  [ Sort ]  [ Display ]                            |
+--------------------------------------------------------------+
| (Filter)             (Sort)              (Display)           |
| [x] Downloaded       (asc/desc) Alphabetically  Badges       |
| [ ] Unread           (asc/desc) Last read         [x] Download badges |
| [ ] Started          (asc/desc) Last updated      [x] Unread badges   |
| [ ] Completed        (asc/desc) Downloaded        [ ] Show n. items   |
|                      (asc/desc) Total chapters  Display mode |
|                      (asc/desc) Unread            (o) Compact grid    |
|                      (asc/desc) Date added        ( ) Comfortable grid|
|                                                   ( ) Cover only grid |
|                                                   ( ) List   |
+--------------------------------------------------------------+
```

### Categories screen

```
+--------------------------------------------------------------+
| Appbar: <-  Edit categories                                  |  <- CategoriesScreen.tsx:78-82
+--------------------------------------------------------------+
| +--------------------------------------------------------+   |
| | drag  Default      [System]                  [edit X] |   |  <- id=1, system, edit/delete disabled
| | drag  Local        [System]                  [del  X] |   |  <- id=2, system, label hidden visually
| | drag  Reading                                [edit] [del] |   |  <- user category
| | drag  Re-read                                [edit] [del] |   |
| +--------------------------------------------------------+   |
|  (DraggableFlatList, drag handle on left, tap name to edit)  |  <- CategoryCard.tsx
+--------------------------------------------------------------+
                                                        [ + Add ] FAB
```

Empty state: `EmptyView` with icon `Sigma(o_o)` and `categories.emptyMsg` ("You have no categories. Tap the plus button to create one for organizing your library").

## 4. Major UI components

### Library

| Component | Role | Upstream file:lines |
|---|---|---|
| `LibraryScreen` | Top-level screen, owns selection state + tab index | `src/screens/library/LibraryScreen.tsx:75-535` |
| `SearchbarV2` | Search/select-mode header with icons + overflow menu | `LibraryScreen.tsx:454-464` |
| `Banner` | Top-of-screen status banner (downloaded-only / incognito) | `src/screens/library/components/Banner.tsx:16-34` |
| `TabView` + `TabBar` (`react-native-tab-view`) | Per-category tabs; `lazy` enabled | `LibraryScreen.tsx:483-493`, `renderTabBar` 189-222 |
| `renderLabel` (TabBar label) | Category name + optional pill count badge | `LibraryScreen.tsx:286-318` |
| `LibraryView` | Per-category novel list/grid + pull-to-refresh + empty state | `src/screens/library/components/LibraryListView.tsx:26-136` |
| `NovelList` | Generic responsive grid/list (3 cols portrait, 6 cols landscape default) | `src/components/NovelList.tsx:30-46` |
| `LibraryNovelItem` | Wraps `NovelCover`, dispatches press / long-press to selection or navigate | `src/screens/library/components/LibraryNovelItem.tsx:17-50` |
| `EmptyView` | Empty library placeholder with action button | `LibraryListView.tsx:89-111` |
| `Button` ("Search globally") | Above the grid when search text is set | `LibraryScreen.tsx:251-263` |
| `Actionbar` (in `Portal`) | Bulk-action bar shown when selection is active | `LibraryScreen.tsx:524-530`, actions 427-435 |
| `SetCategoryModal` | Reused from novel screen; assigns selection to categories | `LibraryScreen.tsx:513-519` |
| `LibraryBottomSheet` | Filter / Sort / Display tabs in a `BottomSheetModal` | `src/screens/library/components/LibraryBottomSheet/LibraryBottomSheet.tsx:186-276` |
| `Checkbox` / `SortItem` / `RadioButton` | Filter / sort / display-mode list items | `LibraryBottomSheet.tsx:41-178` |
| `FAB` (Resume) | Continue-reading shortcut to last `history[0]` chapter | `LibraryScreen.tsx:496-512` |
| `LibraryContextProvider` | Lifts library + settings state app-wide | `src/components/Context/LibraryContext.tsx:18-31` |
| `SelectionContext` | Provides `selectedIdsSet`, `toggleSelection`, etc. | `src/screens/library/SelectionContext.tsx:8-25` |
| `SourceScreenSkeletonLoading` | Shimmer placeholder while `isLoading` | `LibraryScreen.tsx:247-249` |

### Categories

| Component | Role | Upstream file:lines |
|---|---|---|
| `CategoriesScreen` | Owns the screen, drag-drop reordering | `src/screens/Categories/CategoriesScreen.tsx:23-122` |
| `Appbar` | Header with back button | `CategoriesScreen.tsx:78-82` |
| `DraggableFlatList` (`react-native-draggable-flatlist`) | Reorderable list of categories | `CategoriesScreen.tsx:86-101` |
| `CategoryCard` | Drag handle + name + System badge + edit/delete icons | `src/screens/Categories/components/CategoryCard.tsx:20-134` |
| `AddCategoryModal` | Add or rename a category (shared component) | `src/screens/Categories/components/AddCategoryModal.tsx:26-87` |
| `DeleteCategoryModal` | Confirm-before-delete dialog | `src/screens/Categories/components/DeleteCategoryModal.tsx:20-52` |
| `CategorySkeletonLoading` | Shimmer placeholder while loading | `src/screens/Categories/components/CategorySkeletonLoading.tsx:15-41` |
| `EmptyView` | "no categories" placeholder | `CategoriesScreen.tsx:94-100` |
| `FAB` (`+ Add`) | Open `AddCategoryModal` | `CategoriesScreen.tsx:103-111` |

## 5. States

| State | Trigger | What user sees |
|---|---|---|
| Loading (Library) | `isLoading=true` from `useLibrary.getLibrary` (`useLibrary.ts:68-80`); also forced when `searchText` becomes non-empty (`useLibrary.ts:69-71`) | `SourceScreenSkeletonLoading` shimmer in place of grid |
| Loaded - non-empty | `library.length > 0` and selected category has matching novels | TabBar + `NovelList` of `LibraryNovelItem`s (display mode-driven) |
| Loaded - empty (Default tab) | `library` empty for current category, `categoryId !== 2` | `EmptyView` "Your library is empty..." with action: Browse |
| Loaded - empty (Local tab) | `categoryId === 2` (Local category) and no novels | `EmptyView` with action: Import EPUB |
| Search-active | `searchText` non-empty | Searchbar shows query; novels filtered by `name` or `author` (case-insensitive); a "Search for `<text>` globally" button appears above the grid; tapping opens `GlobalSearchScreen` (`LibraryScreen.tsx:179, 257-262`) |
| Selection-mode | `selectedNovelIds.length > 0` | Searchbar left icon swaps to `close`; placeholder becomes `"<n> selected"`; right icon becomes `select-all`; bottom `Actionbar` appears with 4 actions; pressing tile toggles selection (`LibraryNovelItem.tsx:30-36`); back button clears selection (`LibraryScreen.tsx:134-141`) |
| Downloaded-only banner | `downloadedOnlyMode === true` | `Banner` row with `cloud-off-outline` icon and `moreScreen.downloadOnly` text, primary color |
| Incognito banner | `incognitoMode === true` | `Banner` row with `incognito` icon, `tertiary`/`onTertiary` color |
| Resume FAB visible | `useLibraryFAB && !isHistoryLoading && history?.length > 0 && !error` | Floating "Resume" FAB bottom-right (`LibraryScreen.tsx:496-512`) |
| Refreshing (per-tab) | Pull-to-refresh on a non-Local category | `RefreshControl` triggers `ServiceManager.addTask({ name:'UPDATE_LIBRARY', data:{categoryId, categoryName} })`; `refreshing` is hard-coded `false` so visual spinner does not persist |
| Restore-in-progress | `taskQueue` contains a `LOCAL_RESTORE`/`DRIVE_RESTORE`/`SELF_HOST_RESTORE` task | No explicit UI; on completion (count goes from >0 to 0) `getLibrary()` re-runs to surface restored data (`useLibrary.ts:119-146`) |
| Error | UNKNOWN: no top-level error UI on the Library screen itself; DB query failures bubble up as unhandled promise rejections. Categories screen's `useCategories` hook stores `error` in state but the Categories screen uses `useLibraryContext` which has no error field, so the error is never surfaced. |
| Categories - loading | `useLibraryContext().isLoading` | `CategorySkeletonLoading` (3-9 shimmer rows, count `Math.random()*6+3`) |
| Categories - loaded empty | `userCategories.length === 0` | `EmptyView` "You have no categories..." |
| Categories - drag-active | User holds drag handle | `isActive` prop sets `opacity:0.8, elevation:8` on `CategoryCard` (`CategoryCard.tsx:171-174`) |
| Categories - duplicate name | `isCategoryNameDuplicate` true on save | `showToast(getString('categories.duplicateError'))` ("A category with this name already exists!") |

## 6. Interactions

### Library tab

| Touchpoint | Gesture | Effect |
|---|---|---|
| Searchbar text input | type | Updates local `searchText` (`LibraryScreen.tsx:76`); filters `currentNovels` by `name`/`author` substring (case-insensitive) |
| Searchbar left icon (magnify -> close) | tap | If selection active, clears selection (`handleLeftIconPress`, `LibraryScreen.tsx:320-324`); otherwise it is the magnify icon (no-op besides focusing search) |
| Searchbar right icon `filter-variant` | tap | `bottomSheetRef.current?.present()` -> opens filter/sort/display sheet |
| Searchbar right icon `select-all` (selection mode) | tap | Selects every novel in the current category (`rightIcons`, `LibraryScreen.tsx:329-335`) |
| Searchbar overflow menu | tap | Reveals 4 actions: Update Library, Update Category, Import Epub, Open Random Entry (`menuButtons`, `LibraryScreen.tsx:345-374`) |
| Update Library | tap menu item | `ServiceManager.manager.addTask({ name:'UPDATE_LIBRARY' })` |
| Update Category | tap menu item | Adds `UPDATE_LIBRARY` task scoped to the active category. Skips if the active category is `id===2` (Local). |
| Import EPUB | tap menu item | `DocumentPicker.getDocumentAsync({type:'application/epub+zip', multiple:true})` -> `importNovel` |
| Open Random Entry | tap menu item | Picks `Math.floor(Math.random()*currentNovels.length)` and navigates to `ReaderStack > Novel` |
| Tab tap | tap | `setIndex(n)` switches to that category |
| Library tab (when focused) | tap on bottom-nav | Intercepts `tabPress` and presents the bottom sheet instead (`LibraryScreen.tsx:143-153`) |
| Tab swipe | horizontal swipe | `TabView` switches category (lazy-rendered scenes) |
| Novel cover | tap (no selection) | Navigate to `ReaderStack > Novel` with `NovelInfo` params (`LibraryNovelItem.tsx:30-36`) |
| Novel cover | long-press | Toggle selection (`LibraryNovelItem.tsx:26-28`) |
| Novel cover | tap (selection active) | Toggle selection |
| Pull-to-refresh on grid | pull down | `ServiceManager.addTask({ name:'UPDATE_LIBRARY', data:{categoryId, categoryName} })`; no-op if `categoryId === 2` (`LibraryListView.tsx:79-87`) |
| "Search for `<text>` globally" button | tap | `navigation.navigate('GlobalSearchScreen', { searchText })` |
| Actionbar `label-outline` | tap | Opens `SetCategoryModal` for selected novels |
| Actionbar `check` | tap | `markAllChaptersRead(id)` for each selected novel, then clear selection + refetch |
| Actionbar `check-outline` | tap | `markAllChaptersUnread(id)` for each, then clear + refetch |
| Actionbar `delete-outline` | tap | `removeNovelsFromLibrary(selectedIds)` (sets `inLibrary=false`, deletes from `NovelCategory`); shows toast `browseScreen.removeFromLibrary` |
| Hardware back | press | If selection active, clears it and consumes the event (`useBackHandler`, `LibraryScreen.tsx:134-141`); otherwise default navigation behavior |
| Resume FAB | tap | Navigate to `ReaderStack > Chapter` with `history[0]` (`LibraryScreen.tsx:376-390`) |
| Bottom sheet Filter checkbox | tap | Toggles `filter`; tapping the active filter clears it (sets to `undefined`). The Downloaded checkbox is disabled when global `downloadedOnlyMode` is on (`LibraryBottomSheet.tsx:67-69`). |
| Bottom sheet Sort row | tap | Cycles ASC -> DESC for that key (`SortItem` shows arrow direction) |
| Bottom sheet Display checkboxes / radios | tap | Mutates the corresponding `LibrarySettings` field via `setLibrarySettings` (writes MMKV) |

### Categories screen

| Touchpoint | Gesture | Effect |
|---|---|---|
| FAB `+ Add` | tap | Opens `AddCategoryModal` in create mode |
| Drag handle | press-and-hold then drag | `DraggableFlatList` activates after 10dp; on drop, `onDragEnd` rewrites `sort` indexes and calls `updateCategoryOrderInDb` (`CategoriesScreen.tsx:49-61`) |
| Category name (text) | tap | Opens `AddCategoryModal` in edit mode (disabled when `category.id === 2`) (`CategoryCard.tsx:73-77`) |
| `pencil-outline` icon | tap | Opens edit modal; disabled and dimmed (`opacity:0.4`) for `id <= 2` (system) |
| `delete-outline` icon | tap | Opens `DeleteCategoryModal`; disabled for `id <= 2` |
| Add modal Save | tap | Calls `isCategoryNameDuplicate` first; toast on duplicate; otherwise `createCategory` or `updateCategory(id, name)` then `refreshCategories` |
| Delete modal OK | tap | `deleteCategoryById(category)`. If `id <= 2`, server-side it bails out with toast `categories.cantDeleteDefault`. Otherwise reassigns novels that only live in this category to category id=1, then deletes the row (`CategoryQueries.ts:109-147`). |
| Back arrow | tap | `goBack()` |

## 7. Affecting settings

`LibrarySettings` (MMKV key `LIBRARY_SETTINGS`, `useSettings.ts:91-101, 267-289`):
- `sortOrder?: LibrarySortOrder` (default `DateAdded_DESC`) - drives `getLibraryNovelsFromDb` `ORDER BY`.
- `filter?: LibraryFilter` - raw SQL fragment appended to the `WHERE` (`Downloaded`, `Unread`, `Completed`, `DownloadedOnly`, `Started`).
- `showDownloadBadges?: boolean` (default `true`).
- `showUnreadBadges?: boolean` (default `true`).
- `showNumberOfNovels?: boolean` (default `false`) - shows the per-tab count pill in the TabBar.
- `displayMode?: DisplayModes` (default `Comfortable`) - `Compact | Comfortable | CoverOnly | List`.
- `novelsPerRow?: number` (default `3`) - portrait grid columns; landscape forces 6.
- `incognitoMode?: boolean` (default `false`) - shows the incognito banner.
- `downloadedOnlyMode?: boolean` (default `false`) - shows the "Downloaded only" banner; also passed to `getLibraryNovelsFromDb` to OR-filter `chaptersDownloaded > 0` or `isLocal=1`.

`AppSettings` (MMKV key `APP_SETTINGS`, `useSettings.ts:36-83`) consumed by Library:
- `useLibraryFAB: boolean` (default `false`) - controls Resume FAB visibility.
- `incognitoMode: boolean` and `downloadedOnlyMode: boolean` are also defined on `AppSettings` but the Library screen reads them from `LibraryContext.settings` (i.e. `useLibrarySettings`), so the upstream code maintains both copies. See *Edge cases*.
- `disableLoadingAnimations: boolean` - read by `CategorySkeletonLoading` and `SourceScreenSkeletonLoading`.

## 8. Data this screen reads/writes

Reads:
- DB: `getCategoriesFromDb()` -> `Category & { novelIds: csv }[]` (`CategoryQueries.ts:16-36`). Joined with `NovelCategory` and concatenated by `GROUP_CONCAT(novelId)`.
- DB: `getLibraryNovelsFromDb(sortOrder, filter, searchText, downloadedOnlyMode)` -> `NovelInfo[]` from `Novel` where `inLibrary=1` (`LibraryQueries.ts:9-40`).
- MMKV: `LIBRARY_SETTINGS` via `useLibrarySettings()`.
- MMKV: `APP_SETTINGS` via `useAppSettings()` (for `useLibraryFAB`).
- MMKV: `ServiceManager.manager.STORE_KEY` task queue - watched to detect restore completion.
- React hooks: `useHistory()` for the Resume FAB target.

Writes:
- DB: `markAllChaptersRead(novelId)` per selected (`ChapterQueries.ts:121-128`).
- DB: `markAllChaptersUnread(novelId)` per selected (`ChapterQueries.ts:130-137`).
- DB: `removeNovelsFromLibrary(novelIds)` - bulk update + delete (`NovelQueries.ts:215-229`).
- DB: `switchNovelToLibraryQuery(novelPath, pluginId)` - exposed via `useLibraryContext` for callers outside the screen (used by Browse / Novel screens).
- DB (Categories): `createCategory`, `updateCategory(id, name)`, `deleteCategoryById(category)`, `updateCategoryOrderInDb(categories)`.
- MMKV: any change in the bottom sheet calls `setLibrarySettings(partial)` -> MMKV write.
- ServiceManager: enqueues `UPDATE_LIBRARY` (global, per-category, or pull-to-refresh).

The library `Category` table is seeded with `id=1 "Default"` and `id=2 "Local"` by `populate.ts:5-10`. These two IDs have special semantics throughout the screen.

## 9. Edge cases / gotchas

- **System category IDs**: `id=1` is "Default" (auto-bucket for any added novel that has no other category). `id=2` is "Local" (only contains EPUB-imported novels). `useLibrary.refreshCategories` (`useLibrary.ts:54-63`) hides the Default category if any user category exists *and* Default is empty. Local is always shown.
- **No-pull-to-refresh on Local**: `LibraryListView.tsx:80-87` short-circuits `onRefresh` when `categoryId === 2`. Same guard exists in the Update Category overflow action (`LibraryScreen.tsx:354-356`) and in `getLibraryWithCategory`.
- **Delete of a non-system category**: Novels that *only* belong to the deleted category are reassigned to the Default category (`id=1`), then the row is removed (`CategoryQueries.ts:109-147`). The toast `categories.cantDeleteDefault` is shown if a caller still passes id <= 2.
- **Duplicate detection is case-sensitive** and works on exact `name` match (`CategoryQueries.ts:167-176`). It runs synchronously via `dbManager.getSync`. UNKNOWN: behavior when renaming a category to its own current name (likely treated as a duplicate and rejected).
- **Filter raw-SQL injection surface**: `LibraryFilter` enum values are raw SQL fragments inserted via `sql.raw(filter)` in `getLibraryNovelsFromDb`. Safe today because the values are constants, but anything that ever lets a user supply a custom filter string would be a SQL injection.
- **Search behavior**: in-screen search filters `library` in memory by `name`/`author`. The DB query also receives `searchText` and uses `LIKE %text%` on `name` (`LibraryQueries.ts:30`). The two filters compose - i.e. results are pruned both at SQL and JS layer.
- **`refreshing` on `RefreshControl` is hard-coded `false`** (`LibraryListView.tsx:115-122`) - the spinner does not stay during the actual update.
- **Tab `tabPress` interception**: when the Library tab is the active tab and the user taps it, the bottom sheet opens instead of re-navigating. This is intentional and matches Tachiyomi-style apps.
- **Per-tab count badge** (`renderLabel`, `LibraryScreen.tsx:286-318`) filters `novelIds` by `id !== 0` to ignore the placeholder zero entry that comes from `GROUP_CONCAT` on a category with no novels (the SQL produces `'0'` instead of NULL).
- **Resume FAB and history**: it always opens `history[0]`, not the last-read chapter of any selected novel. It is a global "continue reading" shortcut.
- **Restore detection**: `useLibrary` subscribes to the MMKV task queue and re-runs `getLibrary()` only on the *transition* from "restore in progress" to "no restore tasks", not while a restore is running.
- **`LibrarySettings.incognitoMode` vs `AppSettings.incognitoMode`**: both fields exist and the bottom sheet does not toggle incognito; the More screen does. The Library screen reads `incognitoMode` and `downloadedOnlyMode` off `LibraryContext.settings` (which is `useLibrarySettings()`), so toggling `AppSettings.incognitoMode` from More may not update the library banner unless those keys are kept in sync. UNKNOWN: which one is authoritative at runtime - both are persisted under different MMKV keys.
- **Selection across tabs**: `selectedNovelIds` is a flat list keyed by novel id, not scoped to category. Switching tabs preserves selection. The `select-all` action selects only the *current* tab's novels.
- **Empty `categories` array**: `renderTabBar` returns `null` (`LibraryScreen.tsx:191`) and `currentNovels` is `[]`, so the screen shows just the searchbar + (empty body). UNKNOWN: this should not happen given the seed data, but no UI specifically handles it.
- **`CategorySkeletonLoading` row count**: uses `Math.random()*6+3` to produce 3-9 shimmer rows on every render (`CategorySkeletonLoading.tsx:36`). Not deterministic, not memoized.
- **`UpdateContext`**: present in `src/components/Context/UpdateContext.tsx` but the Library screen does NOT consume it - update progress for the library tab is read indirectly through `ServiceManager`'s task queue.

## 10. Tauri-side notes

Mantine equivalents for components in section 4:

| Upstream component | Mantine / web equivalent |
|---|---|
| `SearchbarV2` | `TextInput` with left/right icon slots, plus a `Menu` for the overflow `...`; selection mode swaps icon to `IconX` |
| `Banner` (`Banner.tsx`) | `Alert` (variant `light`, `color="primary"` / `"grape"`) with a leading `ThemeIcon` |
| `TabView` (`react-native-tab-view`) | `Tabs` (Mantine) with `variant="default"` and `keepMounted={false}` for the lazy semantics; horizontal scroll via `Tabs.List` overflow |
| Tab label with count | `Tabs.Tab` + `Badge` |
| `BottomSheetModal` + tabbed content | `Drawer` anchored `position="bottom"` containing a `Tabs` block; or `Modal` with full-width on mobile |
| `Checkbox` / `RadioButton` / `SortItem` | `Checkbox`, `Radio.Group`, custom button row with `IconArrowUp` / `IconArrowDown` for tri-state |
| `NovelList` / `NovelCover` | CSS grid `grid-template-columns: repeat(var(--novels-per-row), minmax(0,1fr))` with breakpoint override at `landscape` -> 6 cols; `Card` wrapping a lazy image |
| `LibraryNovelItem` selection chrome | `Checkbox` overlay + selected outline using `outline: 2px solid var(--mantine-primary-filled)` |
| `Actionbar` (`Portal` overlay) | `AppShell.Footer` toggled by selection state, or a fixed bottom `Group` with `ActionIcon`s |
| `SetCategoryModal` | `Modal` containing a `Checkbox.Group` listing user categories (excluding id=2 "Local") |
| `FAB` (Resume / Add) | `ActionIcon size="xl" variant="filled"` positioned with `position: fixed; right: 16px; bottom: 16px` |
| `EmptyView` | `Stack` with large emoji `Text`, description `Text`, primary `Button` for the action |
| `SourceScreenSkeletonLoading` / `CategorySkeletonLoading` | `Skeleton` grid; do **not** randomize row counts - render a fixed `n=8` |
| `DraggableFlatList` (Categories) | `dnd-kit` (`@dnd-kit/sortable`) with `SortableContext` + `useSortable` per `CategoryCard` |
| `AddCategoryModal` / `DeleteCategoryModal` | `Modal` with `TextInput` + buttons; for delete use `modals.openConfirmModal` from `@mantine/modals` |
| `RefreshControl` | Web equivalent: a top "Update category" button or a `pulldown-refresh` polyfill; on Tauri desktop, a button is more conventional than a pull gesture |

Animation strategy:
- Tab transitions: Mantine `Tabs` transitions are fine; do not port `react-native-tab-view` swipe gestures to desktop.
- Bottom sheet: `Drawer` with `transitionProps={{ duration: 200, transition: 'slide-up' }}`.
- Selection overlay: simple opacity + transform via `framer-motion` `AnimatePresence` (or Mantine `Transition`).
- DnD on Categories: `@dnd-kit` provides built-in transforms; do not animate per-row independently.

TanStack Query placement:
- `useQuery(['library', { sortOrder, filter, searchText, downloadedOnlyMode }], () => getLibraryNovels(...))` keyed on the same args that drive `getLibraryNovelsFromDb`. Stale-while-revalidate is appropriate; backend writes (mark read/unread, remove from library, switch in/out) call `queryClient.invalidateQueries({ queryKey: ['library'] })`.
- `useQuery(['categories'], getCategoriesWithNovelIds)` for both the Library tabs and the Categories management screen. Mutations: `useMutation(createCategory|updateCategory|deleteCategoryById|updateCategoryOrderInDb)` each invalidating `['categories']` (and `['library']` for delete because novels can be reassigned).
- `useQuery(['history','last'], getLastHistoryRow)` for the Resume FAB.
- The current upstream pattern (`useFocusEffect(getLibrary)`) maps to TanStack Query's `refetchOnWindowFocus: true`.

State that should *not* go in TanStack Query:
- `selectedNovelIds`, `searchText`, current tab `index` - these are screen-local UI state (Zustand or `useState`).
- MMKV-backed settings - port to a typed `Store` (Tauri's `tauri-plugin-store` or a Zustand persisted store with the same key names; see [`docs/settings/catalog.md`](../settings/catalog.md)).

Other considerations:
- The web port has no `react-native-paper` `Portal`; either lift the `Actionbar` into the app shell, or use Mantine's `Affix` component anchored to the viewport.
- `useBackHandler` does not apply on web/desktop; on Windows/Linux, intercept `Escape` to clear selection.
- `DocumentPicker` -> use Tauri's `tauri-plugin-dialog` `open({ multiple: true, filters: [{ extensions: ['epub'] }] })`.
- The "tap focused tab to open bottom sheet" gesture has no clean web equivalent; expose the filter/sort/display sheet via a header icon (already present as `filter-variant`) and drop the tab-press behavior.

## 11. References

- LibraryScreen: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/LibraryScreen.tsx>
- SelectionContext: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/SelectionContext.tsx>
- useLibrary hook: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/hooks/useLibrary.ts>
- Library constants (filters/sort/displayModes): <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/constants/constants.ts>
- LibraryListView: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/components/LibraryListView.tsx>
- LibraryNovelItem: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/components/LibraryNovelItem.tsx>
- Banner: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/components/Banner.tsx>
- LibraryBottomSheet: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/components/LibraryBottomSheet/LibraryBottomSheet.tsx>
- CategoriesScreen: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/Categories/CategoriesScreen.tsx>
- CategoryCard: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/Categories/components/CategoryCard.tsx>
- AddCategoryModal: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/Categories/components/AddCategoryModal.tsx>
- DeleteCategoryModal: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/Categories/components/DeleteCategoryModal.tsx>
- CategorySkeletonLoading: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/Categories/components/CategorySkeletonLoading.tsx>
- LibraryContext: <https://github.com/lnreader/lnreader/blob/639a2538/src/components/Context/LibraryContext.tsx>
- LibrarySettings + AppSettings: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/persisted/useSettings.ts>
- useCategories: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/persisted/useCategories.ts>
- CategoryQueries: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/CategoryQueries.ts>
- LibraryQueries: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/LibraryQueries.ts>
- NovelQueries (`switchNovelToLibraryQuery`, `removeNovelsFromLibrary`): <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/NovelQueries.ts>
- ChapterQueries (mark all read/unread): <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/ChapterQueries.ts>
- BottomNavigator (Library tab registration): <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/BottomNavigator.tsx>
- MoreStack (Categories registration): <https://github.com/lnreader/lnreader/blob/639a2538/src/navigators/MoreStack.tsx>
- en strings (libraryScreen, categories): <https://github.com/lnreader/lnreader/blob/639a2538/strings/languages/en/strings.json>
