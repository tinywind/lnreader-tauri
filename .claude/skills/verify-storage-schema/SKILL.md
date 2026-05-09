---
name: verify-storage-schema
description: Verify persisted storage schema, status values, IPC DTOs, backup data shapes, and plugin cache ownership.
---

# Verify Storage Schema

Use after changing SQLite/Drizzle schema, migrations, persisted status values, Rust IPC DTOs, backup pack/unpack shapes, or plugin/repository cache tables.

## Rules

- Keep storage declarations grouped and deterministic.
- Every persisted table, column, and enum-like status value must have one clear owner: `src/db/schema.ts` / generated migrations, Rust IPC/storage code, backup format, or plugin runtime cache.
- Status values serialized across TypeScript, Rust, SQLite, and backup payloads must match exactly.
- New persisted shapes must trace to a shipped route or documented work: Library, Browse/Search, Novel detail, Reader, Updates, History, Settings/Backup, plugin repository/cache, or custom Android service work.
- Treat `app-logging-settings` as profile-local diagnostics state unless product docs explicitly move it into backup-managed settings.
- Do not import upstream MMKV, upstream backup-zip compatibility, strict upstream plugin-contract, GraphQL, Kotlin, or jOOQ assumptions unless current code actually uses them.
