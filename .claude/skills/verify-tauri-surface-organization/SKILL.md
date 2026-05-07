---
name: verify-tauri-surface-organization
description: Verify Norea files stay organized by product or runtime surface without premature generic helpers.
---

# Verify Tauri Surface Organization

Use after moving or creating `src/**/*.{ts,tsx}`, `src-tauri/src/**/*.rs`, or custom Android foreground-service files.

## Rules

- Ignore `src-tauri/gen/android/**` unless the change intentionally crosses generated Android boundaries.
- Keep files grouped by dominant surface: Library, Browse/plugins, Search, Novel detail, Reader, Updates, History, Settings, Backup, Download queue, Plugin scraper, scraper WebView fetch, DB/schema.
- UI route/container files may coordinate one surface but should not absorb scraper runtime, backup packing, DB bridge, or Rust IPC implementation.
- Rust IPC modules should expose one runtime concern; do not mix backup, scraper fetch, download queue, EPUB, and DB mutation logic in one catch-all file.
- Preserve plugin fetch path separation.
- Extract shared helpers only after repetition exists inside one surface.
- Keep visible UI strings in locale files.
