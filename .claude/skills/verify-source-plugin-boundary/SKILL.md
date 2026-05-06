---
name: verify-source-plugin-boundary
description: Verify source plugin runtime, scraper fetch callers, and repository/plugin cache code stay isolated from UI and persistence internals.
---

# Verify Source Plugin Boundary

Use after changing source-plugin runtime, source install/update/cache, global search/source browse/detail/chapter fetch code, or scraper WebView bridge code.

## Checks

- Plugin-owned site fetches must use the sanctioned scraper boundary.
- App/repository fetches may use app HTTP utilities for repository JSON and plugin JavaScript downloads.
- Source-plugin code must not import UI components, route components, Drizzle schema/query code, backup/download services, or reader state directly.
- One source plugin must not call or import another source plugin.
- Shared behavior belongs in neutral plugin runtime helpers.
- Do not enforce strict upstream plugin compatibility; this repo owns its plugin contract.
