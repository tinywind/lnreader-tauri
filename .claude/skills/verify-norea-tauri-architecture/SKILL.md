---
name: verify-norea-tauri-architecture
description: Verify Norea architecture boundaries across React UI, Tauri Rust runtime, Drizzle persistence, plugin fetches, and Android scope.
---

# Verify Norea Tauri Architecture

Use after changing `src/**`, `src-tauri/src/**`, plugin scraping, persistence, backup, download queue, reader runtime, or Android foreground-service work.

## Rules

- Keep UI in `src/**` and native/IPC/runtime work in `src-tauri/src/**`.
- Plugin-owned site fetches must use the scraper WebView cookie/context path.
- App/repository fetches and plugin-owned site fetches must remain separate.
- Persistence should stay on SQLite + `tauri-plugin-sql` + Drizzle/proxy unless a change explicitly owns a Rust-side storage boundary.
- Avoid hidden per-item DB/network loops in update, search, download, backup, and plugin flows; use batching, maps, bounded concurrency, or cancellation where appropriate.
- Android foreground-service rules apply only to deferred Android service work; desktop queue behavior remains in-app.
