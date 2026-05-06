---
name: verify-shared-helper-style
description: Verify shared TypeScript and Rust helpers avoid stateless wrappers, vague names, and misplaced plugin fetch abstractions.
---

# Verify Shared Helper Style

Use after editing shared helper modules in `src/**` or `src-tauri/src/**`.

## Rules

- In TypeScript, flag static-only utility classes, default-exported function bags, and namespace-like objects when named exports and file-level constants are enough.
- In Rust, flag empty structs or impl-only wrappers for stateless helpers unless they model state, lifecycle, traits, Tauri state, or a real domain type.
- Hoist reused `RegExp`, parser constants, route/query keys, CSS variable names, headers, and Rust constants to file scope when reused.
- Do not introduce dependencies just to satisfy helper style.
- Remove private helpers that only forward arguments unless they add validation, type adaptation, platform separation, error mapping, cancellation handling, or boundary clarity.
- Prefer role-specific names such as `parseChapterHtml`, `normalizePluginSiteUrl`, or `buildReaderThemeVars`.
- Helper abstractions must not hide plugin-owned fetches behind the wrong fetch path.
