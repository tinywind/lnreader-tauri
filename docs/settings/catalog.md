# Settings Catalog

> Tier 1.7. Every persisted user setting from upstream lnreader, with
> its key, default, where it is read, and what it controls. Sourced
> from upstream `src/hooks/persisted/useSettings.ts`,
> `src/hooks/persisted/useNovelSettings.ts`,
> `src/hooks/persisted/useTheme.ts`, the settings screens under
> `src/screens/settings/`, and the database constants in
> `src/database/constants.ts` at commit `639a2538`.

The new app's state-management layer (Zustand stores or equivalent)
must reproduce this exact key set so backups round-trip per
[`docs/backup/format.md`](../backup/format.md).

## 1. Top-level MMKV keys

These map 1:1 to JSON-encoded objects in MMKV.

| Key | Type | Hook | Settings screen |
|---|---|---|---|
| `APP_SETTINGS` | `AppSettings` | `useAppSettings` | More → Settings → General + Appearance + Library |
| `BROWSE_SETTINGS` | `BrowseSettings` | `useBrowseSettings` | More → Browse settings |
| `LIBRARY_SETTINGS` | `LibrarySettings` | `useLibrarySettings` | Library tab top-bar settings sheet |
| `CHAPTER_GENERAL_SETTINGS` | `ChapterGeneralSettings` | `useChapterGeneralSettings` | Reader bottom-sheet → General tab |
| `CHAPTER_READER_SETTINGS` | `ChapterReaderSettings` | `useChapterReaderSettings` | Reader bottom-sheet → Theme/Font tabs |
| `<novelId>` (numeric string) | `NovelSettings` | `useNovelSettings` | Novel detail → settings sheet |
| `APP_THEME` | `AppTheme` (one of 9) | `useTheme` | More → Settings → Appearance → Theme |
| `IS_ONBOARDED` | `boolean` | `useMMKVBoolean('IS_ONBOARDED')` | First-launch onboarding |
| `APP_USER_AGENT` | `string` | `useUserAgent` | More → Settings → Advanced → User agent |
| `SELF_HOST_BACKUP` | `{ url, headers }` | `useSelfHost` | Backup → Self-host (excluded from backup zip) |
| `LAST_UPDATE_TIME` | `string` (ISO) | `useUpdates` | Internal — last time library updates ran |
| `SHOW_LATEST_NOVELS:<pluginId>` | `boolean` | per-plugin toggle | Browse → source filter sheet |
| `<plugin.id>:*` | various | `@libs/storage` plugin scoping | per-plugin |

The plugin runtime can write any key prefixed with `<plugin.id>:` via
`@libs/storage` — these are **not** part of the typed catalog but are
preserved in backups.

## 2. `AppSettings`

```ts
interface AppSettings {
  // General
  incognitoMode: boolean;            // default: false
  disableHapticFeedback: boolean;    // default: false

  // Appearance
  showHistoryTab: boolean;           // default: true
  showUpdatesTab: boolean;           // default: true
  showLabelsInNav: boolean;          // default: true
  useFabForContinueReading: boolean; // default: false
  disableLoadingAnimations: boolean; // default: false

  // Library
  downloadedOnlyMode: boolean;       // default: false
  useLibraryFAB: boolean;            // default: false

  // Update
  onlyUpdateOngoingNovels: boolean;  // default: false
  updateLibraryOnLaunch: boolean;    // default: false
  downloadNewChapters: boolean;      // default: false
  refreshNovelMetadata: boolean;     // default: false

  // Download
  chapterDownloadCooldownMs?: number; // default: 1000 (DEFAULT_CHAPTER_DOWNLOAD_COOLDOWN_MS)

  // Novel
  hideBackdrop: boolean;             // default: false
  defaultChapterSort: ChapterOrderKey; // default: 'positionAsc'
}
```

`ChapterOrderKey` lives in `src/database/constants.ts`:
`'positionAsc' | 'positionDesc' | 'sourceAsc' | 'sourceDesc'`.

## 3. `BrowseSettings`

```ts
interface BrowseSettings {
  showMyAnimeList: boolean;       // default: true
  showAniList: boolean;           // default: true
  globalSearchConcurrency?: number; // default: 3
}
```

`globalSearchConcurrency` caps how many sources query in parallel
during global search. Larger values are faster but rate-limit more
sources.

## 4. `LibrarySettings`

```ts
interface LibrarySettings {
  sortOrder?: LibrarySortOrder;       // default: DateAdded_DESC
  filter?: LibraryFilter;             // default: undefined
  showDownloadBadges?: boolean;       // default: true
  showUnreadBadges?: boolean;         // default: true
  showNumberOfNovels?: boolean;       // default: false
  displayMode?: DisplayModes;         // default: Comfortable
  novelsPerRow?: number;              // default: 3
  incognitoMode?: boolean;            // default: false
  downloadedOnlyMode?: boolean;       // default: false
}
```

Enums (`src/screens/library/constants/constants.ts`):

- `LibrarySortOrder` — `DateAdded_DESC`, `DateAdded_ASC`, `Alphabetic_ASC`, `Alphabetic_DESC`, `UnreadChapters`, `RecentlyRead`, `LastUpdated`, etc.
- `DisplayModes` — `Compact`, `Comfortable`, `CoverOnly`, `List`.
- `LibraryFilter` — bitfield: downloaded only, unread only, completed only, etc.

## 5. `ChapterGeneralSettings` (per-reader behavior)

