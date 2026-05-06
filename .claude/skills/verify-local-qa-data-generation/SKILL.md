---
name: verify-local-qa-data-generation
description: Verify local QA data remains dev/test scoped and exercises real Norea app paths.
---

# Verify Local QA Data Generation

Use after adding fixture generators, seed tooling, smoke helpers, or local QA data.

## Rules

- Migrations and startup code should contain schema or true runtime invariants only.
- Do not seed sample novels, chapters, repositories, progress, downloads, or demo UI state in production paths.
- Local QA data generators must be dev/test scoped.
- QA data should exercise real app paths: plugin install/search/download, library add/remove, reader progress, backup import/export, and Tauri IPC where applicable.
- Do not replace plugin-owned site fetch validation with static fixtures.
- Direct fixture setup is allowed inside focused tests or explicit local tooling, not runtime app behavior.
- Report static violations; report missing smoke coverage only after an authorized run.
