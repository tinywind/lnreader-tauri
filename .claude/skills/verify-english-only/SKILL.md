---
name: verify-english-only
description: Verify norea code, comments, docs, and logs stay English outside strings/languages locale files.
---

# Verify English Only

Use after editing source, docs, comments, logs, TODOs, or imported upstream reference material.

## Scope

- Include `src/**`, `src-tauri/src/**`, root Markdown docs, `docs/**`, and hand-written config.
- Exclude `strings/languages/**`, generated Android output, `node_modules`, `dist`, `build`, `target`, and `.tmp`.

## Checks

- Report Hangul, CJK, or other non-English natural-language text outside translation files.
- Check comments, JSDoc, Rust docs, TODO/FIXME/HACK/XXX notes, string literals, logs, and Markdown docs.
- Allow locale values under `strings/languages/<locale>/`.
- When importing upstream material, require English translation on the way in.

## Output

Return concrete findings with file and line references. If clean, say no English-only violations were found in scope.
