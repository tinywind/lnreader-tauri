---
name: verify-tauri-write-return-contract
description: Verify Norea DB-backed mutations return explicit affected-row or named mutation results across persistence, IPC, and UI boundaries.
---

# Verify Tauri Write Return Contract

Use after changing library/category/chapter progress/history/download state, plugin install/uninstall, repository cache, backup restore/import, or DB-backed create/update/delete/upsert/status-change flows.

## Rules

- Persistence/application write functions should return a numeric affected-row count or a named mutation result object.
- Operations may instead return a created entity, id, path, manifest, or domain object when that is the natural result.
- Tauri IPC commands may expose UI-friendly contracts, but conversion from numeric write result to Boolean must happen at the IPC/UI action boundary and be obvious, such as `rowsAffected > 0`.
- Do not apply this rule to pure read/check helpers, provider/network success booleans, file-system availability checks, chapter content fetches, or backup payload objects with their own result shape.

Failures should cite file path, symbol, current return shape, and expected boundary.
