---
name: verify-plugin-fetch-contract
description: Verify plugin-owned source fetches use the sanctioned scraper/WebView cookie path while app/repository fetches stay separate.
---

# Verify Plugin Fetch Contract

Use after changing plugin browsing, global search, library update checks, novel detail scraping, chapter body fetches, repository install/update, scraper WebView, or `webview_fetch`.

## Rules

- Plugin browsing/search/library-update/detail/chapter fetches must not use arbitrary `fetch`, direct `@tauri-apps/plugin-http`, copied-cookie host HTTP, or ad hoc host HTTP.
- Repository JSON fetches and plugin JavaScript source downloads may use ordinary app-side HTTP utilities.
- Plugin-owned site fetches must use the sanctioned scraper/cookie bridge. Inspect the current scraper implementation before judging. Do not allow any new host HTTP path outside that bridge, and do not ban or allow `reqwest` by name without checking the current bridge.
- Scraper site context navigation and plugin fetches must not race each other.
- Do not reintroduce hidden automatic challenge-solving claims. Current behavior relies on the scraper WebView path and the site browser overlay when protected sources need manual session setup.
- Ignore GitHub release links, backup import/export, and non-plugin metadata requests.
