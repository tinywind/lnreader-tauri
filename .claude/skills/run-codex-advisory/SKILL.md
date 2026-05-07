---
name: run-codex-advisory
description: Use an auxiliary Codex run for bounded advisory analysis in norea.
---

# Run Codex Advisory

Use an auxiliary Codex process only when the user requests Codex analysis or a bounded high-value review is useful.

## Rules

- The auxiliary run is advisory-only by default.
- Prompts and outputs belong under `.tmp/`.
- Prompt must include task, deliverable, allowed files, edit permission, and the command gate.
- Preserve English-only artifacts and Korean user-facing summaries.
- Include the scraper/WebView invariant for plugin-owned site fetch analysis.
- Do not rely on launcher profile names from another repo unless this repo has equivalent launcher scripts.
- Do not run build, compile, test, or git-mutating commands unless the current request explicitly permits them.
