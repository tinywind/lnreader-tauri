---
name: verify-frontend-complexity
description: Verify Norea React components and frontend helpers keep input surfaces small and cohesive.
---

# Verify Frontend Complexity

Use after changing React components, route components, or frontend helpers under `src/**`.

## Scope

- Include `src/**/*.{ts,tsx}`.
- Exclude tests, generated files, `node_modules`, and `dist`.

## Thresholds

- Route/page/feature component: fail at 8 or more top-level props.
- Reusable UI primitive/wrapper: fail at 12 or more custom top-level props, ignoring inherited Mantine/HTML props.
- Utility/helper function: fail at 6 or more positional parameters unless justified.

Count a grouped object as one input.

## Allowed Cohesive Contracts

Do not flag cohesive DTOs such as plugin metadata, novel/chapter records, backup manifests, route search params, reader settings, form values, or filter state.

Prefer grouped contracts named around app domains such as `reader`, `navigation`, `settings`, `plugin`, `source`, `novel`, `chapter`, `downloadQueue`, `backup`, and `filters`.
