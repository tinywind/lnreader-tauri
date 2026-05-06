---
name: verify-reader-settings-appearance
description: Verify Norea reader settings, appearance, per-novel state, theme, layout, and progress semantics stay coherent.
---

# Verify Reader Settings Appearance

Use after changing reader UI, reader settings, appearance/theme state, per-novel state, progress semantics, paging/scroll behavior, or imported upstream reader behavior.

## Scope

- `src/components/ReaderContent.tsx`
- `src/components/ReaderSettingsPanel.tsx`
- `src/routes/reader.tsx`
- `src/store/reader.ts`
- `src/store/appearance.ts`
- reader-related CSS and locale strings
- any DB/query code that persists reader progress or downloaded chapter state

## Checks

- Reader settings should have one durable owner and should not be split into unrelated route-local state.
- Per-novel reader state, read progress, and chapter completion must remain coherent across Reader, Updates, History, and Novel detail surfaces.
- Appearance options such as theme, font, line height, margins, alignment, and paged/scroll mode should map to stable state and CSS variables without layout jitter.
- Reader visible strings must use `strings/languages/<locale>/`.
- Reader behavior imported from upstream must be treated as reference material and translated to English when copied into docs or comments.
- Reader UI changes should preserve icon-based header controls and shared back affordance patterns already used in this repo.
- If a change affects paging math, click zones, or progress calculation, recommend focused Vitest/E2E checks only when the command gate allows them.

## Output

Report concrete state ownership, persistence, appearance, progress, i18n, or interaction findings with file and line references.
