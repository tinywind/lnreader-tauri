# PRD: LNReaderTauri

> Tauri 2 light-novel reader for **Windows, Linux, and Android**.
>
> Status: Draft v2 (2026-05-05)
> Owner: tinywind
> License: MIT

---

## 1. Overview

LNReaderTauri is a Tauri 2 light-novel reader built from scratch. It
is **inspired by** upstream
[`lnreader/lnreader`](https://github.com/lnreader/lnreader) (a
React-Native + Expo + Fabric reader) but is **a separate, independent
project** with no upstream compatibility constraints — no backup
round-trip, no fixed plugin contract, no MMKV key freeze, no schema
freeze.

Upstream is reference material for behaviors and edge cases, not a
binding contract.

### Why Tauri 2

A class of cross-cutting bugs in the upstream RN/Fabric stack — most
recently
[lnreader/lnreader#1835](https://github.com/lnreader/lnreader/issues/1835)
where DeX freeform window sizing breaks — does not occur on Tauri 2
because the OS WebView attaches directly to the window. The same
move buys real desktop builds, smaller binaries, and a sane plugin
model.

## 2. Goals (v0.1)

1. **Three platforms**: Windows, Linux, Android (sideload). One
   codebase.
2. **Reader feels right**: paged + scroll modes, click-zone
   navigation, font/theme settings, smooth at 60 fps on a 6-year-old
   mid-range Android.
3. **Plugin scraping**: JS-based source plugins run in a sandbox,
   able to fetch and parse novel listings / details / chapter HTML.
   Compatible-enough with the upstream plugin shape that most
   community plugins work; we own the contract.
4. **Cloudflare bypass**: hidden in-app WebView clears CF challenges
   and shares cookies with the HTTP client.
5. **Background downloads**: chapter download queue, Android
   foreground-service so it survives backgrounding.
6. **Backup**: local file backup only. Our own format. (Upstream
   `.zip` round-trip is **not** a goal; self-hosted HTTP target
   was scoped out per user direction.)
7. **Core screens**: Library, Browse, Novel detail, Reader, Updates,
   History, More/Settings.

### Non-goals

- Maintain RN/Expo/Hermes/Metro/Fabric code.
- Reproduce upstream backup `.zip` byte-for-byte.
- Reproduce upstream MMKV key set byte-for-byte.
- Reach pixel-parity with upstream RN Paper components in v0.1.

## 3. Out of scope (v0.1)

Items below may revisit in v0.2. Issues that try to add them in v0.1
are closed `wontfix`:

| Cut | Reason |
|---|---|
| **macOS / iOS builds** | No Apple Developer Program, no Apple hardware for testing. |
| **Code signing** (Win / Linux / Android) | Unsigned debug builds for v0.1. |
| **In-app auto-update** (`tauri-plugin-updater`) | Requires signing. v0.1 ships a "Latest release" link in More that opens GitHub Releases via `tauri-plugin-shell`. |
| **Upstream backup `.zip` compatibility** | We design our own format. |
| **Upstream MMKV / settings shape compatibility** | We design our own keys. |
| **Strict upstream plugin contract compatibility** | Aim for *most* upstream plugins to work; invent our own contract where simpler. |
| **TTS reading + lockscreen media controls** | Largest custom-plugin surface; not core. |
| **Volume-button page turn** | Niche; needs Android keyevent plugin. |
| **Google Drive backup** | OAuth + Drive plumbing not worth carrying. |
| **Tracker integrations** (MAL, AniList, MangaUpdates, Kitsu) | OAuth × 4, multi-vendor; minority feature. |
| **Default-category settings sub-page** | Upstream stub never worked. Default stays id=1. |

## 4. Architecture

### 4.1 Process / window topology

```
┌────────────────────────────────────────────────────────────────────┐
│ Tauri host (Rust)                                                  │
│  ├── Main WebView (visible)  ← React app: all UI screens           │
│  ├── Hidden WebView (off-screen, on demand for CF bypass)          │
│  ├── Background async task pool                                    │
│  │     ← chapter download queue, plugin scrape jobs, backups       │
│  └── Plugin layer (Rust + Kotlin for Android service)              │
│        ├── tauri-plugin-fs                                         │
│        ├── tauri-plugin-sql           (SQLite via sqlx)            │
│        ├── tauri-plugin-http          (HTTP w/ cookie jar)         │
│        ├── tauri-plugin-upload        (download w/ progress)       │
│        ├── tauri-plugin-deep-link     (lnreader:// scheme)         │
│        ├── tauri-plugin-notification                               │
│        ├── tauri-plugin-clipboard-manager                          │
│        ├── tauri-plugin-haptics                                    │
│        ├── tauri-plugin-dialog                                     │
│        ├── tauri-plugin-shell                                      │
│        ├── tauri-plugin-android-fs    (Android SAF document tree)  │
│        └── (custom) lnreader-fg-service (Android)                  │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Layering

- **`/src` (TypeScript + React 19)** — UI, routing, state, plugin
  scraper modules.
- **`/src-tauri/src` (Rust)** — IPC commands, HTTP client, scraper
  runtime, hidden-webview controller, foreground-service controller,
  EPUB parser bindings.
- **`/src-tauri/gen/android`** — generated Android project shell.

## 5. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Native shell | Tauri 2.x | One Rust core; real desktop + Android. |
| Frontend | React 19 | Most popular framework; Tauri has first-class examples. |
| **UI** | **Mantine** (`@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `@mantine/modals`, `@mantine/dates` as needed) | Batteries-included React UI library — 100+ components out of the box (Modal, Drawer, Notifications, Slider, ColorPicker, etc). Cuts implementation time on the 7 screens this app needs. Design isn't a primary goal for v0.1. |
| Routing | TanStack Router | Type-safe routes; better than `react-router` for tab + stack patterns. |
| State | Zustand + TanStack Query | Zustand for client state; Query for plugin/network IO with cache invalidation. |
| Animation | Framer Motion + CSS | Compositor-friendly only — `transform`, `opacity`, `clip-path`, `filter`. Never `width`, `height`, `top`, `left`. |
| ORM | drizzle-orm + `drizzle-orm/sqlite-proxy` | Proxy adapter calls `tauri-plugin-sql` for execution. |
| DB | SQLite via `tauri-plugin-sql` | sqlx underneath. |
| HTTP | `tauri-plugin-http` + Rust `reqwest` | Cookie jar built-in. |
| Worker | Web Worker | Plugin sandbox + cheerio HTML parsing offloaded from the UI thread. |
| EPUB | `rbook` (Rust) | Format-agnostic EPUB 2/3 parser. |
| Zip | `zip` (Rust) | Streaming zip read/write. |
| Build | Vite (frontend) + Cargo (backend) | Standard. |
| Pkg mgr | pnpm | Per user direction. |
| Node | 22 LTS | Active support through 2027. |

