---
name: verify-tauri-ipc-command-contract
description: Verify frontend invoke calls, Rust Tauri commands, serde DTOs, mocks, and plugin fetch IPC stay synchronized.
---

# Verify Tauri IPC Command Contract

Use after editing Rust Tauri commands, frontend `invoke()` wrappers, IPC DTO types, mocked invoke tests, or plugin fetch commands.

## Checks

- Every frontend-invoked command must be registered in the Tauri invoke handler.
- Renamed or removed commands must leave no stale call sites or mocks.
- `invoke(command, args)` keys must match Rust command parameter names and serde DTO shapes.
- Rust return/error shapes and TypeScript consumers must stay synchronized.
- For plugin-owned site fetch commands, preserve the documented scraper/site-browser cookie path.
- Ordinary app/repository fetches may use normal app HTTP utilities.

Suggest verification commands only when useful; do not run them unless explicitly allowed.
