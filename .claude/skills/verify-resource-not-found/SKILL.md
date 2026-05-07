---
name: verify-resource-not-found
description: Verify missing Norea resources use explicit not-found handling instead of generic failures or silent fallbacks.
---

# Verify Resource Not Found

Use after changing lookup paths for novels, chapters, categories, repositories, installed plugins, downloaded chapter content, or backups.

## Rules

- Missing resources must have explicit absence semantics: `null`, `undefined`, `Option<T>`, a named empty state, or a contextual error.
- Do not use panic, `unwrap`, `expect`, or silent empty fallback when callers need absence semantics.
- Raw `Error` is acceptable inside TypeScript helpers only when it carries operation context and is not used to hide ordinary optional lookup behavior.
- Rust IPC commands should map missing records/files into contextual command errors that React can render safely.
- TypeScript routes and UI actions should handle missing ids, DB rows, and files with deliberate empty/error states.
- User-visible not-found text must use `strings/languages/<locale>/` keys.
- Plugin-owned site failures are not local not-found resources; keep scraper/network/Cloudflare errors separate.
