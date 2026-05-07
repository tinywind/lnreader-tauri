---
name: verify-source-plugin-boundary
description: Verify source plugin runtime, scraper fetch callers, and repository/plugin cache code stay isolated from UI and persistence internals.
---

# Verify Source Plugin Boundary

Use after changing source-plugin runtime, source install/update/cache, global search/source browse/detail/chapter fetch code, or scraper WebView bridge code.

## Checks

- Plugin-owned site fetches must use the sanctioned scraper boundary.
- App/repository fetches may use app HTTP utilities for repository JSON and plugin JavaScript downloads.
- Core plugin runtime modules such as sandbox, shims, types, filters, and manager must not import UI components, route components, reader state, or unrelated app surfaces.
- Orchestration modules that intentionally bridge plugin results into the local library, such as plugin import/update flows, may use DB query helpers but must keep that boundary explicit.
- One source plugin must not call or import another source plugin.
- Shared behavior belongs in neutral plugin runtime helpers.
- Do not enforce strict upstream plugin compatibility; this repo owns its plugin contract.
