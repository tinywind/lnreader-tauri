# Settings Sub-Pages

> Sourced from upstream lnreader at commit 639a2538:
> - `src/navigators/MoreStack.tsx` lines 7-53 (route registration)
> - `src/navigators/types/index.ts` lines 75-85 (`SettingsStackParamList`)
> - `src/screens/settings/SettingsScreen.tsx` lines 1-101 (settings hub)
> - `src/screens/settings/SettingsGeneralScreen/SettingsGeneralScreen.tsx` lines 1-311
> - `src/screens/settings/SettingsGeneralScreen/modals/DownloadCooldownModal.tsx` lines 1-162
> - `src/screens/settings/SettingsGeneralScreen/modals/DisplayModeModal.tsx` lines 1-58
> - `src/screens/settings/SettingsGeneralScreen/modals/GridSizeModal.tsx` lines 1-83
> - `src/screens/settings/SettingsGeneralScreen/modals/NovelBadgesModal.tsx` lines 1-81
> - `src/screens/settings/SettingsGeneralScreen/modals/NovelSortModal.tsx` lines 1-77
> - `src/screens/settings/SettingsAppearanceScreen/SettingsAppearanceScreen.tsx` lines 1-315
> - `src/screens/settings/SettingsAppearanceScreen/LanguagePickerModal.tsx` lines 1-117
> - `src/screens/settings/SettingsLibraryScreen/SettingsLibraryScreen.tsx` lines 1-60
> - `src/screens/settings/SettingsLibraryScreen/DefaultCategoryDialog.tsx` lines 1-70
> - `src/screens/settings/SettingsReaderScreen/SettingsReaderScreen.tsx` lines 1-362
> - `src/screens/settings/SettingsReaderScreen/tabs/DisplayTab.tsx` lines 1-92
> - `src/screens/settings/SettingsReaderScreen/tabs/ThemeTab.tsx` lines 1-149
> - `src/screens/settings/SettingsReaderScreen/tabs/NavigationTab.tsx` lines 1-206
> - `src/screens/settings/SettingsReaderScreen/tabs/AccessibilityTab.tsx` lines 1-101
> - `src/screens/settings/SettingsReaderScreen/tabs/AdvancedTab.tsx` lines 1-393
> - `src/screens/settings/SettingsReaderScreen/ReaderTextSize.tsx` lines 1-46
> - `src/screens/settings/SettingsReaderScreen/Modals/FontPickerModal.tsx` lines 1-46
> - `src/screens/settings/SettingsBackupScreen/index.tsx` lines 1-114
> - `src/screens/settings/SettingsBackupScreen/Components/SelfHostModal.tsx` lines 1-325
> - `src/screens/settings/SettingsBackupScreen/Components/GoogleDriveModal.tsx` lines 1-359
> - `src/screens/settings/SettingsRepositoryScreen/SettingsRepositoryScreen.tsx` lines 1-148
> - `src/screens/settings/SettingsRepositoryScreen/components/AddRepositoryModal.tsx` lines 1-70
> - `src/screens/settings/SettingsRepositoryScreen/components/RepositoryCard.tsx` lines 1-144
> - `src/screens/settings/SettingsRepositoryScreen/components/DeleteRepositoryModal.tsx` lines 1-40
> - `src/screens/settings/SettingsTrackerScreen.tsx` lines 1-410
> - `src/screens/settings/SettingsAdvancedScreen.tsx` lines 1-195
> - `src/screens/settings/components/SettingSwitch.tsx` lines 1-35
> - `src/screens/settings/components/DefaultChapterSortModal.tsx` lines 1-50
> - `src/screens/settings/components/TrackerLoginDialog.tsx` lines 1-167
> - `src/theme/md3/index.ts` lines 1-32 (9 themes)

## 1. Purpose

The 8 settings pages collectively expose the persisted settings catalog. This doc documents the **layout per page** — for the keys themselves see [settings catalog](../settings/catalog.md). The data each page mutates lives in MMKV in upstream and must move to the equivalent persisted Zustand store in the rewrite (per [`HANDOFF.md`](../HANDOFF.md)).

A few page-level notes that apply globally:

- The hub (`SettingsScreen.tsx`) lists 7 entries (no Library) because `LibrarySettings` is **registered in route types but not mounted** in `MoreStack.tsx` (`src/navigators/MoreStack.tsx:18` is commented out and the hub omits the link). Library settings still has a screen file and is wired enough to render — it is shipping but unreachable from the UI in this commit.
- Reader settings is structurally different from the other 7: it is a **live preview WebView** with a bottom-sheet of 5 tabs, not a list-of-rows.
- Drive backup remains in upstream code but is **cut from the rewrite** per `prd.md` §3.