## 6. Tauri plugins we use

### 6.1 Official (drop-in)

`tauri-plugin-fs`, `-sql`, `-http`, `-upload`, `-deep-link`,
`-notification`, `-clipboard-manager`, `-haptics`, `-dialog`,
`-shell`.

### 6.2 Community

| Replaces | Plugin | Notes |
|---|---|---|
| Android SAF document tree | [`tauri-plugin-android-fs`](https://crates.io/crates/tauri-plugin-android-fs) | Folder picker, persistent SAF URIs. |
| Android lifecycle (foreground/background) | [`tauri-plugin-app-control`](https://crates.io/crates/tauri-plugin-app-control) | Used to gate FG service start/stop. |
| Disk cache for plugin scrape responses | [`tauri-plugin-cache`](https://crates.io/crates/tauri-plugin-cache) | Optional optimization. |

### 6.3 Custom (small)

- **CF hidden-WebView controller** (`/src-tauri/src/cf_webview.rs`)
  — ~300 LoC. Glue code over Tauri 2's `WebviewWindow` +
  `Webview::cookies_for_url` APIs.
- **Android foreground-service plugin**
  (`/src-tauri/plugins/lnreader-fg-service`) — ~300 LoC, mirroring
  [`tauri-plugin-holochain-service`](https://crates.io/crates/tauri-plugin-holochain-service).

### 6.4 Rust crates (direct)

- [`rbook`](https://crates.io/crates/rbook) — EPUB 2/3 parser.
- [`zip`](https://crates.io/crates/zip) — zip read/write.
- `reqwest` — HTTP client (already inside `tauri-plugin-http`).
- `tokio`, `futures` — async runtime.

## 7. Bespoke engineering surface

What this repo's commits actually produce:

1. **Plugin scraper runtime** (JS sandbox, Web Worker).
2. **CF hidden-WebView controller** (Rust + JS shim).
3. **Android foreground-service plugin**.
4. **All UI** — 7 main screens (web stack).
5. **Backup format + pack/unpack** (our own).
6. **Reader content runtime** — paged + scroll, click zones,
   font/theme.

Everything else is configuration of plugins listed in §6.

## 8. Sprints

Each sprint is one focused week. Don't work on Sprint N+1 until
Sprint N's acceptance is met.

### Sprint 0 — toolchain, scaffold, DB bridge

- `pnpm create tauri-app` with React + TypeScript + Vite.
- Mantine wired (`MantineProvider` at root, `@mantine/core` styles
  imported); render one `Button` end-to-end as smoke.
- TanStack Router + Zustand + TanStack Query.
- `tauri-plugin-sql` wired; drizzle-proxy adapter resolves a real
  SQLite file at the platform-correct app-data path.
- **Fresh** drizzle schema (Novel, Chapter, Category, NovelCategory,
  Repository) — designed for this project, not copied from upstream.
- README + this PRD + LICENSE present at repo root.
- CI matrix on PR: Linux + Windows desktop builds. Android skipped
  on PR (matrix runs only on tag releases).

**Acceptance**

- `cargo check && pnpm tsc --noEmit && pnpm tauri build` green for
  Win + Linux.
- `pnpm tauri android dev` launches a "Hello DB row" screen on a
  real device or emulator.

### Sprint 1 — Library tab end-to-end

- Library route renders a real grid bound to the local DB.
- Categories drawer, search bar, long-press selection menu (UI shell
  only — selection actions wired in Sprint 6).

**Acceptance**

A user with a manually-seeded DB row sees the corresponding novel on
the Library screen on all 3 target platforms.

### Sprint 2 — plugin scraping + Cloudflare hidden-WebView (gated)

- Port one upstream JS plugin scraper (e.g., BoxNovel) as a smoke
  test.
- HTTP client integrated with `tauri-plugin-http` cookie jar.
- **CF hidden-webview controller** in Rust (`cf_webview.rs`).
- Browse tab can list and search at least one CF-protected source.
- Global search uses `AbortController` + `p-limit` (default
  `concurrency = 3`).
- Deep link `lnreader://repo/add?url=...` verified end-to-end on
  real Android hardware.

**Acceptance**

- Calling a CF-protected scraper from Browse returns parsed novel
  listings without the user seeing the Turnstile challenge.
- Cookie jar in `reqwest` contains the cookies set inside the hidden
  webview after the bypass.
- Typing a new query while a global search is in flight cancels
  every outstanding network request within 100 ms.

**Gate**: if this can't complete in one week, escalate to the user
before continuing — the CF bypass is the load-bearing assumption of
the rewrite.

### Sprint 3 — Reader (paged + scroll, single chapter)

- Reader route opens a chapter and renders downloaded HTML.
- Paged mode (`column-width` CSS) and scroll mode toggle.
- Click-zone classification (top / middle / bottom thirds) and
  keyboard nav (`PageDown`, arrows) ported from upstream
  `assets/js/core.js`.
- Footer bottom-sheet with prev/next/menu/settings/source.
- Font, line-height, theme settings persisted.

**Acceptance**

Reading a chapter on each platform feels at least as smooth as
upstream on the same device, including freeform/multi-window on
Android.

### Sprint 4 — background download (Android foreground service)

- Chapter download queue (`/src-tauri/src/download_queue.rs`) with
  progress events.
- Android FG service plugin mirroring
  `tauri-plugin-holochain-service`: starts on first queued job,
  stops on idle, posts a persistent "downloading N/M chapters"
  notification.
- Desktop: in-app queue, no extra service.

**Acceptance**

Queueing 50 chapters and immediately backgrounding the app on
Android continues downloading to completion with the foreground
notification visible.

### Sprint 5 — backup & restore (local only)

- "Create backup" produces a `.zip` with our own format
  (`version.json` + DB dump + chapter HTML blobs). Format documented
  in `docs/backup/format-v0.1.md` (written during the sprint).
- Local file flow uses `tauri-plugin-dialog` (desktop) and
  `tauri-plugin-android-fs` (Android SAF document tree).
- **Self-hosted HTTP backup target — dropped per user direction.**
  v0.1 ships local file backup only; users wanting cloud sync run
  their own file-sync layer (Syncthing, OneDrive, etc.) on the
  backup folder.

**Acceptance**

Round-trip lnreader-tauri → file → lnreader-tauri is loss-free for
library, categories, downloaded chapters, and progress on each
target platform.

### Sprint 6 — remaining UI surface + polish

- Browse tab full source list, plugin update / install / delete.
- Updates tab, History tab, More/Settings (themes, reader settings,
  plugins, repositories, advanced).
- Crash reporting opt-in via `sentry-tauri` (default **off**).
- App icon, splash, deep-link tests, packaging.
- "Latest release" link in More that opens the latest GitHub Release
  page via `tauri-plugin-shell` (substitute for in-app auto-update,
  which is deferred to v0.2).

**Acceptance**

- All 7 screens functional.
- Public 0.1.0 release artifacts: `.exe`, `.AppImage`, `.deb`,
  `.apk` — all unsigned debug builds.

## 9. Acceptance criteria (cross-cutting)

- [ ] All 3 target platforms build and launch from a clean checkout
      using only `pnpm install && pnpm tauri build` (or
      `tauri android build` for Android).
- [ ] Cloudflare-protected source fetches succeed without
      user-visible challenges.
- [ ] Reader maintains 60 fps on a 6-year-old mid-range Android
      phone.
- [ ] DeX freeform window renders the entire UI to the freeform
      bounds (the upstream issue #1835 regression class is gone by
      construction).
- [ ] Total APK size ≤ 25 MB; desktop bundle ≤ 15 MB.
- [ ] License headers (MIT). Upstream attribution paragraph in
      README and About screen.

## 10. Risks

| Risk | P | I | Mitigation |
|---|---|---|---|
| CF cookie sync brittle on Android (different webview engine than reqwest's TLS) | M | H | Sprint 2 gate. Fallback: `reqwest-impersonate` (mimics browser TLS fingerprints from Rust). |
| Android FG service plugin harder than holochain reference | M | M | Vendor `tauri-plugin-holochain-service` source and strip holochain-specific code. |
| `tauri-plugin-android-fs` unmaintained | L | M | Pin commit; we own the fork (~1k LoC) if needed. |
| Drizzle proxy slower than direct sqlx for big libraries | M | M | Benchmark in Sprint 0 with a 1000-novel fixture; drop drizzle for queries if needed. |
| `rbook` lacks a feature we need | L | L | Wrap usage in a thin module; swap to `epub` crate if needed. |
| UI rewrite blows the time budget | H | M | Use Mantine defaults; do not chase pixel parity with RN Paper. |

## 11. Reference apps

- [Readest](https://github.com/readest/readest) — Tauri 2
  cross-platform reader (Foliate-inspired, Next.js + Tauri). Best
  example overall.
- [Alexandria](https://github.com/btpf/Alexandria) — minimal Tauri +
  Epub.js reader. Useful for keyboard nav and bottom-bar UX.
- [tauri-rbook](https://github.com/xudong7/tauri-rbook) — direct
  `rbook` integration in a Tauri app.
- [Holochain Android service runtime](https://github.com/holochain/android-service-runtime)
  — load-bearing reference for Sprint 4.

## 12. Open questions

1. Tray icon and Android quick-tile — defer to v0.2.
2. Sentry vs Glitchtip vs none — default **none** for v0.1; opt-in
   `sentry-tauri` if added in Sprint 6.
3. Reader fonts — copy from upstream `assets/fonts/` (MIT-licensed).

## 13. References

### Tauri 2

- [Tauri 2.0 stable release announcement](https://v2.tauri.app/blog/tauri-20/)
- [Tauri 2 plugin reference](https://v2.tauri.app/plugin/)
- [`Webview::cookies` PR (commit cedb24d)](https://github.com/tauri-apps/tauri/commit/cedb24d494b84111daa3206c05196c8b89f1e994)
- [Cookie management — DeepWiki for `tauri-plugin-http`](https://deepwiki.com/tauri-apps/tauri-plugin-http/6.1-cookie-management)

### Community

- [`tauri-plugin-android-fs`](https://crates.io/crates/tauri-plugin-android-fs)
- [`tauri-plugin-holochain-service`](https://crates.io/crates/tauri-plugin-holochain-service)
- [`tauri-plugin-app-control`](https://crates.io/crates/tauri-plugin-app-control)
- [`tauri-plugin-cache`](https://crates.io/crates/tauri-plugin-cache)
- [`awesome-tauri`](https://github.com/tauri-apps/awesome-tauri)

### Reference Tauri 2 readers

- [Readest](https://github.com/readest/readest)
- [Alexandria](https://github.com/btpf/Alexandria)
- [tauri-rbook](https://github.com/xudong7/tauri-rbook)

### Upstream lnreader (reference only)

- Repository (pinned `639a2538`):
  <https://github.com/lnreader/lnreader/tree/639a2538>
- DeX/freeform render bug (the trigger for this rewrite):
  <https://github.com/lnreader/lnreader/issues/1835>
