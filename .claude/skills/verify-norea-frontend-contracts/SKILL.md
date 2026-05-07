---
name: verify-norea-frontend-contracts
description: Verify Norea frontend stack contracts for Tauri APIs, TanStack state, Mantine UI, browser globals, i18n, animation, and plugin fetches.
---

# Verify Norea Frontend Contracts

Use after changing `src/**` files that touch routes, components, TanStack Query, Zustand state, Tauri plugin APIs, plugin scraping, browser globals, visible strings, or animation.

## Checks

- This repo has no GraphQL runtime contract; do not import generated GraphQL document assumptions.
- If plugin-owned fetch paths change, also run `verify-plugin-fetch-contract`; this skill only checks obvious frontend misuse.
- App/repository fetches should remain conceptually separate from plugin-owned site fetches.
- Use TanStack Query for route-level async app/plugin data and cache invalidation; use Zustand for durable client UI state.
- Local component state is allowed for form fields, dialogs, file pickers, transient progress, and one-shot Tauri actions.
- Do not flag direct `useQuery` until checking whether it is a route/composite loader.
- Keep visible strings in `strings/languages/<locale>/`.
- Prefer Mantine components for ordinary UI.
- Animate only compositor-friendly properties: `transform`, `opacity`, `clip-path`, and `filter`.
- Browser globals are acceptable in browser-only UI code with import-time guards when needed.