## 2. Routes / Entry points

```
RootStack
└── BottomNavigator
    └── More tab
        └── MoreStack
            ├── About
            ├── TaskQueue
            ├── Downloads
            ├── Categories
            ├── Statistics
            └── SettingsStack
                ├── Settings              (hub)
                ├── GeneralSettings
                ├── ReaderSettings
                ├── TrackerSettings
                ├── BackupSettings
                ├── AppearanceSettings
                ├── AdvancedSettings
                ├── RespositorySettings   (sic: spelling kept from upstream)
                └── LibrarySettings       (declared in types, NOT mounted in stack)
```

`src/navigators/types/index.ts:75-85` declares all 9 route names; `src/navigators/MoreStack.tsx:28-40` mounts only 8.

`RespositorySettings` accepts an optional `{ url?: string }` param — the deep-link handler for `lnreader://repository?url=...` lands here and triggers `upsertRepository(url)` on mount (`SettingsRepositoryScreen.tsx:70-74`).

## 3. Common patterns

These primitives recur across most pages:

- **Section headers** via `<List.SubHeader>` with optional inline divider `<List.Divider>` between sections.
- **`<List.Item title description onPress>`** — a tappable row that opens a modal or navigates.
- **`<SettingSwitch label description value onPress>`** — wraps `SwitchItem` with a 16px horizontal pad (`components/SettingSwitch.tsx:13-30`). On = boolean state in MMKV, tap toggles in place.
- **`<Modal>`** in a `<Portal>` for confirmations and pickers; standard Material 3 dialog look.
- **`<RadioButton>`** for single-select, `<Checkbox>` for multi-select (Novel Badges modal).
- **`<SortItem>`** for asc/desc-aware sort toggles (default chapter sort, library sort).
- **`<ColorPickerModal>`** with optional `showAccentColors` for theme accent + reader background/text.
- **`<ConfirmationDialog>`** for destructive operations (advanced clear-cache rows).
- **`<SafeAreaView excludeTop>`** + **`<Appbar handleGoBack>`** at the top of every page — no headerShown, the Appbar is hand-rolled.
- **Settings hub (`SettingsScreen.tsx`)** is itself a `ScrollView` of 7 `List.Item`s with `icon` + `onPress: navigate(...)`.

`SwitchSetting` and `ColorPickerSetting` named in the brief map to `SettingSwitch` and `<List.ColorItem>` + `<ColorPickerModal>` in the actual codebase. There is no `SliderSetting` — sliders are not used; reader values use `+/-` icon buttons (`ReaderTextSize.tsx`, `ReaderValueChange`) and grid size uses XS/S/M/L/XL radio buckets.

## 4. Per-page detail

### 4.1 General (`SettingsGeneralScreen`)

`SettingsGeneralScreen/SettingsGeneralScreen.tsx:109-303`. Six sections rendered as one scroll:

1. **Display** (4 rows opening modals)
   - `Display mode` → `DisplayModeModal` — radio options from `displayModesList` (Compact / Comfortable / Cover only / List).
   - `Items per row in library` → `GridSizeModal` — XS/S/M/L/XL ↔ 5/4/3/2/1.
   - `Novel badges` → `NovelBadgesModal` — three checkboxes (download, unread, item count). Description is the comma-joined active labels.
   - `Novel sort` → `NovelSortModal` — list of `SortItem` rows, each toggles asc⇄desc on tap.
2. **Library** (2 switches)
   - `Update library on launch` (`updateLibraryOnLaunch`) with description.
   - `Use FAB for library` (`useLibraryFAB`).
3. **Novel** (1 row)
   - `Default chapter sort` → `DefaultChapterSortModal` (shared component) — a single `SortItem` for `bySource asc/desc`. Description shows current state.
4. **Global update** (3 switches)
   - `Update only ongoing novels` (`onlyUpdateOngoingNovels`).
   - `Refresh novel metadata` (`refreshNovelMetadata`) with description.
   - `Show last update time` — toggles `showLastUpdateTime` via `useLastUpdate()` (separate MMKV key, not part of `AppSettings`).
5. **Auto-download** (1 switch)
   - `Download new chapters` (`downloadNewChapters`).