```ts
interface ChapterGeneralSettings {
  keepScreenOn: boolean;              // default: true
  fullScreenMode: boolean;            // default: true
  pageReader: boolean;                // default: false (scroll mode)
  swipeGestures: boolean;             // default: false
  showScrollPercentage: boolean;      // default: true
  useVolumeButtons: boolean;          // default: false  ← cut, see prd.md §3
  volumeButtonsOffset: number | null; // default: null   ← cut
  showBatteryAndTime: boolean;        // default: false
  autoScroll: boolean;                // default: false
  autoScrollInterval: number;         // default: 10 (seconds)
  autoScrollOffset: number | null;    // default: null
  verticalSeekbar: boolean;           // default: true
  removeExtraParagraphSpacing: boolean; // default: false
  bionicReading: boolean;             // default: false
  tapToScroll: boolean;               // default: false
  TTSEnable: boolean;                 // default: true   ← cut
}
```

The cut fields are kept in the type for **backup compatibility**
(round-trip with upstream) but are not acted on by the rewrite.

## 6. `ChapterReaderSettings` (typography + theme)

```ts
interface ReaderTheme {
  backgroundColor: string;
  textColor: string;
}

interface ChapterReaderSettings {
  theme: string;                       // default: '#292832' (background hex)
  textColor: string;                   // default: '#CCCCCC'
  textSize: number;                    // default: 16 (px)
  textAlign: string;                   // default: 'left'
  padding: number;                     // default: 16 (px)
  fontFamily: string;                  // default: '' (system)
  lineHeight: number;                  // default: 1.5
  customCSS: string;                   // default: ''
  customJS: string;                    // default: ''
  customThemes: ReaderTheme[];         // default: []
  tts?: {                              // ← cut, kept for backup compat
    voice?: Voice;
    rate?: number;     // default: 1
    pitch?: number;    // default: 1
    autoPageAdvance?: boolean; // default: false
    scrollToTop?: boolean;     // default: true
  };
  epubLocation: string;                // default: '' — opaque ePub.js cfi
  epubUseAppTheme: boolean;            // default: false
  epubUseCustomCSS: boolean;           // default: false
  epubUseCustomJS: boolean;            // default: false
}
```

The reader's CSS-variable wiring for these is documented in
[`docs/reader/specification.md` §9](../reader/specification.md#9-reader-settings-rendered-as-css-custom-properties).

## 7. `NovelSettings` (per-novel overrides)

Stored under MMKV key equal to `novel.id` (numeric, as a string).

```ts
interface NovelSettings {
  sort?: ChapterOrderKey;        // override default chapter sort for this novel
  filter?: ChapterFilter;        // bitfield: bookmark / downloaded / unread
  showChapterTitles?: boolean;   // default: true (false → show only chapter numbers)
}
```

## 8. `AppTheme`

Set by the user via More → Settings → Appearance → Theme. Single
string key whose value is one of the 9 themes:

- `defaultTheme` (Material 3 Default)
- `catppuccin`
- `lavender`
- `mignightDusk` (note: `mignight` not `midnight` — preserved as-is for backup compat)
- `strawberry`
- `tako`
- `tealTurquoise`
- `yinyang`
- `yotsuba`

The light/dark variants live alongside in
`src/theme/md3/<name>.ts` — copied to this repo's `src/theme/md3/`.

## 9. Excluded from backups

Per [`docs/backup/format.md` §4](../backup/format.md#4-settingjson):

- `ServiceManager.STORE_KEY` (runtime task queue)
- `OLD_TRACKED_NOVEL_PREFIX` (legacy migration scratch)
- `SELF_HOST_BACKUP` (machine-bound credentials)
- `LAST_UPDATE_TIME` (debug timestamp)

The new app honors the same exclusion list.

## 10. Cross-cutting flags worth highlighting

| Flag | What it changes | Where it bites |
|---|---|---|
| `incognitoMode` | Disables history writes and progress saves | History tab + reader save handler |
| `downloadedOnlyMode` | Library shows only downloaded chapters; Browse hides ungated sources | Library tab + Browse list |
| `disableHapticFeedback` | Suppresses every `Haptics.*` call | Bottom-bar / list-item interactions |
| `disableLoadingAnimations` | Drops Lottie loaders → static placeholders | Browse loading, novel detail loading |
| `keepScreenOn` (reader) | Wake-lock active during reader | Reader entry/exit |
| `fullScreenMode` (reader) | Hides system bars in reader | Reader entry/exit |
| `pageReader` (reader) | Switches reader between scroll and paged | Reader layout |

## 11. Migration strategy for the rewrite

The persisted shape moves to Zustand stores backed by `tauri-plugin-sql`
(or a small KV table). Recommended mapping:

| Tauri-side | Stores |
|---|---|
| `useAppSettingsStore()` | `AppSettings` |
| `useBrowseSettingsStore()` | `BrowseSettings` |
| `useLibrarySettingsStore()` | `LibrarySettings` |
| `useReaderGeneralStore()` | `ChapterGeneralSettings` (minus TTS / volume) |
| `useReaderTypographyStore()` | `ChapterReaderSettings` (minus TTS) |
| `useNovelSettingsStore()` | per-novel `NovelSettings` |
| `useThemeStore()` | `AppTheme` |
| `useUserAgentStore()` | `APP_USER_AGENT` |

Persistence: a single `kv` table (`key TEXT PRIMARY KEY, value TEXT`).
Each store reads/writes its slice as JSON. Backup pack/unpack reads
this table.

## 12. References

- `useSettings`: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/persisted/useSettings.ts>
- `useNovelSettings`: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/persisted/useNovelSettings.ts>
- `useTheme`: <https://github.com/lnreader/lnreader/blob/639a2538/src/hooks/persisted/useTheme.ts>
- DB constants: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/constants.ts>
- Library constants: <https://github.com/lnreader/lnreader/blob/639a2538/src/screens/library/constants/constants.ts>
- Theme palettes (copied verbatim into this repo): [`src/theme/md3/`](../../src/theme/md3/)
