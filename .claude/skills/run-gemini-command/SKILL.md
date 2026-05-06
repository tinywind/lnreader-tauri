---
name: run-gemini-command
description: Use Gemini as a bounded advisory reviewer for text-heavy norea analysis.
---

# Run Gemini Command

Use Gemini only when the user explicitly requests it or when a text-heavy review can be safely isolated.

## Rules

- Default mode is read-only advisory analysis.
- File editing by Gemini requires explicit permission in the current user message.
- Prompts and outputs must stay under `.tmp/`.
- Do not run build, compile, test, or git-mutating commands unless the current user request explicitly permits them.
- All generated prompt, report, and code artifacts must be English-only.
- Prompt must include repository, deliverable, allowed input files, decision boundaries, and output format.
- Current state, product direction, architecture, and repo rules come from the source-of-truth docs that exist in the current checkout.
- Gemini must not decide scraper WebView invariants, Tauri plugin adoption, Android foreground-service scope, or command-gate exceptions on its own.