6. **General settings** (1 row + 2 switches) — yes, the page repeats `generalSettings` as the final section header.
   - `Chapter download cooldown` → `DownloadCooldownModal`. Description is `${ms/1000}s`.
   - `Disable haptic feedback` (`disableHapticFeedback`) with description.
   - `Disable loading animations` (`disableLoadingAnimations`) with description.

**Keys touched** (from `AppSettings` unless noted, see [catalog](../settings/catalog.md)):

- `updateLibraryOnLaunch`, `useLibraryFAB`, `onlyUpdateOngoingNovels`, `refreshNovelMetadata`, `downloadNewChapters`, `disableHapticFeedback`, `disableLoadingAnimations`, `defaultChapterSort`, `chapterDownloadCooldownMs`.
- `LibrarySettings`: `displayMode`, `novelsPerRow`, `showDownloadBadges`, `showUnreadBadges`, `showNumberOfNovels`, `sortOrder`.
- Standalone MMKV: `LAST_UPDATE_TIME` shown/hidden via `showLastUpdateTime` boolean.

**Special widgets — `DownloadCooldownModal`** (`SettingsGeneralScreen/modals/DownloadCooldownModal.tsx:1-162`):

- Auto-focused decimal-pad `TextInput`. Display unit is **seconds** but persisted as **milliseconds** (`chapterDownloadCooldownMs`). Conversions: `msToSeconds` shows integer or 2-decimal string; `parseSecondsToMs` rounds to integer ms.
- Input is sanitized to digits + a single decimal point (`sanitizeNumericInput`).
- Two actions: **OK** saves (silently dismisses if input is invalid — does not error), **Reset** restores `DEFAULT_CHAPTER_DOWNLOAD_COOLDOWN_MS` (1000ms).
- Default surfaced from `useAppSettings`'s `chapterDownloadCooldownMs ?? DEFAULT_CHAPTER_DOWNLOAD_COOLDOWN_MS`.

### 4.2 Appearance (`SettingsAppearanceScreen`)

`SettingsAppearanceScreen/SettingsAppearanceScreen.tsx:142-289`. Three sections:

1. **App theme**
   - **Theme mode segmented control** (`<SegmentedControl>`): system / light / dark. Persisted to MMKV `THEME_MODE` (separate from `APP_THEME_ID`).
   - **Light themes** — horizontal `ScrollView` of 9 `<ThemePicker>` swatches.
   - **Dark themes** — same row, separately scrolled.
   - The 9 themes are `defaultTheme`, `midnightDusk`, `tealTurquoise`, `yotsubaTheme`, `lavenderTheme`, `strawberryDaiquiriTheme`, `takoTheme`, `catppuccinTheme`, `yinyangTheme` (`src/theme/md3/index.ts:11-32`). Each ships both a `light` and `dark` variant.
   - Theme selection writes `APP_THEME_ID` (`useMMKVNumber`), clears any custom accent override (`CUSTOM_ACCENT_COLOR = undefined`), and switches `THEME_MODE` to match the selected theme's `isDark` if not in system mode.
   - **Pure black dark mode** switch (`AMOLED_BLACK`) — only rendered when current theme is dark (`SettingsAppearanceScreen.tsx:208-215`).
   - **Accent color** row → `<ColorPickerModal showAccentColors>` writes `CUSTOM_ACCENT_COLOR`.
   - **App language** row → `LanguagePickerModal` — radio list of 35 locales (`LanguagePickerModal.tsx:22-71`), writes via `setLocale` to MMKV `APP_LOCALE`. Includes a "restart note" hint.
2. **Novel info**
   - `Hide backdrop` (`hideBackdrop`).
   - `Use FAB for continue reading` (`useFabForContinueReading`).
3. **Navbar**
   - `Show updates in nav` (`showUpdatesTab`).
   - `Show history in nav` (`showHistoryTab`).
   - `Always show nav labels` (`showLabelsInNav`).

**Keys touched**: MMKV — `APP_THEME_ID`, `THEME_MODE`, `AMOLED_BLACK`, `CUSTOM_ACCENT_COLOR`, `APP_LOCALE`. `AppSettings` — `hideBackdrop`, `useFabForContinueReading`, `showUpdatesTab`, `showHistoryTab`, `showLabelsInNav`.

### 4.3 Library (`SettingsLibraryScreen`)

`SettingsLibraryScreen/SettingsLibraryScreen.tsx:23-56`. **Not mounted** in the MoreStack at this commit — see §1 / §2 above. The page renders two rows when reached programmatically:

