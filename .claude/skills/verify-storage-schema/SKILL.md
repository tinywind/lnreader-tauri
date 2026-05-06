---
name: verify-storage-schema
description: Verify persisted storage schema, status values, IPC DTOs, backup data shapes, and plugin cache ownership.
---

# Verify Storage Schema

Use after changing SQLite/Drizzle schema, migrations, persisted status values, Rust IPC DTOs, backup pack/unpack shapes, or plugin/repository cache tables.

## Rules

- Keep storage declarations grouped and deterministic.
- Every persisted table, column, and enum-like status value must have one clear owner: Drizzle schema/migration, Rust IPC/storage code, backup format, or plugin runtime cache.
- Status values serialized across TypeScript, Rust, SQLite, and backup payloads must match exactly.
- New persisted shapes must trace to a shipped route or documented work: Library, Browse/Search, Novel detail, Reader, Updates, History, More/Backup, or v0.2 Android foreground service.
- Do not import upstream MMKV, backup zip, strict plugin-contract, GraphQL, Kotlin, or jOOQ assumptions unless current code actually uses them.
