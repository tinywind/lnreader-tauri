---
name: verify-resource-not-found
description: Verify missing Norea resources use explicit not-found handling instead of generic failures or silent fallbacks.
---

# Verify Resource Not Found

Use after changing lookup paths for novels, chapters, categories, repositories, installed plugins, downloaded chapter content, or backups.

## Rules

- Missing resources must return or throw explicit not-found application errors.
- Do not use raw `Error`, panic, `unwrap`, `expect`, or silent empty fallback when callers need absence semantics.
- Rust IPC commands should map missing records/files into structured command errors that React can render safely.
- TypeScript routes and UI actions should handle missing ids or DB rows with deliberate empty/error states.
- User-visible not-found text must use `strings/languages/<locale>/` keys.
- Plugin-owned site failures are not local not-found resources; keep scraper/network/Cloudflare errors separate.