1. **Categories** (`categories.header`) — description is `${categories.length} categories`. Tap navigates to `MoreStack/Categories` (the dedicated CategoriesScreen).
2. **Default category** — description is the name of the category whose `sort === 1`. Tap opens `DefaultCategoryDialog` (`DefaultCategoryDialog.tsx:20-62`) — Material `Dialog` with a `FlatList` of `<RadioButton>` per category.

**`setDefaultCategory(categoryId)` is a `// TODO: update default category` stub** (`SettingsLibraryScreen.tsx:17-21`). The dialog renders, but selecting a row does nothing in upstream right now — verify before re-enabling in the rewrite.

**Keys touched**: would need to reach into `Category` rows in SQLite (sort field) — there is no `LibrarySettings.defaultCategory` key. UNKNOWN whether the rewrite should keep this dialog at all given the upstream stub.

### 4.4 Reader (`SettingsReaderScreen`)

`SettingsReaderScreen/SettingsReaderScreen.tsx:44-327`. **Architecturally distinct** from the other 7 — full-screen WebView preview with a bottom-sheet of 5 tabs revealed by a cog FAB.

**Layout**:

- Top: `<Appbar mode="small">`.
- Middle: `<WebView>` rendering the dummy preview chapter HTML (`utils.ts:dummyHTML`) with all current reader CSS/JS injected. Reader background uses `readerSettings.theme` color. Speech, hide/show UI, and battery level wired through the same WebView postMessage protocol the real reader uses (`onMessage` switch on `hide` / `speak` / `stop-speak`).
- Bottom-right: `<FAB icon="cog">` opens the bottom sheet.
- `<BottomSheet snapPoints={[screenHeight * 0.7]}>` containing:
  - Drag handle.
  - Custom `<TabBar>` with 5 tabs: `display | theme | navigation | accessibility | advanced`.
  - Active tab content.

**Tab contents**:

- **Display tab** (`tabs/DisplayTab.tsx:15-71`)
  - Custom `ReaderTextSize` widget — `−` / value / `+` icon buttons (`ReaderTextSize.tsx:12-43`). Lower bound `textSize > 0`, no upper bound enforced.
  - `ReaderValueChange` for `lineHeight` (delta defaults).
  - `ReaderValueChange` for `padding` — explicit `valueChange=2`, `min=0`, `max=50`, `decimals=0`, `unit=px`.
  - `ReaderTextAlignSelector` — 4-way segmented (left/center/justify/right).
  - `Font style` row → `FontPickerModal` — `RadioButton` list over `readerFonts` constant; each label is rendered in its own font.
- **Theme tab** (`tabs/ThemeTab.tsx:13-122`)
  - `Preset` subheader → `<ReaderThemeSelector>` (presetReaderThemes scroll).
  - `Custom Colors` subheader: `<ColorPreferenceItem>` for `backgroundColor` and `textColor`, both opening separate `<ColorPickerModal>`s.
  - Below the colors: a single `<Button>` that switches between **Save custom theme** and **Delete custom theme** based on whether the current `(backgroundColor, textColor)` pair already exists in `readerSettings.customThemes` or matches a preset.
- **Navigation tab** (`tabs/NavigationTab.tsx:11-174`)
  - `Navigation Controls` section: `useVolumeButtons` switch + (when on) a `volumeButtonsOffset` numeric `TextInput` defaulting to `screenHeight * 0.75`. `verticalSeekbar`, `swipeGestures`, `tapToScroll` switches.
  - `Reading Mode` section: `pageReader` switch (paged vs scroll mode).
  - `Autoscroll` section: `autoScroll` switch + (when on) `autoScrollInterval` and `autoScrollOffset` numeric inputs and a **Reset** button (visible when either differs from defaults `10` / `null`).
- **Accessibility tab** (`tabs/AccessibilityTab.tsx:9-83`)
  - `Display` section: `fullScreenMode`, `showScrollPercentage`, `showBatteryAndTime`, `keepScreenOn` switches.
  - `Reading Enhancements` section: `bionicReading` switch.
- **Advanced tab** (`tabs/AdvancedTab.tsx:24-303`)
  - Custom CSS / JS code editor with a 2-tab toggle (CSS ⇄ JS).
  - `<TextInput multiline numberOfLines={12}>` styled with monospace font + `theme.surface2` background.
  - Hint banner (`secondaryContainer`) shows tab-specific tip text (`readerSettings.cssHint` / `readerSettings.jsHint`).
  - Three buttons: **Import** (DocumentPicker → NativeFile copy/read/unlink, sets value + saves), **Reset** (opens `ConfirmationDialog`, then clears), **Save** (writes `customCSS` or `customJS`).

