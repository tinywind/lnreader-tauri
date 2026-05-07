---
name: verify-api-naming-contract
description: Verify TypeScript and Rust API names accurately describe optionality, side effects, parsing, and failure behavior.
---

# Verify API Naming Contract

Use after changing `src/**/*.{ts,tsx}` or `src-tauri/src/**/*.rs`, especially IPC commands, scraper/plugin fetch code, DB helpers, backup import/export, download queue, and reader parsing.

## Rules

- `get*` / `get_*` may return optional values in this repo, but the return type must make absence explicit with `null`, `undefined`, `Option<T>`, or `Result<Option<T>, E>`.
- `find*`, `maybe*`, and `selectOptional*` are clearer for new optional lookup APIs, but do not flag existing `get*` query helpers solely for returning explicit `null`.
- `require*`, `ensure*`, and `assert*` must return a guaranteed value or nothing; failure must be explicit.
- `validate*` should not return Boolean for domain/security validation. Boolean predicates should use `is*`, `has*`, `can*`, `supports*`, or `exists*`.
- `parse*`, `extract*`, and `decode*` must not swallow malformed plugin HTML, JSON, backup manifests, EPUB data, or deep-link payloads unless the name advertises optionality.
- `fetch*`, `download*`, `install*`, `import*`, `export*`, and `save*` APIs must surface failures unless explicitly named best-effort.
- Plugin-owned site fetch names should make the scraper/WebView path obvious.
