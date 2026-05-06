---
name: verify-drizzle-ssot
description: Verify Drizzle schema remains the single source of truth for app-owned SQLite data.
---

# Verify Drizzle SSOT

Use after changing Drizzle schema, DB query modules, Tauri IPC commands that read/write app data, backup import/export gathering, or plugin repository cache code.

## Checks

- Drizzle schema remains the source of truth for app-owned SQLite tables.
- TypeScript DB query code should use Drizzle query builders or established DB helpers for ordinary table reads.
- Raw SQL is allowed for migrations, backups, performance-sensitive aggregate queries, or operations Drizzle cannot express cleanly; require a local justification when non-obvious.
- Tauri IPC handlers should not duplicate persistence DTOs when an existing DB/domain shape can be returned and mapped at the boundary.
- Plugin-owned fetch/site data stays outside this rule except for persisted app-owned cache tables.
- Backup import/export contract models must map explicitly to Drizzle fields rather than becoming a second live DB model.
- Flag unreferenced app-owned persistence models only after confirming no references outside the defining file.