**Keys touched** (see [catalog](../settings/catalog.md)):

- `ChapterReaderSettings`: `theme`, `textColor`, `textSize`, `textAlign`, `lineHeight`, `padding`, `fontFamily`, `customThemes`, `customCSS`, `customJS`, `tts.{voice,pitch,rate}` (preview only here, set via the in-reader bottom sheet not this screen).
- `ChapterGeneralSettings`: `useVolumeButtons`, `volumeButtonsOffset`, `verticalSeekbar`, `swipeGestures`, `tapToScroll`, `pageReader`, `autoScroll`, `autoScrollInterval`, `autoScrollOffset`, `fullScreenMode`, `showScrollPercentage`, `showBatteryAndTime`, `keepScreenOn`, `bionicReading`.

**Cuts to note for the rewrite**: Volume-button page turn and TTS are in `prd.md` §3 cuts. The Volume Buttons section of the Navigation tab and any TTS-related row should be removed in the Tauri build. UNKNOWN: this commit's `DisplayTab` does not show a TTS row, but `VoicePickerModal.tsx` exists in `Modals/` — verify whether it is reachable from another tab before deciding what to drop.

### 4.5 Backup (`SettingsBackupScreen`)

`SettingsBackupScreen/index.tsx:13-107`. Two sections, all rows queue work into `ServiceManager.manager.addTask`:

1. **Remote backup**
   - `Self-host` → `SelfHostModal`. The modal is a 4-state machine (`SelfHostModal.tsx:13-269`):
     - `SET_HOST` — text input + OK probes the host with a 2 s timeout, expects JSON `{ name: 'LNReader' }`. On success → `CONNECTED`.
     - `CONNECTED` — three buttons: Backup / Restore / Cancel (back to host).
     - `CREATE_BACKUP` — backup name input + OK enqueues `SELF_HOST_BACKUP { host, backupFolder: name+'.backup' }`.
     - `RESTORE_BACKUP` — `FlatList` of remote `.backup` folders; tapping enqueues `SELF_HOST_RESTORE`.
   - `Google Drive` → `GoogleDriveModal`. **Cut from rewrite per `prd.md` §3** — do not port. (Modal is structurally identical to SelfHost: UNAUTHORIZED ↔ AUTHORIZED ↔ CREATE_BACKUP ↔ RESTORE_BACKUP, with `GoogleSignin` fronting auth.)
2. **Local backup**
   - `Create backup` — enqueues `LOCAL_BACKUP`.
   - `Restore backup` — enqueues `LOCAL_RESTORE { mode: 'overwrite' }`.
   - `Restore backup (merge)` — enqueues `LOCAL_RESTORE { mode: 'merge' }`. The merge mode was added in commit `401aa7c8` (see git log).
   - Two `<List.InfoItem>` warnings about large backup restore behavior and create-backup limitations.

See [`backup/format.md`](../backup/format.md) for the wire format these tasks produce.

**Keys touched**: `SELF_HOST_BACKUP` MMKV key (host URL, headers — set via `useSelfHost`). No `AppSettings` keys are touched directly by this page; everything goes through the backup service queue.

### 4.6 Repository (`SettingsRepositoryScreen`)

`SettingsRepositoryScreen/SettingsRepositoryScreen.tsx:29-132`. Plain list with FAB:

- Header: `Appbar title='Repositories'`.
- Body: `<FlatList>` of `<RepositoryCard>` rows. Each card (`components/RepositoryCard.tsx:42-109`) renders:
  - Tag icon + repo URL trimmed to `${url.split('/')[3]}/${url.split('/')[4]}` (so it shows `org/repo` from a GitHub raw URL).
  - 3 icon buttons: open in browser (`expo-linking`), copy URL (`expo-clipboard`), delete (opens `DeleteRepositoryModal`).
  - Tapping the URL text opens the `AddRepositoryModal` in edit mode.
- Empty state: `<EmptyView icon="Σ(ಠ_ಠ)" description={getString('repositories.emptyMsg')}>`.
- Bottom-right `<FAB label='Add' icon='plus'>` opens `AddRepositoryModal` for create.

**`AddRepositoryModal`** (`components/AddRepositoryModal.tsx:19-56`) — single `TextInput` (placeholder `Repo URL`) + Add/OK + Cancel. URL passed back to `upsertRepository`.

