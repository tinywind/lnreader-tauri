---
name: verify-tauri-layer-boundary
description: Verify Norea UI, state, IPC, Rust runtime, SQLite/Drizzle, plugin fetch, reader, and validation responsibilities stay in their layers.
---

# Verify Tauri Layer Boundary

Use after changes crossing UI, state, IPC, Rust runtime, DB, plugin fetch, reader, or validation boundaries.

## Rules

- React routes/components own UI, routing, event binding, and display state.
- Zustand and TanStack Query own client state and async orchestration, not Rust/SQL internals.
- Tauri IPC commands should stay transport-thin: argument binding, permission/context checks, and response shaping.
- Rust runtime modules own file IO, backup pack/unpack, download queue, scraper fetch, EPUB/zip, and native operations.
- SQLite/Drizzle schema and query details stay in DB/persistence modules, except explicit persistence orchestration boundaries such as backup snapshot/apply, library update checks, plugin-to-library imports, and justified Rust storage bridges.
- Plugin-owned site fetch responsibility should stay behind the sanctioned scraper bridge; run `verify-plugin-fetch-contract` for detailed fetch-path review.
- Reader behavior belongs in reader runtime/settings code, not scattered through route UI.
- Validate once at the right boundary; avoid duplicated UI/IPC/schema validation.
