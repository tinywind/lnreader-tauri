# Handoff from upstream lnreader

This directory consolidates the product knowledge baked into the upstream
React-Native LNReader project — extracted at commit `639a2538` of
`lnreader/lnreader` on 2026-05-05 — so the Tauri rewrite does not lose
the years of accumulated decisions sitting in code.

The split between this `docs/` tree and what was copied verbatim into
`src/`, `strings/`, `drizzle/`, `assets/` is intentional:

- **Code-as-spec** stays as code. Schemas, theme palettes, i18n keys,
  drizzle migrations, app icons, splash assets — copied bit-for-bit so
  the new project starts from the same authoritative artifacts.
- **Decisions and behaviors that are only in code or in maintainers'
  heads** are written down here as Markdown, so a contributor can read
  this directory and implement against the spec without spelunking the
  upstream RN tree.

## Map

| What | Where | Type |
|---|---|---|
| Database schema (drizzle definitions, types) | [`src/database/schema/`](../src/database/schema/) | code (verbatim copy) |
| Drizzle migration history | [`drizzle/`](../drizzle/) | code (verbatim copy) |
| Theme palettes (9 themes) | [`src/theme/`](../src/theme/) | code (verbatim copy) |
| Base i18n catalog (English) | [`strings/languages/en/strings.json`](../strings/languages/en/strings.json) | code (verbatim copy) |
| App icons (Android mipmap set) | [`assets/android-icons/`](../assets/android-icons/) | binary (verbatim copy) |
| Splash screen (Lottie + drawable) | [`assets/splash/`](../assets/splash/) | binary (verbatim copy) |
| Reader specification (paged/scroll, gestures, settings) | [`docs/reader/specification.md`](./reader/specification.md) | spec |
| Plugin scraper contract | [`docs/plugins/contract.md`](./plugins/contract.md) | spec |
| Cloudflare hidden-WebView pipeline | [`docs/plugins/cloudflare-bypass.md`](./plugins/cloudflare-bypass.md) | spec |
| Backup zip wire format & restore semantics | [`docs/backup/format.md`](./backup/format.md) | spec |
| Settings catalog (every persisted key) | [`docs/settings/catalog.md`](./settings/catalog.md) | spec |
| Domain model overview + ERD | [`docs/domain/`](./domain/) | spec |

## What is NOT in this directory (and why)

- **Per-screen layouts and interaction specs** (Library, Browse, Novel,
  Reader chrome, Settings sub-pages, etc.) — these need a human's UX
  judgment, not a code dump. The author of this handoff explicitly
  agreed (option C in the planning conversation) to defer these so the
  product owner writes them after evaluating Mantine vs shadcn/ui in
  Sprint 0. Suggested location once written: `docs/screens/`.
- **Critical-path acceptance scenarios** — same reason. Suggested
  location: `docs/acceptance/critical-paths.md`.
- **Visual regression screenshot gallery** — capture once the new app
  starts producing screens. Suggested location: `docs/screenshots/`.

## How to use this handoff

When you sit down to implement Sprint N from `prd.md`:

1. Read `prd.md` §9 for the sprint goal.
2. Open the relevant doc here for the contract you must reproduce.
3. If a doc references upstream code, that code is at
   `https://github.com/lnreader/lnreader/blob/639a2538/<path>`.
4. If something is unclear, **prefer matching upstream behavior** over
   inventing — the user's existing data and expectations are the
   ground truth. Open an issue here labelled `behavior-question` if a
   spec gap blocks you.

## Pinned upstream version

These docs describe upstream lnreader at commit `639a2538` (HEAD as of
2026-05-04). Behaviors that change after that commit must be re-checked
before adopting them in this rewrite.
