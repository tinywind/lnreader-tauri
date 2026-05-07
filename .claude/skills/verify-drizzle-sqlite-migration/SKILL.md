---
name: verify-drizzle-sqlite-migration
description: Verify SQLite Drizzle schema and migrations preserve Norea app data and migration safety.
---

# Verify Drizzle SQLite Migration

Use when Drizzle schema, generated SQLite migrations, `tauri-plugin-sql` DB client code, backup DB gather/apply logic, or library/plugin persistence changes.

## Checks

- Review edited schema and migration files first.
- Treat the repo as SQLite + Drizzle, not Flyway/PostgreSQL.
- Use local naming consistency and existing domain names; do not import naming rules from another repo.
- Check SQLite-safe DDL: constraints, defaults, nullable changes, foreign keys, indexes, and migration ordering.
- Confirm migrations preserve library, categories, installed plugins, chapters, read progress, history, downloads, and backup/restore round trips.
- Keep migrations free of mock/sample/demo rows.
- If schema changes affect generated Drizzle artifacts, recommend `pnpm db:generate`, `pnpm tsc`, and focused tests only when the command gate allows.
- If plugin persistence changes, check Browse/search/install restart behavior against `README.md`, `docs/plugins/contract.md`, and current plugin manager/cache code.
