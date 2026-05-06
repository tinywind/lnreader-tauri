---
name: verify-frontend-filename
description: Verify norea frontend filenames match route, component, hook, and module conventions.
---

# Verify Frontend Filename

Use after adding or moving frontend files under `src/`.

## Scope

- Include non-generated files under `src/`.
- Exclude generated router output, `main.tsx`, `index.ts`, `index.tsx`, `node_modules`, and `dist`.

## Rules

- Route files under `src/routes/` follow TanStack Router conventions; do not flag lowercase route filenames solely by generic component rules.
- Component `.tsx` files whose primary export is a React component should use `PascalCase`.
- Utility modules, stores, IPC wrappers, plugin helpers, formatters, validators, and non-component modules should use `camelCase`.
- Files in a dedicated `hooks/` directory should start with `use`.
- Folders should be lowercase or camelCase unless dedicated to one named component.

## Output

If clean, say no Norea frontend filename violations were found in reviewed scope.
