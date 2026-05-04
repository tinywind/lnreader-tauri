# Backup Wire Format & Restore Semantics

> Tier 1.6. Round-trip-compatible wire format for backups so users can
> migrate between upstream lnreader and this rewrite without data
> loss. Sourced from upstream `src/services/backup/{utils,types}.ts`,
> `src/services/backup/{local,selfhost,drive}/`,
> `src/database/queries/_restoreMergeUtils.ts`,
> and `src/database/queries/{NovelQueries,CategoryQueries}.ts` at
> commit `639a2538`.

## 1. Backup zip layout

The backup is two zip artifacts produced together; both are stored
side-by-side at the user-chosen target.

```
data.zip
├── Version.json
├── Category.json
├── Setting.json
└── NovelAndChapters/
    ├── 1.json
    ├── 2.json
    └── …  (one file per novel, named <novelId>.json)

download.zip
└── <files mirroring the app's downloaded chapter directory>
```

Constants from `src/services/backup/types.ts`:

```ts
enum ZipBackupName  { DATA = 'data.zip',     DOWNLOAD = 'download.zip' }
enum BackupEntryName {
  VERSION = 'Version.json',
  CATEGORY = 'Category.json',
  SETTING = 'Setting.json',
  NOVEL_AND_CHAPTERS = 'NovelAndChapters',
}
```

The new app must produce these exact filenames (case-sensitive).

## 2. `Version.json`

```json
{ "version": "2.0.3" }
```

Just the upstream `package.json` `version`. Restore does **not** check
the value (no migration on this field today). Reserved as a
forward-compatibility hook — a future restorer might consult it.

## 3. `Category.json`

Array of categories. Each entry is the `Category` row plus a
denormalized `novelIds` array:

```ts
type BackupCategoryEntry = {
  id: number;
  name: string;
  sort: number | null;
  novelIds: number[]; // local-DB IDs of novels in this category, at backup time
};
```

`novelIds` references **the IDs that lived in the source DB**. On
restore, the host maps them through the `novelIdMap` produced during
the novel restore phase to the live DB IDs (see §6).

## 4. `Setting.json`

A flat object of MMKV key → value:

```ts
type BackupSettings = Record<string, string | boolean>;
```

Excluded keys (upstream `src/services/backup/utils.ts:31-53`):

- `ServiceManager.STORE_KEY` — runtime task queue, not user data.
- `OLD_TRACKED_NOVEL_PREFIX` — pre-tracker-migration leftovers.
- `SELF_HOST_BACKUP` — the user's self-host credentials, intentionally
  not portable across machines.
- `LAST_UPDATE_TIME` — debugging timestamp; restore would lie about
  the new install's last update.

Values are stored as strings (the original type from MMKV) plus
booleans. Numbers are not stored as numbers — they are part of the
JSON-encoded string under one of the structured keys (e.g. the
`CHAPTER_READER_SETTINGS` value is a stringified JSON object).

## 5. `NovelAndChapters/<novelId>.json`

One file per novel. Shape:

```ts
type BackupNovelFile = NovelRow & {
  chapters: ChapterRow[];
  cover: string | null; // path-relative; the app prefix is stripped at backup time
};
```

`NovelRow` and `ChapterRow` are exactly the drizzle schema row shapes
in `src/database/schema/{novel,chapter}.ts`. The chapter list is
serialized inline rather than across files.

`cover` is normalized at backup: any leading
`file:///<ROOT_STORAGE>/` prefix is stripped so the path is
relative to the new install's storage root. On restore, the prefix is
re-added.

## 6. `download.zip`

A mirror of the app's chapter-download directory tree. Upstream stores
chapter HTML / EPUB blobs under
`<ExternalDirectoryPath>/files/<pluginId>/<novelId>/<chapterId>/index.html`
(plus per-chapter image directories). The zip preserves this tree so
restore can simply unzip into the new install's equivalent path.

When users only want to migrate library + reading progress without
re-downloading chapters, they can transfer `data.zip` alone. The
restore handles missing `download.zip` by leaving `isDownloaded` flags
set — the app will try to re-download on next read.

## 7. Two restore modes

`type RestoreMode = 'overwrite' | 'merge'` (in
`src/database/queries/_restoreMergeUtils.ts`). The upstream Backup
screen offers both as separate buttons.

### 7.1 `overwrite`

Replace the live row with the backup row. Equivalent to "treat the
backup as authoritative."

### 7.2 `merge` (added in upstream commit `401aa7c8`)

Field-by-field non-destructive merge. The rules are codified in the
helpers from `_restoreMergeUtils.ts`:

| Helper | Rule |
|---|---|
| `maxDateString(a, b)` | The later ISO-8601 timestamp; nulls lose. |
| `orBool(a, b)` | `true` if either side is true (e.g. `bookmark`, `inLibrary`). |
| `andUnread(a, b)` | `true` only if **both** sides are still unread; once either has been read the chapter stays read. |
| `maxNum(a, b)` | The numeric max; nulls lose. Used for `progress`, `position`, etc. |
| `preferExisting(existing, backup)` | Existing non-empty wins; falls back to backup. Used for fields the user may have curated locally (`cover`, `summary`, `author`). |

Conceptually:

- **Reading state** (`unread`, `progress`, `readTime`, `lastReadAt`) — pick the further-along value across both sides.
- **Library membership / bookmarks** (`inLibrary`, `bookmark`) — sticky-on; once either side opted in, stays in.
- **Curated text** (`cover`, `summary`, `author`, `artist`, `genres`) — keep what the user already has locally; backfill from backup only when local is empty.
- **Counts** (`chaptersDownloaded`, `chaptersUnread`, `totalChapters`, `totalPages`) — recomputed at the end of restore from the merged chapter rows; not blindly copied.

### 7.3 Settings merge (`merge` mode only)

Settings keys are merged with `lodash.mergeWith` per
`src/services/backup/utils.ts:58-101`:

- For primitive values: backup wins.
- For arrays: **backup replaces wholesale**. Element-wise array merging
  surprises users (custom theme list, repository list, etc. should
  feel like atomic units).
- For nested objects: recursive merge.
- If existing value is missing or empty string, restore wins.
- If backup value is non-string (e.g. `boolean`), it overwrites.

This rule is delicate; copy verbatim.

## 8. Novel ID remapping (`novelIdMap`)

In `merge` mode the live DB may already have a row matching the backup
novel by `(pluginId, path)` unique key; in that case the live row's
`id` is reused. New backup novels get fresh auto-increment IDs. The
restorer maintains `Map<backupNovelId, liveNovelId>` and uses it when
rewriting category memberships (`Category.json.novelIds`).

In `overwrite` mode the IDs match because the backup is the
authoritative source — but the map is still threaded through for
defensive programming.

## 9. Order of operations

`utils.ts:218-355` runs the restore in this order:

1. **Novels** — for each `<novelId>.json` in `NovelAndChapters/`,
   call `_restoreNovelAndChapters(backupNovel, { mode, novelIdMap })`.
   Populates `novelIdMap`.
2. **Categories** — `Category.json` → `_restoreCategory(category, { mode, novelIdMap })` for each entry; uses the map to attach novels.
3. **Settings** — `Setting.json` → `restoreMMKVData(data, mode)` per
   §7.3.

Errors per-row are caught, counted, and surfaced as toasts. Missing
files (e.g. an old backup that lacks a particular section) are
tolerated.

## 10. `selfhost` mode (matches upstream)

In addition to local file backups, upstream supports an HTTP target.

### 10.1 Backup

POST `<configured base URL>/data` with multipart body `data.zip` and
`download.zip`. Headers: whatever the user configured (Bearer token,
basic auth, etc.). Server simply stores the two files keyed by
device id.

### 10.2 Restore

GET the same endpoints, save to the local cache, run the local
restore path on the downloaded zips.

The credentials (`SELF_HOST_BACKUP` MMKV key) are intentionally
excluded from the backup itself — see §4. They are entered manually
on each install.

## 11. `drive` mode (cut)

Upstream has Google Drive backup using
`@react-native-google-signin/google-signin`. Per `prd.md §3` this is
**not** in scope for the rewrite. The directory `src/services/backup/drive/`
exists in upstream as reference but is not ported.

## 12. Implementing in Tauri

Recommended Rust crates and structure:

```
src-tauri/
├── src/
│   └── backup/
│       ├── mod.rs           // commands: backup_create, backup_restore_local, backup_restore_url
│       ├── pack.rs          // serialize DB → zip via `zip` crate + `serde_json`
│       ├── unpack.rs        // unzip + deserialize; supports both `overwrite` and `merge`
│       └── merge.rs         // direct port of _restoreMergeUtils.ts
└── Cargo.toml               // zip = "2", serde = "1", serde_json = "1"
```

JS side calls `invoke('backup_create', { mode: 'local' | 'selfhost', target: ... })` and `invoke('backup_restore_local', { path, mode: 'overwrite' | 'merge' })`. The file-picker UX uses `tauri-plugin-dialog` on desktop and iOS, and `tauri-plugin-android-fs` (SAF document tree) on Android — see `prd.md §6.2`.

## 13. Round-trip test (must-pass before declaring parity)

1. Use upstream lnreader to produce `data.zip` + `download.zip` from a real library.
2. Install lnreader-tauri on a different machine, pick "Restore from upstream backup," select both files.
3. Verify:
   - Library tab shows the same novels in the same categories.
   - Each novel detail shows the same chapter count, with the same
     read/unread states.
   - Reading progress for a few chapters matches.
   - Reader settings (theme, font size) match.
4. Use lnreader-tauri to produce a fresh `data.zip` + `download.zip`.
5. Open upstream lnreader, restore from those files.
6. Same verification.

If any field drifts in either direction, the merge / pack / unpack
logic has a bug — fix it before shipping a release.

## 14. References

- Backup utils (pack/unpack core): <https://github.com/lnreader/lnreader/blob/639a2538/src/services/backup/utils.ts>
- Backup types: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/backup/types.ts>
- Restore merge helpers: <https://github.com/lnreader/lnreader/blob/639a2538/src/database/queries/_restoreMergeUtils.ts>
- Local backup target: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/backup/local>
- Self-host target: <https://github.com/lnreader/lnreader/blob/639a2538/src/services/backup/selfhost>
- Deep-merge restore landing commit: <https://github.com/lnreader/lnreader/commit/401aa7c8>
