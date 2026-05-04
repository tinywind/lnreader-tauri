# PRD: lnreader-tauri

> **Source-of-truth product & engineering plan for the Tauri 2 rewrite of [lnreader/lnreader](https://github.com/lnreader/lnreader).**
>
> Status: Draft v1 (2026-05-05)
> Owners: tinywind
> License: MIT (same as upstream)

---

## 1. Overview

`lnreader-tauri` is a from-scratch reimplementation of the LNReader light-novel reader on top of **Tauri 2**, targeting **Windows, macOS, Linux, iOS, and Android** from a single Rust + TypeScript codebase. The data model, plugin scraper system, and reader rendering rules are migrated from upstream; the React Native + Expo + Fabric runtime is replaced.

The motivating push is a class of cross-cutting bugs in the upstream stack that we no longer get for free — most recently [lnreader/lnreader#1835](https://github.com/lnreader/lnreader/issues/1835), where the activity's decor view in Samsung DeX freeform mode is clamped to the phone display's pixel width regardless of the actual freeform window. Five hypotheses were tested against that bug (theme, deprecated systemUiVisibility, manifest meta-data, configChanges, in-place LayoutParams) and none fixed it; the clamp originates inside the React Native / Fabric / expo-modules layer. A Tauri 2 app does not have an equivalent activity-content-view sizing layer because the OS WebView is attached directly to the window — so the entire bug class disappears at the framework level.

The same rewrite buys us:

- **Real desktop builds** (Win/macOS/Linux). Upstream's RN stack has no usable desktop story.
- **Binary size & memory footprint** roughly an order of magnitude smaller than the RN release APK.
- **Predictable plugin model** — Rust core + thin Kotlin/Swift bridges per platform — instead of three different Android build systems (rock, expo modules, RN community CLI) accumulated in upstream.

## 2. Goals & Non-Goals

### 2.1 Goals (this rewrite must)

1. Open the user's existing **upstream lnreader backup `.zip`** and restore the full library, categories, downloaded chapters, and reading progress.
2. Reproduce the **plugin scraper system** so all upstream plugin sources continue to work without modification (the `src/plugins/sources/...` JS modules port over).
3. Reproduce **Cloudflare-protected source fetching** via a hidden in-app WebView that clears the challenge and shares cookies with the HTTP client.
4. Deliver **Library, Browse (sources), Novel detail, Reader, Updates, History, More/Settings** screens with feature parity (minus §3 cuts).
5. Run on **Windows, macOS, Linux, iOS, Android** from one codebase.
6. Reach the upstream's smoothness bar on the **Reader** screen — paged + scroll modes, font/theme settings, bottom-sheet menu, swipe/keyboard navigation.

### 2.2 Non-Goals (this rewrite will not)

- Maintain any RN, Expo, Hermes, Metro, or Fabric code.
- Ship a "compat shim" that lets upstream native modules continue to load.
- Pursue feature additions not present upstream until parity is reached.

## 3. Out of Scope (intentional cuts)

These features are **dropped** from the rewrite. Issues opened against them will be closed as `wontfix`.

| Cut | Reason | Upstream affordance lost |
|---|---|---|
| TTS reading (`expo-speech`) and **TTS lockscreen media controls** (`NativeTTSMediaControl`) | Largest custom-plugin surface; per-platform TTS engine bridges are work-intensive | Listening to a chapter aloud, lockscreen playback notification |
| **Volume-button page turn** (`NativeVolumeButtonListener`) | Niche; needs Android `dispatchKeyEvent` plugin and an iOS workaround | Hardware volume buttons no longer flip pages |
| **Google Drive backup** (`@react-native-google-signin/google-signin`) | OAuth + Drive REST plumbing not worth carrying for one cloud target | Backup/restore over Google Drive (self-hosted backup remains) |
| **Tracker integrations** (MAL, AniList, MangaUpdates, Kitsu) | Same OAuth-heavy multi-vendor surface as Drive — four vendors, per-novel sync, deep-link callback handling. Used by a minority. Tracker users continue to use upstream lnreader as their tracker companion in v0.1. | Per-novel reading-status sync to external trackers |
| **Default-category settings sub-page** | Upstream's `LibrarySettings` route is registered but unmounted at `639a2538` (only TODO stub for `setDefaultCategory`). Default category remains hardcoded to id=1 (`Default`); users pick category at add-time via `SetCategoriesModal`. | A dedicated UI to change which category new novels land in. |

Everything else from upstream is in scope.

## 4. Architecture

### 4.1 Process / window topology

```
┌────────────────────────────────────────────────────────────────────┐
│ Tauri host (Rust)                                                  │
│  ├── Main WebView (visible)  ← React app: all UI screens           │
│  ├── Hidden WebView (invisible, off-screen)                        │
│  │     ← created on demand for Cloudflare-protected fetches        │
│  │     ← cookies + UA shared with the HTTP client via Rust         │
│  ├── Background async task pool                                    │
│  │     ← chapter download queue, plugin scrape jobs, backups       │
│  └── Plugin layer (Rust + per-platform Kotlin/Swift)               │
│        ├── tauri-plugin-fs            (file IO)                    │
│        ├── tauri-plugin-sql           (SQLite via sqlx)            │
│        ├── tauri-plugin-http          (HTTP w/ cookie jar)         │
│        ├── tauri-plugin-upload        (download w/ progress)       │
│        ├── tauri-plugin-deep-link     (lnreader:// scheme)         │
│        ├── tauri-plugin-notification  (download alerts)            │
│        ├── tauri-plugin-clipboard-manager                          │
│        ├── tauri-plugin-haptics                                    │
│        ├── tauri-plugin-dialog        (file picker)                │
│        ├── tauri-plugin-shell         (open external URL)          │
│        ├── tauri-plugin-android-fs    (SAF document tree)          │
│        └── (custom) lnreader-foreground-service (Android)          │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key data flows

- **Library load**: React → `invoke('library:list')` → Rust queries SQLite via `tauri-plugin-sql` → response.
- **Plugin browse**: React → `invoke('plugin:fetch', {id, url})` → Rust runs the plugin scraper against `tauri-plugin-http` (cookie-aware) → if response indicates Cloudflare, escalate to hidden WebView path.
- **Hidden WebView fetch (Cloudflare)**: Rust opens a hidden `WebviewWindow`, navigates, waits for known clearance signals (cookie set or DOM marker), then calls `Webview::cookies_for_url()` and pumps the cookies into the HTTP cookie store, then closes the hidden window.
- **Reader render**: HTML chapter content is rendered as a normal route in the main webview; the upstream `assets/js/core.js` reader logic is ported into a React component (no nested WebView needed — the entire app *is* a WebView).
- **Chapter download**: Job placed onto an async queue. On Android, when the host app goes background, the foreground-service plugin keeps the queue alive with a notification; otherwise tasks pause when the app is suspended.

### 4.3 Layering

- **`/src` (TypeScript + React)** — UI, routing, state, plugin scraper modules (ported from upstream `src/plugins/`).
- **`/src-tauri/src` (Rust)** — IPC commands, HTTP client, scraper runtime, hidden-webview controller, foreground-service controller, EPUB parser bindings.
- **`/src-tauri/gen/{android,apple}`** — generated mobile project shells.

## 5. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Native shell | **Tauri 2.x** | Single Rust core, real desktop + iOS + Android. Replaces RN + Expo. |
| Frontend framework | **React 19** | Maximum reuse of upstream's React component logic; engineers already fluent. |
| Routing | **TanStack Router** | Type-safe routes; better than `react-router` for tab + stack patterns we copy from RN navigators. |
| State | **Zustand + TanStack Query** | Zustand replaces MMKV-backed persisted hooks; Query for plugin/network IO with cache invalidation. |
| UI library | **Mantine** (preferred) or **shadcn/ui** | Mantine ships with Material-feeling components closest to RN Paper; shadcn if we want Tailwind-only design freedom. Decision made in Sprint 0. |
| Animations | **Framer Motion** + CSS | Replaces `react-native-reanimated` + worklets. Reader transitions need 60 fps so we keep them on the compositor (`transform`, `opacity`). |
| ORM | **drizzle-orm + drizzle-orm/sqlite-proxy** | Same drizzle schema upstream already uses (`@op-engineering/op-sqlite`). Proxy adapter calls `tauri-plugin-sql` for execution → schema, queries, and migrations port over without rewrites. |
| Database | **SQLite** via `tauri-plugin-sql` (sqlx underneath) | Same engine as upstream. |
| HTTP | **`tauri-plugin-http`** + Rust `reqwest` | Cookie jar built in. Two-way cookie sync with WebView covered in §6. |
| Worker thread for parsing | **Web Worker** in the React frontend | Cheerio HTML parsing offloaded; identical pattern to a hand-rolled RN solution but native-supported here. |
| EPUB parsing | **`rbook`** (Rust) | See §6.4. |
| ZIP / unzip | **`zip` crate** (Rust) | For backup/restore and chapter epub bundling. |
| Build tooling | **Vite** (frontend), **Cargo** (backend) | Standard. |

## 6. Community plugin / crate inventory

> ### **The single most important section of this PRD.**
> The earlier internal estimate flagged five things as "needs custom plugin" (Cloudflare hidden WebView, Android foreground service, Storage Access Framework, EPUB parser, multi-WebView cookie management). After surveying the Tauri 2 ecosystem and Rust crate registry on 2026-05-05, **most of those already exist**. Only two slivers of custom code remain.

### 6.1 Official Tauri 2 plugins we reuse as-is

These are dropped in via `cargo add` + `pnpm add` and need only configuration:

| Replaces upstream | Tauri plugin | Notes |
|---|---|---|
| `expo-file-system`, `NativeFile` | [`@tauri-apps/plugin-fs`](https://v2.tauri.app/plugin/file-system/) | App data, cache, temp dirs cross-platform. |
| `op-sqlite` + drizzle | [`@tauri-apps/plugin-sql`](https://v2.tauri.app/plugin/sql/) | SQLite via `sqlx`. drizzle's `sqlite-proxy` adapter executes through the plugin. |
| `expo-clipboard` | [`@tauri-apps/plugin-clipboard-manager`](https://v2.tauri.app/plugin/clipboard/) | — |
| `expo-document-picker`, parts of `react-native-saf-x` | [`@tauri-apps/plugin-dialog`](https://v2.tauri.app/plugin/dialog/) | File-picker flow. |
| `expo-haptics` | [`@tauri-apps/plugin-haptics`](https://v2.tauri.app/plugin/haptics/) | Mobile only; no-op on desktop. |
| `expo-keep-awake` | (built-in) `WindowExt::set_resizable`, plus power-management crates if needed | Reader keep-awake handled via `wake_lock` Rust crate when needed. |
| `expo-linking` | [`@tauri-apps/plugin-deep-link`](https://v2.tauri.app/plugin/deep-link/) | `lnreader://` scheme registers identically. |
| `expo-localization` | (no plugin) — `Intl.*` from JS + `tauri-plugin-os` for fallback locale | — |
| `expo-navigation-bar` (system bar styling) | `tauri-plugin-os` + window APIs | — |
| `expo-notifications` (local) | [`@tauri-apps/plugin-notification`](https://v2.tauri.app/plugin/notification/) | Cross-platform local notifications + scheduling. |
| `expo-web-browser` | [`@tauri-apps/plugin-shell`](https://v2.tauri.app/plugin/shell/) | `open(url)`. |
| `react-native-background-actions` (HTTP transfer side) | [`@tauri-apps/plugin-upload`](https://v2.tauri.app/plugin/upload/) | Up + download with `(downloaded, total)` progress. |
| Cookie sync between webview and HTTP | Tauri 2 core: `Webview::cookies()` + `Webview::cookies_for_url()` + `tauri-plugin-http` cookie jar | Two cookie stores exist (webview vs `reqwest`); we sync them in our scraper runtime. See [feat: add Webview::cookies (#12665)](https://github.com/tauri-apps/tauri/commit/cedb24d494b84111daa3206c05196c8b89f1e994) and [Cookie Management — DeepWiki](https://deepwiki.com/tauri-apps/tauri-plugin-http/6.1-cookie-management). |
| Hand-rolled GitHub Releases poller (`useGithubUpdateChecker.ts`) | [`@tauri-apps/plugin-updater`](https://v2.tauri.app/plugin/updater/) (desktop only) | Replaces the upstream poller on Windows / macOS / Linux with signed update manifests + OS-correct install flow. Mobile: iOS uses App Store, Android uses Play Store; sideload Android keeps a "Check for updates" link in More that opens the latest GitHub Release page via `tauri-plugin-shell`. Code-signing setup tracked in [`docs/release/signing.md`](../docs/release/signing.md) and is a Sprint 6 dependency. |

### 6.2 Community Tauri plugins we reuse

These are not in `tauri-apps/plugins-workspace` but are well-maintained crates / npm packages:

| Replaces upstream | Community plugin | Notes |
|---|---|---|
| `react-native-saf-x` (Android Storage Access Framework) | [`tauri-plugin-android-fs`](https://crates.io/crates/tauri-plugin-android-fs) ([github](https://github.com/aiueo13/tauri-plugin-android-fs)) | Solves the exact gap that upstream Tauri's `plugin-fs` cannot: persistent SAF document-tree URIs through a custom `taurifs:` scheme. Folder picker, list children, read/write through the SAF URI. **This is what we previously called "needs a custom plugin"** — it already exists. |
| Background notifications, push (future) | [`tauri-plugin-mobile-push`](https://github.com/yanqianglu/tauri-plugin-mobile-push) | iOS APNs + Android FCM. Optional; only if upstream's notification UX was using push, which we should audit. |
| Lifecycle (foreground/background, exit) on Android | [`tauri-plugin-app-control`](https://crates.io/crates/tauri-plugin-app-control) | Used to gate the foreground-service start/stop. |
| Reusable disk cache for plugin scrape responses | [`tauri-plugin-cache`](https://crates.io/crates/tauri-plugin-cache) | Optional optimization; replaces ad-hoc MMKV cache patterns from upstream. |

### 6.3 Reference plugins for the **only two** still-custom modules

We still need to write a small amount of custom Rust + Kotlin, but neither is from-scratch — both have working community templates we mirror:

| Custom module | Why custom is unavoidable | Reference templates |
|---|---|---|
| **Cloudflare hidden WebView controller** | We need a precise lifecycle: open invisible webview → navigate → wait for clearance signal → read cookies → close. This is glue-code over existing Tauri primitives, not a new plugin per se. | Tauri 2 core APIs: `WebviewWindowBuilder::new(...).visible(false).inner_size(1.0, 1.0).build()` + `Webview::cookies_for_url(url)`. JS-side recipes from [Discussion #11655](https://github.com/tauri-apps/tauri/discussions/11655). The wrapper lives in `/src-tauri/src/cf_webview.rs`. |
| **Android foreground service for downloads** | Tauri does not ship a generic foreground-service plugin. Required so the chapter-download queue keeps running when the app is backgrounded on Android (matches upstream `react-native-background-actions`). | Pattern used by [`tauri-plugin-holochain-service`](https://crates.io/crates/tauri-plugin-holochain-service) (full Android foreground service in a Tauri plugin) and [`tauri-plugin-native-audio`](https://crates.io/crates/tauri-plugin-native-audio) (`NativeAudioService` on `play()`). Both expose a service-start/stop command surface; we copy that scaffolding and replace the work loop with our download queue tick. |

### 6.4 Rust crates (no plugin needed — direct usage from `/src-tauri`)

| Replaces upstream | Crate | Notes |
|---|---|---|
| `NativeEpub` (iOS-only Swift EPUB parser) | [`rbook`](https://crates.io/crates/rbook) | Format-agnostic ebook lib; parses EPUB 2 and 3, gives us metadata, ToC, spine, cover, and resource paths. **Solves what we previously thought needed a custom plugin.** |
| `react-native-zip-archive`, `NativeZipArchive` | [`zip`](https://crates.io/crates/zip) (`zip-rs`) | Streaming zip read/write. Used for backup/restore and EPUB import. |
| Cheerio HTML parsing in scrapers | Cheerio in JS (run inside a Web Worker) | Plugin scrapers stay JS to keep the porting trivial. Rust HTML parsers (`scraper`, `kuchikiki`) are an option later if perf matters. |
| HTTP client with cookie jar in Rust | `reqwest` (already used by `tauri-plugin-http`) | — |
| Scheduling / debouncing | `tokio` + `futures` | — |

### 6.5 Reference Tauri 2 ebook readers we read before writing code

| Project | What we steal |
|---|---|
| [Readest](https://github.com/readest/readest) (Foliate-inspired, Next.js 16 + Tauri 2, all platforms) | The cleanest example of a cross-platform Tauri 2 reader. Look at: book registry / library DB schema, EPUB rendering pipeline, settings sync. |
| [Alexandria](https://github.com/btpf/Alexandria) (Tauri + Epub.js + TS) | Minimalist baseline; useful for keyboard nav and bottom-bar UX. |
| [tauri-rbook](https://github.com/xudong7/tauri-rbook) (Tauri + Vue 3 + Rust) | Direct example of `rbook` integrated into a Tauri app. |

## 7. What truly remains to be written from scratch

After the survey above, the new code that this repo must produce — *that is not just a glue between existing crates/plugins* — is:

1. **Plugin scraper runtime** (`/src/plugins/runtime`) — JS-side, ports the upstream pattern but adapted to the new Tauri webview/HTTP model.
2. **Cloudflare hidden-webview controller** (`/src-tauri/src/cf_webview.rs` + `/src/lib/cf-bypass.ts`) — ~300–500 lines.
3. **Android foreground-service plugin** (`/src-tauri/plugins/lnreader-fg-service`) — Kotlin Service + Rust commands ~200–400 lines, mirroring `tauri-plugin-holochain-service`.
4. **All UI** — Library, Browse, Novel, Reader, Updates, History, Settings. Pure web stack; the bulk of the work measured in lines, but no novel research.
5. **Backup/restore wire format** — read/write the upstream `.zip` so users can migrate without losing data.
6. **Reader content runtime** — port `assets/js/core.js` (paged/scroll mode, click-zone classification, font sizing, theme) into a React component.

That is the entire bespoke-engineering surface. Everything else is configuration of plugins listed in §6.

## 8. Data migration from upstream lnreader

Upstream's data format we must read:

- **SQLite schema** — defined in upstream `src/database/schemas/*` (post-Drizzle migration in `b8c177bc`). drizzle migrations are runnable as-is against `tauri-plugin-sql`.
- **Backup `.zip`** — defined in upstream `src/services/backup/utils.ts`. Members include `version.json`, the SQLite db file, downloaded chapter HTML / EPUB blobs under `Files/`. We mirror the same layout so backups are bidirectionally compatible.

Migration UX: on first launch, offer "Restore from upstream backup" (file picker → unzip → load db → copy chapter files). User keeps using upstream until they've validated parity.

## 9. Phased implementation plan

Each sprint is sized to land in **one focused week of full-time work**; cut/extend if scope drifts.

### Sprint 0 — toolchain, scaffold, DB bridge

**Deliverables**
- Tauri 2 project scaffold (`pnpm create tauri-app`), React 19 + TanStack Router + Mantine.
- Vite + Cargo build green on Win/macOS/Linux/Android/iOS targets (CI matrix).
- `tauri-plugin-sql` wired; drizzle proxy adapter resolves a real SQLite file at the platform-correct app-data path.
- Upstream's drizzle schema imported verbatim into `/src/database`. First migration runs.
- README + this PRD + LICENSE.

**Acceptance**
- `cargo check && pnpm tsc --noEmit && pnpm tauri build` green for desktop, `tauri android dev` and `tauri ios dev` launch a "Hello DB row" screen on real devices.

### Sprint 1 — Library tab end-to-end

**Deliverables**
- Library route renders a real grid bound to the local DB (same drizzle queries as upstream).
- Categories drawer, search bar, long-press selection menu (UI shell only).
- Backup-zip restore flow (file picker → unzip → DB import → chapter files into app-data) — gated behind a "Migrate from upstream" button on an empty install.

**Acceptance**
- A user with an upstream `.zip` backup ends up on the Library screen with the same novels, in the same categories, same reading progress, on all five platforms.

### Sprint 2 — plugin scraping + Cloudflare hidden-webview PoC (highest-risk sprint)

**Deliverables**
- Port one upstream JS plugin scraper (e.g., BoxNovel) into `/src/plugins/sources/` and register it.
- HTTP client integrated with `tauri-plugin-http` cookie jar.
- **Cloudflare hidden-webview controller** in Rust: open invisible `WebviewWindow`, navigate, wait for `cf_clearance` cookie, read cookies, push them into the HTTP cookie jar, close.
- "Browse" tab can list and search at least one CF-protected source successfully.
- **Global search redesign**: replace upstream's busy-poll concurrency limiter and cooperative-only cancellation with `AbortController`-based real cancellation + `p-limit` semaphore (default `BrowseSettings.globalSearchConcurrency = 3`). See [`docs/screens/browse.md` §10](../docs/screens/browse.md).
- **Deep-link verification**: `lnreader://repo/add?url=...` deep link opens the Add Repository modal with the URL prefilled — verified end-to-end on real Android + iOS hardware (upstream behavior at `639a2538` is documented as `UNKNOWN` whether it auto-opens; we lock the contract here).

**Acceptance**
- Calling a CF-protected scraper from the Browse tab returns parsed novel listings without the user seeing the Turnstile challenge.
- Cookie jar in `reqwest` contains the cookies set inside the hidden webview after the bypass.
- **iOS WKWebView ↔ reqwest cookie sync verified on real iOS hardware** — `Webview::cookies_for_url(url)` after a hidden-webview clearance pushes the `cf_clearance` cookie into `tauri-plugin-http`'s `reqwest_cookie_store` and the next plain-HTTP request succeeds without a second WebView spawn. If this fails on iOS, fall back to the `reqwest-impersonate` mitigation noted in §11.
- Global search abort: typing a new query while a global search is in flight cancels every outstanding network request within 100 ms and clears the loading indicator.

**Gate**: if this sprint cannot complete in one week, escalate before continuing — the cf-bypass is the load-bearing assumption of the whole rewrite.

### Sprint 3 — Reader (paged + scroll, single chapter)

**Deliverables**
- Reader route opens a chapter and renders downloaded HTML.
- Paged mode (`column-width` CSS) and scroll mode toggle.
- Click-zone classification (top / middle / bottom thirds) and keyboard nav (`PageDown`, arrows) ported from upstream `assets/js/core.js`.
- Footer bottom-sheet with prev/next/menu/settings/source.
- Font, line-height, theme settings persisted.

**Acceptance**
- Reading a chapter on each platform feels at least as smooth as upstream on the same device, including freeform/multi-window on Android.

### Sprint 4 — background download (Android foreground service)

**Deliverables**
- Chapter download queue (`/src-tauri/src/download_queue.rs`) with progress events.
- Android **foreground-service plugin** mirroring `tauri-plugin-holochain-service`: starts on first queued job, stops on idle, posts a persistent "downloading N/M chapters" notification.
- iOS: in-app queue with `tauri-plugin-upload`, paused when suspended (same constraint upstream has).
- Desktop: in-app queue, no extra service.

**Acceptance**
- Queueing 50 chapters and immediately backgrounding the app on Android continues downloading to completion with the foreground notification visible.

### Sprint 5 — backup & restore (local + self-hosted)

**Deliverables**
- "Create backup" produces an upstream-compatible `.zip` (same `version.json`, same internal layout). Verifiable by importing into upstream lnreader.
- Local file flow uses `tauri-plugin-dialog` (desktop, iOS) and `tauri-plugin-android-fs` (Android SAF document tree) for write target.
- Self-hosted backup target: HTTP PUT to the user's configured URL (matches upstream `selfhost` mode).
- Restore flow handles the deep-merge non-destructive path from upstream `401aa7c8`.

**Acceptance**
- Round-trip lnreader-tauri → upstream → lnreader-tauri is loss-free for library, categories, downloaded chapters, and progress.

### Sprint 6 — remaining UI surface + polish

**Deliverables**
- Browse tab full source list, plugin update / install / delete.
- Updates tab, History tab, More/Settings (themes, reader settings, plugins, repositories, advanced).
- Crash reporting (`sentry-tauri`) opt-in.
- App icon, splash, deep-link tests, packaging.
- **Code signing** — Apple Developer ID + Windows code-signing cert + Linux GPG key (or sign-in-CI via Azure Trusted Signing). See [`docs/release/signing.md`](../docs/release/signing.md). Without signing, the desktop updater story below is degraded (SmartScreen / Gatekeeper warnings).
- **Auto-update flow** — `tauri-plugin-updater` configured against the project's GitHub Releases. Signed manifests resolved per-platform. Mobile (iOS) defers to App Store; Android Play uses store updater; Android sideload gets a "Check for updates" entry in More that opens the latest release page via `tauri-plugin-shell`.
- **Novel detail backdrop blur** — replace upstream's 70 % alpha overlay with a real `backdrop-filter: blur(20px) brightness(0.55)`. Pure CSS, ~3 lines, see [`docs/screens/novel.md` §10](../docs/screens/novel.md). One-time design upgrade.

**Acceptance**
- Feature parity audit against upstream's screen list passes (modulo §3 cuts).
- A staged v0.1.1 release exercises the full updater flow end-to-end on Windows + macOS + Linux: user sees the prompt, accepts, app restarts on the new build with no manual download.
- Public 0.1.0 release artifacts: `.exe`, `.dmg`, `.AppImage`, `.deb`, `.apk`, TestFlight `.ipa`. All desktop bundles signed.

## 10. Acceptance criteria (cross-cutting)

- [ ] All five target platforms build and launch from a clean checkout on a contributor machine using only `pnpm install && pnpm tauri build`.
- [ ] Upstream `.zip` backups round-trip with no data loss on every platform.
- [ ] Cloudflare-protected source fetches succeed without user-visible challenges.
- [ ] Reader maintains 60 fps on a 6-year-old mid-range Android phone (S23-class is overkill).
- [ ] DeX freeform window renders the entire UI to the freeform bounds (the regression that triggered this rewrite is gone by construction).
- [ ] Total APK size ≤ 25 MB; desktop bundle ≤ 15 MB.
- [ ] License headers (MIT) and an upstream attribution paragraph in `LICENSE` and `README.md`.

## 11. Risks & mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Cloudflare hidden-webview cookie sync turns out brittle on Android (different webview engine than reqwest's TLS fingerprint) | Medium | High | Sprint 2 is gated. Fallback: bundle a Rust TLS-impersonation crate (`reqwest-impersonate`) and skip the WebView path on platforms where the WebView can't authoritatively pass cookies to reqwest. |
| Android foreground-service plugin is harder than the holochain reference | Medium | Medium | Start by literally vendoring `tauri-plugin-holochain-service` and stripping holochain-specific code. |
| `tauri-plugin-android-fs` is third-party and could go unmaintained | Low | Medium | Pin to a specific commit; we own the fork if needed (Rust-only, ~1k LoC). |
| iOS background download is never going to behave like Android's foreground service | High | Low | Document this as a known limitation matching upstream behavior; do not promise parity. |
| Drizzle proxy adapter is slower than `op-sqlite` for big libraries | Medium | Medium | Benchmark in Sprint 0 with a 1000-novel fixture; if too slow, drop down to `sqlx` queries directly and let drizzle handle types only. |
| `rbook` lacks a feature `NativeEpub` had (e.g., a specific cover-extraction quirk) | Low | Low | Wrap our usage in a thin module so we can swap to `epub-parser` or hand-roll if needed. |
| React UI rewrite blows past the time budget | High | Medium | Use Mantine's defaults; do not chase pixel parity with RN Paper in v0.1. |
| iOS WKWebView cookie store does not authoritatively sync into the `reqwest` cookie jar used by `tauri-plugin-http` | Medium | High | Sprint 2 has an explicit hardware-verified acceptance gate (see §9 Sprint 2). If the sync is lossy on iOS, fall back to `reqwest-impersonate` (Rust crate that mimics browser TLS fingerprints) and skip the WebView path on iOS. Document as a known limitation if neither works. |
| Code-signing certificates have ongoing cost and admin overhead (Apple Developer Program $99/yr, Windows code-signing or Azure Trusted Signing ~$10–200/yr) | Medium | Medium | Decision documented in [`docs/release/signing.md`](../docs/release/signing.md). If budget is tight, ship v0.1 unsigned with README warnings about SmartScreen / Gatekeeper, defer signed updater to v0.1.1. |
| Tracker users force a continued upstream-lnreader install for v0.1 (Tracker is in §3 cut) | Low | Low | Document explicitly in README so trackers users self-select. v0.2 reintroduces with `tauri-plugin-deep-link` for OAuth callbacks. |

## 12. Reference apps & their lessons

- **Readest** ([repo](https://github.com/readest/readest)) — the canonical recent example of a Tauri 2 cross-platform reader. Cross-reference its DB schema, its EPUB pipeline, its settings sync. Their license terms and architecture are the closest thing to a north star we have.
- **Alexandria** ([repo](https://github.com/btpf/Alexandria)) — older but cleaner; reader keyboard handling and the bottom-bar UX are worth copying.
- **tauri-rbook** ([repo](https://github.com/xudong7/tauri-rbook)) — direct integration of `rbook` into a Tauri 2 app. Use as a template for the EPUB import flow.
- **Holochain Android service runtime** ([repo](https://github.com/holochain/android-service-runtime)) — the load-bearing reference for Sprint 4's foreground service.

## 13. Open questions

1. **UI library final pick**: Mantine vs. shadcn/ui. Decision deadline: end of Sprint 0. Decider: tinywind.
2. **Should plugin scrapers stay JS, move to Rust, or be a hybrid?** v0.1: stay JS so port is trivial. Revisit if perf or sandboxing dictates.
3. **Should we ship a desktop tray icon and a mobile widget?** Out of scope for v0.1; track as v0.2 backlog.
4. **Sentry vs. self-hosted error reporting**: depends on whether anyone is willing to operate a Glitchtip instance.
5. **Naming / branding**: keep "LNReader" or rebrand? If we keep the name, upstream attribution must be obvious in the About screen.

## 14. References (researched 2026-05-05)

### Tauri 2 core APIs

- [Tauri 2.0 Stable Release announcement](https://v2.tauri.app/blog/tauri-20/)
- [Tauri 2 plugin reference](https://v2.tauri.app/plugin/)
- [`tauri-plugin-sql`](https://v2.tauri.app/plugin/sql/), [`-fs`](https://v2.tauri.app/plugin/file-system/), [`-http`](https://v2.tauri.app/plugin/http-client/), [`-upload`](https://v2.tauri.app/plugin/upload/), [`-deep-link`](https://v2.tauri.app/plugin/deep-link/), [`-notification`](https://v2.tauri.app/plugin/notification/), [`-clipboard-manager`](https://v2.tauri.app/plugin/clipboard/), [`-dialog`](https://v2.tauri.app/plugin/dialog/), [`-haptics`](https://v2.tauri.app/plugin/haptics/), [`-shell`](https://v2.tauri.app/plugin/shell/)
- [`Webview::cookies` PR (commit cedb24d)](https://github.com/tauri-apps/tauri/commit/cedb24d494b84111daa3206c05196c8b89f1e994) and [usage discussion #11655](https://github.com/tauri-apps/tauri/discussions/11655)
- [Cookie management — DeepWiki for `tauri-plugin-http`](https://deepwiki.com/tauri-apps/tauri-plugin-http/6.1-cookie-management)

### Community plugins / crates

- [`tauri-plugin-android-fs`](https://crates.io/crates/tauri-plugin-android-fs) by aiueo13 — SAF support for Tauri 2 ([repo](https://github.com/aiueo13/tauri-plugin-android-fs))
- [`tauri-plugin-holochain-service`](https://crates.io/crates/tauri-plugin-holochain-service) — Android foreground-service template
- [`tauri-plugin-native-audio`](https://crates.io/crates/tauri-plugin-native-audio) — second foreground-service example (`NativeAudioService`)
- [`tauri-plugin-app-control`](https://crates.io/crates/tauri-plugin-app-control) — Android lifecycle (foreground/background, exit)
- [`tauri-plugin-mobile-push`](https://github.com/yanqianglu/tauri-plugin-mobile-push) — APNs + FCM
- [`tauri-plugin-cache`](https://crates.io/crates/tauri-plugin-cache) — disk + memory caching with TTL
- [`tauri-plugin-device-info`](https://crates.io/crates/tauri-plugin-device-info)
- [`awesome-tauri`](https://github.com/tauri-apps/awesome-tauri) — full curated list

### Rust crates

- [`rbook`](https://crates.io/crates/rbook) — EPUB 2/3 parser ([repo](https://github.com/DevinSterling/rbook), [docs](https://docs.rs/rbook/latest/rbook/))
- [`epub`](https://crates.io/crates/epub) — alternate EPUB reader
- [`zip`](https://crates.io/crates/zip) — zip archive read/write
- `reqwest` — HTTP client w/ cookie jar (already inside `tauri-plugin-http`)

### Reference Tauri 2 readers

- [Readest](https://github.com/readest/readest)
- [Alexandria](https://github.com/btpf/Alexandria)
- [tauri-rbook](https://github.com/xudong7/tauri-rbook)

### Upstream lnreader context

- [lnreader/lnreader#1835 — DeX/freeform render bug](https://github.com/lnreader/lnreader/issues/1835) (the trigger for this rewrite)
- [lnreader/lnreader@64921a05 — Expo 55 upgrade](https://github.com/lnreader/lnreader/commit/64921a05) (the suspected regression boundary)
