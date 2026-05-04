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