**`upsertRepository` validation** (`SettingsRepositoryScreen.tsx:47-68`):

- Regex: `/https?:\/\/(.*)plugins\.min\.json/` — invalid → `showToast('Repository URL is invalid')`.
- Duplicate check via `isRepoUrlDuplicated` — duplicate → toast (note: typo `respository` preserved from upstream string).
- Otherwise creates or updates the repository row, then `refreshPlugins()`.

**Deep-link entry**: route param `{ url?: string }` triggers `upsertRepository(params.url)` on mount (`SettingsRepositoryScreen.tsx:70-74`). This pairs with the `lnreader://repository?url=...` deep link.

**Keys touched**: `Repository` SQLite table — not part of MMKV `AppSettings`.

### 4.7 Tracker (`SettingsTrackerScreen`)

`SettingsTrackerScreen.tsx:79-368`. Single Section with 4 tracker rows + an optional revalidation Section. Each tracker row is a `<PaperList.Item>` with a 32×32 logo and a check mark (right-side) when authenticated.

Trackers and login flows:

- **AniList** — OAuth via `getTracker('AniList').authenticate()`.
- **MyAnimeList** — OAuth via `getTracker('MyAnimeList').authenticate()`. Has expiring tokens; revalidate row appears in a second Section when `getTrackerAuth('MyAnimeList').auth.expiresAt < now`.
- **MangaUpdates** — credential login via `TrackerLoginDialog` → `mangaUpdatesAuth(username, password)` (basic-auth).
- **Kitsu** — credential login via `TrackerLoginDialog` → `kitsuAuth(email, password)` (the `usernameLabel` switches to `Email` for Kitsu only). Also has `expiresAt` revalidation; revalidate failure removes the tracker.

**`TrackerLoginDialog`** (`components/TrackerLoginDialog.tsx:15-129`) — username + password + error text + Cancel/Login. Loading state disables inputs and shows a spinner on the Login button.

**Logout flow**: tap an authenticated tracker → opens a `<Modal>` confirmation showing the localized "Are you sure you want to logout from {name}?" then `removeTracker(name)`.

**Status against rewrite scope**: Tracker integration is **not explicitly cut** in `prd.md` §3 (which lists TTS, volume-button, and Drive backup as cuts only). UNKNOWN whether the v0.1 sprint explicitly defers Tracker — the brief mentions "out-of-scope for v0.1 (per prd.md §3 cuts? — verify; if cut, note it)". `prd.md` §3 in the current commit does not list Tracker, so based on present spec it is **in scope**. Sprint planning may still defer it; check with product before implementing.

**Keys touched**: `TRACKER` MMKV key (per-tracker auth records `{name, auth: {accessToken?, refreshToken?, expiresAt?, ...}}`) via `useTracker`. Not part of `AppSettings`.

### 4.8 Advanced (`SettingsAdvancedScreen`)

`SettingsAdvancedScreen.tsx:24-170`. One section with 5 destructive/diagnostic rows:

- **Clear cached novels** — `ConfirmationDialog` → `deleteCachedNovels()` (deletes non-library novels).
- **Clear updates tab** — `ConfirmationDialog` → `clearUpdates()` then toast.
- **Delete read chapters** — `ConfirmationDialog` → `deleteReadChaptersFromDb()`.
- **Clear cookies** — `CookieManager.clearAll()` + `store.clearAll()` (plugin storage), then toast. **No confirmation dialog**.
- **User-Agent override** — opens a `<Modal>` with the current UA shown read-only, a `<TextInput multiline>` for editing, and **Save** + **Reset** (Reset = `getUserAgentSync()`). Persisted to MMKV `APP_USER_AGENT`.

**Keys touched**: `APP_USER_AGENT` (via `useUserAgent`). All other rows are SQLite mutations or runtime cookie clears, not settings keys.

## 5. States

Mostly static lists with no loading or empty states beyond:

- Repository: `<EmptyView>` when no repos.
- Tracker: revalidation Section appears conditionally on token expiry.
- Backup → Self-host: 4-state modal machine (SET_HOST, CONNECTED, CREATE_BACKUP, RESTORE_BACKUP).
- Reader: WebView "loading" state is implicit (no spinner shown).
- Confirmation dialogs are the standard modal state for destructive ops.

## 6. Interactions

