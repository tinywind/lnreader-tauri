# LNReaderTauri

A Tauri 2 light-novel reader for **Windows, Linux, and Android**.

Inspired by [`lnreader/lnreader`](https://github.com/lnreader/lnreader)
but built fresh — **a separate, independent project** with no upstream
compatibility constraints.

- **Why Tauri 2?** Real desktop builds, smaller binaries, and a sane
  plugin model. See [`prd.md §1`](./prd.md#1-overview).
- **Cuts vs. upstream**: TTS, volume-button page turn, Drive backup,
  trackers, iOS, macOS, code signing. See
  [`prd.md §3`](./prd.md#3-out-of-scope-v01).
- **Source-of-truth doc**: [`prd.md`](./prd.md). Read before opening
  an issue.
- **Upstream behavioral reference**: [`docs/HANDOFF.md`](./docs/HANDOFF.md).

## Status

| Sprint | Theme | Status |
|---|---|---|
| 0 | Toolchain, scaffold, fresh DB schema | **done** |
| 1 | Library tab end-to-end | **done** |
| 2 | Plugin scraping + in-app site browser overlay | **done** (architecture diverges from upstream — see HANDOFF) |
| 3 | Reader (paged + scroll) | **done** |
| 4 | Background download | **desktop done** (Android FG-service plugin deferred to v0.2) |
| 5 | Backup / restore (local) | **done** |
| 6 | Remaining UI surface + polish | **done** |

Counts: 60 commits, 134 vitest cases / 17 files, 3 cargo backup
tests, `tsc --noEmit` clean. Desktop release build (`pnpm tauri
build --no-bundle`) green. See
[`docs/HANDOFF.md` v0.1 status snapshot](./docs/HANDOFF.md#v01-status-snapshot-as-of-2026-05-05)
for what remains before tagging 0.1.0 (manual smoke checklist +
Android device validation).

## Routes shipping in v0.1

- `/` Library — search + categories + selection
- `/browse` Browse + plugin install/uninstall
- `/search` Global search (bounded concurrency 3 + AbortController)
- `/novel?id=N` Novel detail + chapter list + per-chapter Download
- `/reader?chapterId=N` Reader (paged + scroll + click zones)
- `/updates` Unread chapters across the library
- `/history` Recently-read chapters
- `/more` Backup export/import + GitHub release link

## Develop

```bash
pnpm install
pnpm tauri dev          # desktop dev (Windows/Linux)
pnpm test --run         # vitest
pnpm tsc --noEmit       # type check
```

Rust-side checks:

```bash
cd src-tauri
cargo check
cargo test --lib
```

## License

MIT. Attribution to upstream lnreader contributors in the About
screen and `LICENSE` file.
