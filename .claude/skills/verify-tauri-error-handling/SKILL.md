---
name: verify-tauri-error-handling
description: Verify Norea IPC, persistence, scraper, backup, download, and plugin failures preserve actionable error detail.
---

# Verify Tauri Error Handling

Use after changes to Rust IPC commands, download queue, backup/restore, scraper/WebView fetch, EPUB/zip parsing, TypeScript DB writes, plugin install/update/delete, chapter downloads, reader persistence, or custom Android service code.

## Rules

- Do not collapse mutation, persistence, IPC, scraper, backup, or download failures into `false`, `null`, or defaults when callers need the cause.
- Boolean/nullable results are allowed for probes, optional parsing, cache metadata, feature checks, and user-cancelled flows.
- Translate errors only at clear boundaries: Rust command responses, UI-facing messages, plugin/domain errors, backup format validation, and Android service lifecycle boundaries.
- Error translation must add operation context, domain meaning, stable UI behavior, or recovery guidance.
- Error handling must not bypass the scraper WebView plugin-fetch boundary.
- Typed result objects are allowed when they preserve enough failure detail.
