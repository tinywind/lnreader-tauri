---
name: verify-localized-strings
description: Verify user-facing Norea UI text uses strings/languages locale keys with en/ko parity.
---

# Verify Localized Strings

Use after changing UI text, notifications, dialogs, reader/settings labels, backup messages, plugin install/search text, or locale JSON files.

## Scope

- `src/**/*.{ts,tsx}`
- `strings/languages/**`
- Rust IPC errors only when they can surface to users.

## Checks

- User-facing strings in React code should use the existing translation path.
- Korean and other non-English text must appear only under `strings/languages/<locale>/`.
- New or changed translation keys must exist across supported locale files, currently `en` and `ko`.
- Do not concatenate translated fragments in code; prefer full-sentence keys with placeholders.
- Rust/Tauri errors that surface to the UI should preserve stable operation context; localization belongs at display boundaries.

## Output

Report hardcoded text, missing keys, key parity gaps, and string-concatenation risks with file and line references.
