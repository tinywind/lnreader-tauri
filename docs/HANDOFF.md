# LNReaderTauri — v0.1 status

> Originally this file was the index for an upstream-lnreader
> reference tree (`docs/{screens,acceptance,reader,release,backup,
> domain,settings,plugins/cloudflare-bypass}`). Those reference
> trees served their purpose during Sprint 0–6 implementation and
> were removed once the v0.1 surface was complete; the only
> upstream-reference doc still tracked is
> [`plugins/contract.md`](./plugins/contract.md) because source
> code JSDoc still cites its section numbers.

## v0.1 status snapshot (as of 2026-05-05)

Sprint completion table (matches `prd.md §8`):

| Sprint | Theme | Status |
|---|---|---|
| 0 | Toolchain, scaffold, fresh DB schema, drizzle bridge | **Done** |
| 1 | Library tab end-to-end | **Done** |
| 2 | Plugin scraping + in-app site browser overlay | **Done** (architecture diverges from upstream — see below) |
| 3 | Reader (paged + scroll, single chapter) | **Done** (real chapter content wired in part 3b) |
| 4 | Background download | **Desktop done**, Android FG service plugin deferred |
| 5 | Backup & restore (local) | **Done** (manifest + zip pack/unpack + DB gather/apply + dialog UI) |
| 6 | Remaining UI surface + polish | **Mostly done** — Library, Browse, Search, Reader, Novel detail, Updates, History, More all functional |

Counts: **60 commits**, **134 vitest cases / 17 files** passing,
**3 cargo backup tests** passing, `tsc --noEmit` clean.

### Sprint 2 architecture (diverged from upstream)

Upstream's "hidden webview auto-solves CF and returns cookies
synchronously per fetch" pattern (originally captured in the
now-deleted `plugins/cloudflare-bypass.md`) ran into two walls in
WebView2:

- An external page's IPC fetch carries an opaque/null Origin that
  Tauri's invoke handshake rejects with
  *"Origin header is not a valid URL"* — the JS-eval-callback path
  never reaches Rust.
- `--disable-web-security` strips the Origin header on EVERY IPC
  call (it's a process-wide WebView2 flag), so handing the scraper
  CORS bypass that way breaks the main window's IPC too.

What ships instead:

- A single persistent child Webview ("scraper") attached to the
  main window. It owns the WebView2 cookie jar and is the surface
  React's `SiteBrowserOverlay` paints into when the user opens the
  in-app site browser as a full-screen layered modal.
- `webview_fetch` IPC reads cookies from the scraper's jar via
  `Webview::cookies_for_url` and issues the request from Rust with
  `reqwest` + an Edge-shaped User-Agent. CF challenges and logins
  resolve by the user manually navigating the scraper to the site
  via "Open site"; the cookies persist for subsequent fetches.

Plus a small but important adjacency: `installed_plugin` and
`repository_index_cache` tables (drizzle migration v3) so installed
plugins survive restart and Browse renders from cache without
re-fetching repo indexes on every mount.

### Routes shipping in v0.1

- `/` Library (search + categories + selection toolbar)
- `/browse` Browse + plugin install/uninstall
- `/search` Global search across installed plugins (bounded
  concurrency 3 + `AbortController`)
- `/novel?id=N` Novel detail + Add/Remove library + chapter list +
  per-chapter Download button + status badges
- `/reader?chapterId=N` Reader (paged + scroll + click zones +
  keyboard nav + theme/font/line-height settings, loads real
  chapter HTML when downloaded)
- `/updates` Unread chapters across the library, sorted by
  `updated_at` DESC
- `/history` Recently-read chapters, sorted by `read_at` DESC
- `/more` Backup export/import (via `tauri-plugin-dialog`) + About
  section with the latest GitHub release link (via
  `tauri-plugin-shell`)

### What is explicitly deferred to v0.2

| Item | Reason |
|---|---|
| **Android foreground-service plugin** (Sprint 4 part 3) | Requires Android Studio + JDK 17 + Android SDK + NDK + a real device or emulator for manual smoke (`prd.md §8` Sprint 4 acceptance: "50-chapter download on real Android"). The desktop build path of the queue is functional; the queue is in-process and works on Windows/Linux. The Kotlin foreground service stub is the only remaining v0.1 mobile-only gap. |
| **macOS desktop builds** | No Apple Developer Program, no macOS hardware (`CLAUDE.md §5`). |
| **iOS builds** | Same as above. |
| **Code signing on Windows / Linux / Android** | v0.1 ships unsigned debug builds (`CLAUDE.md §5`). |
| **In-app auto-update** | `tauri-plugin-updater` requires signing. The /more "Open latest release" link via `tauri-plugin-shell` covers users while signing is deferred. |
| **TTS / volume-button page turn / Google Drive backup / tracker integrations / default-category settings sub-page** | Per `CLAUDE.md §5` cuts. |

### Manual-smoke checklist remaining before tagging 0.1.0

Per `CLAUDE.md §9`:

- [ ] **Desktop smoke** (Windows + Linux): launch, seed novel, install
  one plugin, read a downloaded chapter, export/import a backup.
- [ ] **Android smoke** (real device/emulator): once the FG-service
  plugin lands, queue 50 chapters, background the app, verify the
  notification stays visible until the queue drains.
- [ ] **CF bypass live test**: hit a real Cloudflare-protected source
  end-to-end through Browse → Novel → Reader.
- [ ] **Deep link**: `lnreader://repo/add?url=...` opens Browse with
  the prefilled repo URL on both desktop and Android.
- [ ] **DeX / freeform window resize on Android**: window survives
  the resize without crashing — the bug class that motivated the
  rewrite (`CLAUDE.md §1`) must be gone by construction.

### Tooling installed in this session

- pnpm (10.x), Node 22 LTS
- Rust 1.95.0 stable (cargo at `~/.cargo/bin`)
- VS 2022 Build Tools (MSVC 14.44 + Win11 SDK)
- `tauri-plugin-{sql,http,deep-link,dialog,shell}` 2.x
- `tauri = { features = ["unstable"] }` for the child-Webview
  `Window::add_child` API
- `reqwest = "0.12"` + `zip = "2"` + `tempfile = "3"` (dev-dep) on
  the Rust side
- `@tauri-apps/{api,plugin-sql,plugin-http,plugin-deep-link,plugin-dialog,plugin-shell}`
  + `@mantine/notifications` on the JS side

Android Studio is **not** installed in this session — the prerequisite
for Sprint 4 part 3 work.
