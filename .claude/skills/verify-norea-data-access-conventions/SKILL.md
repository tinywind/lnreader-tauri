---
name: verify-norea-data-access-conventions
description: Verify Norea DB, repository cache, and plugin data access conventions.
---

# Verify Norea Data Access Conventions

Use after changing DB access, plugin fetches, scraper runtime, repository cache, backup/import/export, or download queue persistence.

## Rules

- App DB access must stay on the documented SQLite path: Drizzle/sqlite-proxy through `tauri-plugin-sql`, or an established Rust IPC/storage boundary.
- Do not introduce a second ORM, browser storage replacement, or direct DB path without an explicit tech-stack change.
- Plugin-owned site fetch changes should also run `verify-plugin-fetch-contract`; this skill only flags obvious data-access helpers that bypass the sanctioned scraper bridge.
- Repository/plugin index/list queries must define deterministic ordering at the query/helper boundary.
- Conflict helpers should be named by behavior: `upsert*` for update-on-conflict and `insertIfAbsent*` for do-nothing-on-conflict unless a stronger local name exists.
- Do not add thin wrappers that only forward to lower-level query/fetch/update calls without domain meaning.
