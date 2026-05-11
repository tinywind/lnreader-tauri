---
name: verify-norea-tauri-architecture
description: Verify Norea architecture boundaries across React UI, Tauri Rust runtime, SQLite/Drizzle persistence, plugin fetches, and Android scope.
---

# Verify Norea Tauri Architecture

Use after changing `src/**`, `src-tauri/src/**`, plugin scraping, persistence, backup, download queue, reader runtime, or Android foreground-service work.

## Rules

- Keep UI in `src/**` and native/IPC/runtime work in `src-tauri/src/**`.
- Plugin-owned site fetches must use the scraper WebView cookie/context path.
- App/repository fetches and plugin-owned site fetches must remain separate.
- Persistence should stay on SQLite through `src/db/client.ts`, `@tauri-apps/plugin-sql`, query helpers, and `src/db/schema.ts` / runtime bootstrap SQL / release schema version files. Direct `getDb()` use is acceptable only at explicit persistence boundaries such as backup snapshot/apply, library update checks, plugin-to-library import orchestration, or a justified Rust-side storage boundary.
- Avoid hidden per-item DB/network loops in update, search, download, backup, and plugin flows; use batching, maps, bounded concurrency, or cancellation where appropriate.
- Android foreground-service rules apply only to custom Android service work or device-validation changes; desktop queue behavior remains in-app.