- Tap row → toggle (`SettingSwitch`) or open modal (`<List.Item onPress>`) or navigate (`SettingsScreen` hub).
- Modals are dismissed by tapping outside or the explicit Cancel button.
- Reader settings changes are **live** — the preview WebView re-renders on every state change because `readerSettings` and `chapterGeneralSettings` are passed into the source `html` template (`SettingsReaderScreen.tsx:227-272`). Actual re-injection on toggle is UNKNOWN — the WebView source string regenerates per render but the upstream code does not call `webViewRef.current?.reload()` explicitly.
- Backup buttons are fire-and-forget — they enqueue a task into `ServiceManager` and the modal closes immediately.

## 7. Affecting settings

This whole doc is _about_ settings. Keys touched per sub-page are documented inline in §4. Cross-reference [`docs/settings/catalog.md`](../settings/catalog.md) for the canonical list of `AppSettings`, `LibrarySettings`, `ChapterGeneralSettings`, `ChapterReaderSettings` shapes and defaults.

## 8. Data this screen reads/writes

- **MMKV writes** per the [catalog](../settings/catalog.md). All persisted hooks (`useAppSettings`, `useLibrarySettings`, `useChapterGeneralSettings`, `useChapterReaderSettings`, `useTracker`, `useUserAgent`, `useTheme`, `useSelfHost`, `useLastUpdate`) live under `src/hooks/persisted/` and write JSON-serialized objects to MMKV.
- **SQLite writes**:
  - Repository page mutates the `Repository` table via `createRepository / updateRepository / deleteRepositoryById` (`src/database/queries/RepositoryQueries.ts`).
  - Library settings (if mounted) would mutate `Category.sort`.
  - Advanced page calls `deleteCachedNovels`, `clearUpdates`, `deleteReadChaptersFromDb` against multiple tables.
- **Background services**: Backup page enqueues `LOCAL_BACKUP`, `LOCAL_RESTORE { mode: 'overwrite' | 'merge' }`, `SELF_HOST_BACKUP`, `SELF_HOST_RESTORE`, `DRIVE_BACKUP`, `DRIVE_RESTORE` into `ServiceManager`. The service worker writes the zip per [`backup/format.md`](../backup/format.md) and operates outside the React tree.
- **Plugin runtime side effects**: Repository upsert calls `refreshPlugins()` (`src/hooks/persisted/usePlugins.ts`) which re-reads plugin manifests.
- **Native-side calls**: Advanced page calls `CookieManager.clearAll()` (native cookie store) and reads `getUserAgentSync()`. Reader Advanced tab uses `expo-document-picker` + `NativeFile` for CSS/JS import.

## 9. Edge cases / gotchas

- **Download cooldown modal validation**: invalid input silently dismisses without saving (no error feedback). Empty string is treated as invalid. Negative numbers are rejected. Decimal seconds are rounded to integer ms (so `0.0015s` would round to `2ms`).
- **Repository URL validation** is regex-only: `/https?:\/\/(.*)plugins\.min\.json/`. There is **no fetch test** at add time — invalid JSON, 404, or non-`PluginItem[]` content is only discovered when `refreshPlugins()` runs after the add. The brief mentions "must respond with valid PluginItem[] JSON" — this is not actually validated client-side.
- **Tracker login OAuth flow**: AniList and MyAnimeList authenticate via `getTracker(...).authenticate()` which opens a system browser via `expo-linking`. Returns auth or null on cancel. MangaUpdates and Kitsu are credential-only (no OAuth).
- **Theme switch** writes a single MMKV value; the entire app re-renders because `useTheme()` subscribes to `APP_THEME_ID`. `setCustomAccentColor(undefined)` is also called on theme select to clear any prior accent override.
- **Pure-black AMOLED switch** is rendered conditionally — toggle only visible when current theme `isDark`. Means light theme users cannot pre-set this.
- **Self-host probe** assumes the server returns `{ name: 'LNReader' }`. Any other response (including a generic 200) errors with `unknownHost` toast.
- **Drive sign-in** depends on Google Play Services (`hasPlayServices` check first). Not portable to iOS the same way; this is one of several reasons it is cut from the Tauri rewrite.
- **`LibrarySettings` route** is registered in types but unmounted — navigating to `'LibrarySettings'` programmatically would crash. Hub does not expose it.
- **`setDefaultCategory` in `SettingsLibraryScreen`** is a `// TODO` stub that does nothing.
- **Tracker expiry detection** uses `expiresAt < new Date(Date.now())` — relies on local clock; clock skew can show false expiries.
- **User-Agent reset** uses `getUserAgentSync()` which is the **device's** UA, not the **app's** original UA — so reset may produce a different UA than the app shipped with.
- **Reader Advanced import**: uses `NativeFile.copyFile` to a cache path, reads, then `unlinks`. The recent commit `5550ec0d` made unlink crash-safe when files are missing.

