---
name: verify-norea-ui-interaction
description: Verify Norea UI interaction semantics, async state, reader controls, and cross-platform behavior.
---

# Verify Norea UI Interaction

Use after changing interactive UI under `src/**`.

## Checks

- User actions must use semantic controls: `button`, `a`, TanStack `Link`, Mantine interactive components, or real form controls.
- Avoid clickable `div` or `span`.
- Avoid nested interactive DOM in cards, rows, chapter lists, reader chrome, toolbars, and plugin controls.
- Do not require or introduce `@tanstack/react-form`; use existing React/Mantine patterns unless the repo adopts a form library.
- Local async state is allowed for Tauri IPC, file dialogs, backup import/export, plugin install/uninstall, chapter download, deep links, route transitions, and multi-step reader/settings flows.
- Flag async state only when it merely duplicates a nearby TanStack Query status.
- Reader click zones, keyboard navigation, dialogs, and Android/freeform-sensitive UI must not rely on desktop-only hover or fixed-window assumptions.
- Plugin-owned site fetch UI must not imply raw app-origin fetch behavior.

## Output

Report semantic control, nested DOM, form ownership, redundant async state, Tauri/plugin flow, and cross-platform interaction findings.
