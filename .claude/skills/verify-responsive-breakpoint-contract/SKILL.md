---
name: verify-responsive-breakpoint-contract
description: Verify Norea responsive breakpoint and media-query changes. Use when CSS, React, reader layout, app shell, route layout, or responsive media query code changes width breakpoints, min-width/max-width queries, matchMedia strings, or route-specific desktop/mobile cutoffs.
---

# Verify Responsive Breakpoint Contract

Use after changing Norea responsive layout, media queries, `matchMedia`, route-level desktop/mobile cutoffs, or breakpoint constants.

## Source of Truth

`src/main.tsx` owns the app breakpoint names:

- `xs`: `576`
- `sm`: `768`
- `md`: `992`
- `lg`: `1200`
- `xl`: `1408`

Width media queries must use those starts for `min-width` and the previous pixel for `max-width`:

- `max-width: 575px` for below `xs`
- `max-width: 767px` for below `sm`
- `max-width: 991px` for below `md`
- `max-width: 1199px` for below `lg`
- `max-width: 1407px` for below `xl`

## Checks

1. Search every changed CSS, TS, and TSX file for width media queries and `matchMedia` strings before reviewing behavior.
2. Reject ad hoc width cutoffs such as `420px`, `760px`, `768px` used as `max-width`, `980px`, `1100px`, `1120px`, `1201px`, `48rem`, `62em`, or any new non-canonical breakpoint unless the diff also updates the breakpoint contract intentionally.
3. `min-width` queries should use breakpoint starts: `576px`, `768px`, `992px`, `1200px`, or `1408px`.
4. `max-width` queries should use non-overlapping breakpoint ends: `575px`, `767px`, `991px`, `1199px`, or `1407px`.
5. Do not mix `px`, `rem`, and `em` for breakpoint thresholds in the same contract. Convert width breakpoints to explicit `px` values matching `src/main.tsx`.
6. Route-specific desktop/mobile layout switches must align to the same breakpoint contract unless there is a documented product reason in the changed code.
7. Non-width media queries such as `prefers-reduced-motion`, pointer capability, hover capability, color scheme, and print rules are outside this skill unless they are combined with width cutoffs.
8. If media query changes affect UI sizing units, also run `verify-scalable-ui-units`.
9. If media query changes affect reader controls, input zones, or mobile/desktop interaction behavior, also run `verify-norea-ui-interaction`.

## Useful Commands

Use non-mutating commands only unless the user explicitly asks otherwise:

```bash
rg -n "@media[^\n]*\((min|max)-width|\((min|max)-width:\s*[^)]+\)" --glob "*.{css,ts,tsx}" --glob "!node_modules/**" --glob "!dist/**" --glob "!src-tauri/target/**"
rg -n "matchMedia|MediaQueryList|useMediaQuery|breakpoint|MANTINE_.*_MIN_WIDTH" src --glob "*.{ts,tsx}"
git diff --check -- <paths>
git diff -U0 -- <paths>
```

Do not run build, compile, test, or git-mutating commands unless explicitly requested in the current user message.

## Evidence Format

Return findings first. For each finding include:

- severity: `high`, `medium`, or `low`
- file and line
- current breakpoint value
- expected breakpoint value from `src/main.tsx`
- concrete fix

If no findings exist, say that explicitly and list the searched files or command pattern. A clean diff result does not prove the whole app has no responsive layout issues unless the whole repo was searched.