## 10. Tauri-side notes

Mantine equivalents for the upstream primitives:

| Upstream | Mantine | Notes |
|---|---|---|
| `<List.Item title description onPress>` | `<NavLink label description onClick>` or a custom `<UnstyledButton>` with two stacked `<Text>` | The hub becomes a vertical stack of `<NavLink>` with `<TanStack Router>` `to=` props. |
| `<SettingSwitch>` | `<Switch label description>` (Mantine) wrapped in a `<Group justify="space-between">` row | Built-in label + description support. |
| `<List.SubHeader>` | `<Text size="sm" c="dimmed" tt="uppercase">` or `<Divider label>` | Sectioning via `<Stack>` and dividers. |
| `<RadioButton>` | `<Radio.Group>` + `<Radio>` | Direct mapping. |
| `<Checkbox>` | `<Checkbox>` | Direct mapping. |
| `<SortItem status="asc"\|"desc">` | Custom: `<Button variant="subtle" leftSection={<IconSortAscending/>}>` toggling state | No built-in tri-state. |
| `<SegmentedControl>` (theme mode) | `<SegmentedControl data={...}>` (Mantine) | Direct mapping. |
| `<ColorPickerModal>` | `<ColorInput>` or a `<Modal>` wrapping `<ColorPicker>` | `showAccentColors` becomes a `swatches` prop. |
| `<Modal>` (Paper) | `<Modal opened onClose>` (Mantine) | Direct mapping. |
| `<ConfirmationDialog>` | `@mantine/modals` `modals.openConfirmModal` | Built-in. |
| `<TextInput>` (numeric) | `<NumberInput>` | Use `decimalScale` and `min` constraints; replaces the manual `sanitizeNumericInput` in `DownloadCooldownModal`. |
| `+/-` icon buttons (`ReaderTextSize`) | `<NumberInput>` with explicit `+/-` controls or `<Slider>` | If sliders are introduced, prefer `<Slider marks>` for `lineHeight` / `padding`. |
| `<FAB icon="plus">` | `<Affix>` with `<ActionIcon size="xl">` | Pin to bottom-right with `<Affix position={{ bottom: 16, right: 16 }}>`. |
| `<BottomSheet>` (Reader) | `<Drawer position="bottom" size="70%">` (Mantine) | Mantine's drawer covers the bottom-sheet UX. |
| `<TabBar>` (Reader) | `<Tabs orientation="horizontal">` | Direct mapping. |
| `<EmptyView>` | Custom `<Stack>` with icon + text | No built-in. |

Settings hub: a `<NavLink>` list inside a layout route with `<Outlet>` for nested settings sub-routes. With TanStack Router this becomes:

```
/settings              → SettingsHub
/settings/general
/settings/appearance
/settings/library
/settings/reader       (nested layout: preview + drawer)
/settings/backup
/settings/repository
/settings/tracker      (verify Sprint scope)
/settings/advanced
```

**Things to drop in the rewrite**:

- Drive backup modal (cut per `prd.md` §3).
- Volume button section in Reader → Navigation tab (cut per `prd.md` §3).
- Any TTS-related row (cut per `prd.md` §3) — `VoicePickerModal.tsx` exists upstream; do not port.
- Haptic feedback toggle is keep-able but should be a no-op on desktop platforms (haptics plugin is mobile-only per `prd.md` §6.1).

**Things that change shape**:

- `SettingsLibraryScreen` is unreachable upstream and its only meaningful row stubs out. Decide whether to drop it or implement default-category persistence properly in the rewrite (would require a new `LibrarySettings.defaultCategoryId` key — not in upstream catalog).
- WebView preview in Reader settings becomes a real React tree (no nested WebView needed since the entire Tauri app is one WebView).
- Self-host backup: keep, but the host probe should validate JSON shape more rigorously.
- Repository validation: consider doing a `HEAD`/`GET` of the URL at add time and parsing `PluginItem[]` before commit — the upstream regex-only check is the documented gotcha in §9.

## 11. References

- [Settings catalog](../settings/catalog.md) — full key shapes and defaults.
- [Backup wire format](../backup/format.md) — what the backup tasks produce.
- [Handoff](../HANDOFF.md) — overall doc map and how this fits.
- Upstream files cited at the top of this document (lnreader commit `639a2538`).
