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
| 0 | Toolchain, scaffold, fresh DB schema | **done** ✅ Win desktop build green; Hello DB row smoke verified |
| 1 | Library tab end-to-end | in progress |
| 2 | Plugin scraping + Cloudflare hidden webview | not started |
| 3 | Reader (paged + scroll) | not started |
| 4 | Background download (Android foreground service) | not started |
| 5 | Backup / restore (local + self-hosted) | not started |
| 6 | Remaining UI surface + polish | not started |

## License

MIT. Attribution to upstream lnreader contributors in the About
screen and `LICENSE` file.
