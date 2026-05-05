# Handoff from upstream lnreader (reference only)

This `docs/` tree captures upstream lnreader's product knowledge at
commit `639a2538` of `lnreader/lnreader` (HEAD as of 2026-05-04) as
**reference material** for the new app.

> **LNReaderTauri is a separate, independent project. No invariants
> from these documents are binding.** The new app's actual specs are
> authored as code lands in Sprint 0 onward.

## How to use this tree

| Type | Path | Use |
|---|---|---|
| Reader behaviors worth reproducing | [`reader/specification.md`](./reader/specification.md) | Reading-experience inspiration. |
| Plugin scraper contract (upstream's) | [`plugins/contract.md`](./plugins/contract.md) | Pattern reference; we may diverge from the literal contract where simpler. |
| Cloudflare hidden-WebView pipeline | [`plugins/cloudflare-bypass.md`](./plugins/cloudflare-bypass.md) | Technical pattern (load-bearing for Sprint 2). |
| Per-screen layouts | [`screens/`](./screens/) | UX inspiration only. |
| Critical user paths | [`acceptance/critical-paths.md`](./acceptance/critical-paths.md) | User-journey inspiration. |
| Backup wire format (upstream's) | [`backup/format.md`](./backup/format.md) | **Superseded.** We design our own format in Sprint 5. |
| Settings catalog (upstream's MMKV keys) | [`settings/catalog.md`](./settings/catalog.md) | **Superseded.** We design our own keys in Sprint 0+. |
| Domain ER model (upstream's) | [`domain/model.md`](./domain/model.md) | **Superseded.** We design fresh schema in Sprint 0. |
| Code signing / auto-update plan | [`release/signing.md`](./release/signing.md) | **Deferred to v0.2.** v0.1 ships unsigned debug builds. |

## Pinned upstream version

`https://github.com/lnreader/lnreader/blob/639a2538/<path>` is the
URL pattern for any code reference in this tree. That commit is a
**frozen reference snapshot**, not a contract.

## What is NOT in this tree

- Per-screen layouts and interaction specs are partial — only the
  most-touched surfaces (Library, Browse, Novel, Reader chrome,
  Settings, More, History, Updates, Onboarding/utility) have docs.
- Critical-path acceptance is sketched but not exhaustive — fill in
  as the new app implements each surface.
- Visual regression screenshot gallery is empty until the new app
  starts producing screens.

These gaps are intentional. The new app's authored specs replace
them as Sprint 0+ deliverables.

---

## v0.1 status snapshot (as of 2026-05-05)

Sprint completion table (matches `prd.md §8`):

| Sprint | Theme | Status |
|---|---|---|
| 0 | Toolchain, scaffold, fresh DB schema, drizzle bridge | **Done** |
| 1 | Library tab end-to-end | **Done** |
| 2 | Plugin scraping + Cloudflare hidden-WebView | **Done** |
| 3 | Reader (paged + scroll, single chapter) | **Done** (real chapter content wired in part 3b) |
| 4 | Background download | **Desktop done**, Android FG service plugin deferred |
| 5 | Backup & restore (local) | **Done** (manifest + zip pack/unpack + DB gather/apply + dialog UI) |
| 6 | Remaining UI surface + polish | **Mostly done** — Library, Browse, Search, Reader, Novel detail, Updates, History, More all functional |

Counts: **45 commits**, **139 vitest cases / 18 files** passing,
**3 cargo backup tests** passing, `tsc --noEmit` clean.

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
- `zip = "2"` + `tempfile = "3"` (dev-dep) on the Rust side
- `@tauri-apps/{api,plugin-sql,plugin-http,plugin-deep-link,plugin-dialog,plugin-shell}` on the JS side

Android Studio is **not** installed in this session — the prerequisite
for Sprint 4 part 3 work.
