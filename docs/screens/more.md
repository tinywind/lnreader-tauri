# More Tab

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/more/MoreScreen.tsx` (lines 1-218) — landing page
> - `src/screens/more/components/MoreHeader.tsx` (lines 1-56) — logo header
> - `src/screens/more/components/RemoveDownloadsDialog.tsx` (lines 1-62) — confirm dialog (used by `DownloadsScreen`, not the More landing page itself)
> - `src/navigators/MoreStack.tsx` (lines 1-53) — sub-screen routing
> - `src/navigators/BottomNavigator.tsx` (lines 19-129) — `More` tab registration
> - `src/navigators/types/index.ts` (lines 62-119) — `MoreStackParamList` and prop types
> - `strings/languages/en/strings.json` (lines 365-370) — `moreScreen.*` keys

## 1. Purpose

The More tab is the catch-all bottom-tab landing page for everything that does
not fit on Library / Updates / History / Browse. It exposes two quick toggles
(downloaded-only mode, incognito mode), a live indicator for the background
task queue, and navigation entries to Downloads, Categories, Statistics,
Settings, and About. It is intentionally shallow — almost every row is a
hand-off to a dedicated sub-screen documented elsewhere.

## 2. Routes / Entry points

- Entry: bottom tab `More` (`BottomNavigator.tsx:122-128`), always rendered
  (no AppSettings flag hides this tab).
- Tap-on-active behaviour: tapping the `More` tab while it is already focused
  jumps directly to `MoreStack > SettingsStack > Settings`
  (`MoreScreen.tsx:31-46`). Useful as a one-tap shortcut into Settings.
- Children of `MoreStack` (`MoreStack.tsx:42-51`):
  - `SettingsStack` (initial) → `Settings` and seven settings sub-pages
    (see [`settings.md`](./settings.md)).
  - `About` → `screens/more/About.tsx`.
  - `TaskQueue` → `screens/more/TaskQueueScreen.tsx`.
  - `Downloads` → `screens/more/DownloadsScreen.tsx`.
  - `Categories` → `screens/Categories/CategoriesScreen.tsx`.
  - `Statistics` → `screens/StatsScreen/StatsScreen.tsx`.

## 3. Layout

Vertical `ScrollView` inside a `SafeAreaView` (top/bottom excluded so the
status bar stays translucent). From top to bottom (`MoreScreen.tsx:48-197`):

1. `MoreHeader` — empty title `Appbar` plus a centered tinted app logo
   (90×90, `MoreHeader.tsx:31-37`) and a divider.
2. `List.Section` containing:
   - Toggle row `cloud-off-outline` — **Downloaded only** with description
     "Filters all novels in your library" + right-aligned `Switch`.
   - Toggle row `glasses` — **Incognito mode** with description
     "Pauses reading history" + right-aligned `Switch`.
   - `List.Divider`.
   - `progress-download` — **Task Queue** (description shows
     `${queue.length} remaining` when non-empty).
   - `folder-download` — **Downloads** (`common.downloads`).
   - `label-outline` — **Categories** (`common.categories`).
   - `chart-line` — **Statistics** (`statsScreen.title`).
   - `List.Divider`.
   - `cog-outline` — **Settings** (`common.settings`).
   - `information-outline` — **About** (`common.about`).

Item order is hard-coded; nothing is reorderable or hideable today.

## 4. Major UI components

- `SafeAreaView`, `ScrollView` — from `react-native` / `@components`.
- `MoreHeader` — local; shows the empty `Appbar` and logo
  (`components/MoreHeader.tsx`). Reused by `About.tsx` (with `goBack`).
- `List.Section`, `List.Item`, `List.Icon`, `List.Divider` — shared
  `@components` wrappers around react-native-paper list primitives.
- `Pressable` rows for the two toggles (custom layout because the right side
  hosts a `Switch`, not a chevron) — `MoreScreen.tsx:58-123`.
- `Switch` — `@components/Switch/Switch`.
- `RemoveDownloadsDialog` is in this folder but is owned by
  `DownloadsScreen`, not the landing page (`MoreScreen.tsx` does not import
  it).

## 5. States

Loaded (always; no loading state — it's a static menu).

Sub-state surfaced inline:
- Task Queue row description is empty when the MMKV-backed queue is empty
  and `${n} remaining` otherwise (`MoreScreen.tsx:127-131`,
  `services/ServiceManager.ts:83` `STORE_KEY = 'APP_SERVICE'`).
- The two toggles reflect the current `LibrarySettings` (`useLibrarySettings`)
  values immediately on mount.

## 6. Interactions

- Tap **Downloaded only** row or its switch → flips
  `librarySettings.downloadedOnlyMode` (`MoreScreen.tsx:25-26`).
- Tap **Incognito mode** row or its switch → flips
  `librarySettings.incognitoMode` (`MoreScreen.tsx:28-29`).
- Tap **Task Queue / Downloads / Categories / Statistics / Settings / About**
  → `navigation.navigate('MoreStack', { screen: ... })`
  (`MoreScreen.tsx:133-193`).
- Re-tap the active **More** bottom tab → preventDefault and jump to
  `SettingsStack > Settings` (`MoreScreen.tsx:31-46`).

There are no long-press, swipe, or context-menu interactions on this screen.

## 7. Affecting settings

`MoreScreen` itself is unaffected by AppSettings — it is always rendered
identically. The flags called out for the broader nav shell live in
`BottomNavigator.tsx:23-27` and gate **other** tabs, not items inside this
screen:

- `showHistoryTab` (default `true`) — show/hide the **History** bottom tab
  (`BottomNavigator.tsx:103-111`).
- `showUpdatesTab` (default `true`) — show/hide the **Updates** bottom tab
  (`BottomNavigator.tsx:94-102`).
- `showLabelsInNav` (default `true`) — render text labels under bottom-tab
  icons (`BottomNavigator.tsx:67`, consumed by `BottomTabBar`).
- `useFabForContinueReading` (default `false`) — switches the Library
  "continue reading" affordance between FAB and inline button. Listed by the
  task brief but only consumed in `screens/library`, `screens/novel`, and
  `components/BottomTabBar` per `useSettings.ts:51,166`. Has no direct effect
  on this More screen.

The two toggles on this screen mutate `LibrarySettings` (not `AppSettings`):
`downloadedOnlyMode` and `incognitoMode` — see
[`../settings/catalog.md`](../settings/catalog.md) lines 219-220.

## 8. Data this screen reads/writes

Read:
- `useTheme()` — current theme palette.
- `useLibrarySettings()` — `incognitoMode`, `downloadedOnlyMode`
  (`MoreScreen.tsx:19-23`).
- `useMMKVObject<BackgroundTask[]>(ServiceManager.manager.STORE_KEY)` — live
  task-queue length for the badge (`MoreScreen.tsx:16-18`).

Write:
- `setLibrarySettings({ downloadedOnlyMode })` and
  `setLibrarySettings({ incognitoMode })` via the toggles.

No DB reads, no plugin calls, no network. Counters like "library count" are
**not** displayed on this screen (the brief asked to check; upstream does not
do this).

## 9. Edge cases / gotchas

- The "Task Queue" row label is a hard-coded English string `'Task Queue'`
  (`MoreScreen.tsx:126`), not an i18n key — every other label on the page
  uses `getString(...)`. UNKNOWN whether this is intentional or an oversight.
- The "More" bottom-tap handler unconditionally navigates to Settings even
  if the user is mid-scroll on the More page. This is a design choice
  (Settings is the most-used child) but does mean the More page itself is
  hard to "scroll back to top" by tapping the tab again.
- `RemoveDownloadsDialog.tsx` lives under `screens/more/components/` but is
  consumed by `DownloadsScreen`, not the More landing page. Treat it as
  Downloads-screen scope when porting.
- The header logo ships from `assets/logo.png` and is tinted with
  `theme.onSurface` (`MoreHeader.tsx:34`) — light/dark theme switches it for
  free; do not bake a colored asset.

## 10. Tauri-side notes

- Mantine equivalents: `<NavLink>` or `<List>` rows with `leftSection` icons
  (Tabler icons), `<Switch>` for the two toggles, `<Divider>` between groups,
  `<AppShell.Header>` or a custom header for the logo block.
- The "tap active tab to jump to Settings" behaviour does not have a direct
  Tauri analogue (no native bottom tab). Decide whether the desktop shell
  uses a sidebar (in which case "More" might collapse into separate sidebar
  groups) or keeps a tab metaphor; flag this for the navigation spec.
- Should the entry list be configurable (reorder / hide individual rows)?
  Not supported upstream. If desired, add it as an `appSettings.moreMenu`
  array and document the keys in [`../settings/catalog.md`](../settings/catalog.md).
- Task-queue badge today reads MMKV directly. In the Tauri rewrite the
  background task service surface is still TBD — wire this row to whatever
  reactive task store replaces `ServiceManager`.

## 11. References

- Upstream files: see "Sourced from" block at the top.
- Sibling settings page: [`settings.md`](./settings.md) (covers each
  sub-screen reachable from this menu).
- Settings key catalogue: [`../settings/catalog.md`](../settings/catalog.md)
  (entries `downloadedOnlyMode`, `incognitoMode`, `showHistoryTab`,
  `showUpdatesTab`, `showLabelsInNav`, `useFabForContinueReading`).
- Handoff index: [`../HANDOFF.md`](../HANDOFF.md).
