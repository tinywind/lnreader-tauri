---
name: verify-scalable-ui-units
description: Verify Norea frontend UI-size scaling changes. Use when CSS, React inline styles, Mantine sizing, Android UI scale, root font-size scaling, rem conversion, or px-to-ratio refactors are changed and Codex must review git diff for fixed-size regressions, Android-only scale behavior, viewport misuse, and inconsistent safe-area scaling.
---

# Verify Scalable UI Units

Use this skill for diff-based review after changing Norea UI sizing. The goal is to keep the global app font size controlled by `fontScalePercent` through root font-size and proportional CSS units, while Android-only viewport density remains bounded by `androidViewScalePercent` and does not use WebView zoom.

## Scope

Review only files changed in `git diff`. Do not refactor unrelated code.

## Required Checks

1. Android view scale must not rely on WebView zoom, `zoomBy`, `setInitialScale(scalePercent)`, or `transform: scale()`.
2. `100%` Android view scale must preserve the native Android dp baseline, and Android view scale must not exceed `100%`.
3. Global font scale must apply through root font-size on every platform.
4. `75%` global font scale must make app UI smaller and `150%` must make app UI larger.
5. Spacing, touch target, icon box, fixed panel, and row dimensions introduced or edited in CSS should use `rem`, `em`, `var()`, `%`, viewport units, or `calc()` with a scale variable rather than raw `px`.
6. Leave deliberate hairlines and environment/native pixel bridges alone when appropriate: `1px` borders, safe-area native pixel conversion, shadows, and media-query breakpoints can remain raw pixels if changing them would alter platform behavior.
7. User-facing text must stay in `strings/languages/<locale>/` with English/Korean parity.
8. Do not flag upstream or unrelated pre-existing fixed pixels unless the diff edits that line.

## Evidence Format

Return findings first. For each finding include:

- severity: `high`, `medium`, or `low`
- file and line
- changed diff behavior
- concrete fix

If no findings exist, state that explicitly and list residual risks.

## Useful Commands

Use non-mutating commands only unless the user explicitly asks otherwise:

```bash
git diff -- <paths>
git diff --check -- <paths>
rg -n "\\b\\d+(?:\\.\\d+)?px\\b" src --glob '*.{css,ts,tsx}'
git grep -n -E "\\b[0-9]+(\\.[0-9]+)?px\\b" -- 'src/*.css' 'src/*.ts' 'src/*.tsx' 'src/**/*.css' 'src/**/*.ts' 'src/**/*.tsx'
```

Do not run build, compile, test, or git-mutating commands unless explicitly requested in the current user message.
