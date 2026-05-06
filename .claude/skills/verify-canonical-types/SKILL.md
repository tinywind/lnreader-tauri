---
name: verify-canonical-types
description: Verify Norea TypeScript code reuses canonical Drizzle, plugin, backup, and IPC types instead of duplicating contracts.
---

# Verify Canonical Types

Use after editing TypeScript that touches DB rows, plugin metadata/results, download/backup payloads, or Tauri IPC-facing data.

## Rules

- Drizzle tables are canonical for persisted DB row and insert shapes. Prefer `$inferSelect` and `$inferInsert`.
- Do not create local interfaces that restate persisted entities such as Novel, Chapter, Repository, InstalledPlugin, backup records, or repository cache rows unless they are UI-only view models.
- Plugin-facing types should come from the existing plugin contract/runtime modules.
- IPC payload/result types should be centralized near the command wrapper boundary and imported by UI code.
- Local form/search/filter state is allowed when it is UI-only or transforms intentionally into canonical persistence, plugin, or IPC types.
- Raw status strings are allowed only for UI sentinels; persisted or contract-backed statuses should use existing constants, unions, or enums.
