# lnreader-tauri

A Tauri 2 rewrite of [lnreader/lnreader](https://github.com/lnreader/lnreader), targeting **Windows, macOS, Linux, iOS, and Android** from a single codebase.

This repo is a planning workspace; the source code lands in subsequent commits per the phased plan.

- **Why a rewrite?** See [`prd.md`](./prd.md) — short answer: the React Native + Expo + Fabric stack has accumulated cross-cutting bugs (DeX/freeform window sizing in particular) that no longer come for free, while the surface area we actually use can be reproduced on a Tauri 2 stack with smaller binaries, real desktop builds, and a sane plugin model.
- **Scope cuts vs. upstream:** TTS, volume-button page turning, and Google Drive backup are intentionally dropped. See `prd.md §3 Out of Scope`.
- **Source-of-truth doc:** [`prd.md`](./prd.md). Read this before opening a PR or filing an issue.
- **Handoff from upstream:** [`docs/HANDOFF.md`](./docs/HANDOFF.md) — the index of product knowledge extracted from the upstream RN project (reader spec, plugin contract, Cloudflare bypass, backup wire format, settings catalog, domain model). The schemas, theme palettes, i18n base, drizzle migrations, and app icons are copied verbatim into [`src/`](./src/), [`strings/`](./strings/), [`drizzle/`](./drizzle/), and [`assets/`](./assets/).

## Status

| Sprint | Theme | Status |
|---|---|---|
| 0 | Toolchain, project scaffold, DB bridge | not started |
| 1 | Library tab (one screen end-to-end) | not started |
| 2 | Plugin scraping + Cloudflare hidden webview PoC | not started |
| 3 | Reader (HTML/EPUB) | not started |
| 4 | Background download (Android foreground service) | not started |
| 5 | Backup / restore (local + self-hosted) | not started |
| 6 | Remaining UI surface + polish | not started |

## License

MIT (matching upstream). See `prd.md §10` for attribution requirements.
