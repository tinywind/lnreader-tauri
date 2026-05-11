---
name: verify-drizzle-sqlite-migration
description: Verify SQLite Drizzle schema, bootstrap SQL, and release-boundary migrations preserve Norea app data and migration safety.
---

# Verify Drizzle SQLite Migration

Use when Drizzle schema, runtime bootstrap SQL, release-boundary SQLite migrations, `tauri-plugin-sql` DB client code, backup DB gather/apply logic, or library/plugin persistence changes.

## Migration Policy

- Pre-release schema changes do not accumulate one migration file per edit.
- Before a release boundary, the current schema may replace prior development migration history.
- Release schema version files are created only at release boundaries.
- Compatibility review applies to released schema versions, not discarded pre-release development history.
- Existing local development databases may be reset when the current pre-release bootstrap schema intentionally replaces them.

## Checks

- Review edited schema, bootstrap SQL, and release schema version files first.
- Treat the repo as SQLite + Drizzle, not Flyway/PostgreSQL.
- Use local naming consistency and existing domain names; do not import naming rules from another repo.
- Check SQLite-safe DDL: constraints, defaults, nullable changes, foreign keys, indexes, and release migration ordering when a release-boundary migration exists.
- Confirm release-boundary migrations preserve library, categories, installed plugins, chapters, read progress, history, downloads, and backup/restore round trips inside the supported release line.
- Keep bootstrap SQL and release migrations free of mock/sample/demo rows.
- Do not flag missing per-edit generated migrations during pre-release schema churn.
- If schema changes require release-boundary generation, recommend `pnpm db:generate`, `pnpm tsc`, and focused tests only when the command gate allows.
- If plugin persistence changes, check Browse/search/install restart behavior against `README.md`, `docs/plugins/contract.md`, and current plugin manager/cache code.
