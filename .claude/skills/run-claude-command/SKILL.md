---
name: run-claude-command
description: Use an auxiliary Claude run for bounded advisory analysis in norea without bypassing project rules.
---

# Run Claude Command

Use auxiliary Claude runs only for bounded advisory analysis, second opinions, or reference comparison.

The current agent remains responsible for final decisions.

## Rules

- Prompt must include the exact task, deliverable, repository scope, writable vs advisory-only mode, and relevant norea constraints.
- Keep all prompt/output scratch files under `.tmp/`.
- Do not use auxiliary runs to bypass the command gate, git rules, repository scope, or plugin-fetch invariant.
- Artifacts remain English-only; chat summaries may be Korean.
- The pinned upstream reference is reference material, not a compatibility contract.
- Require the auxiliary run to cite concrete files and line numbers.

If the local launcher script or auth profile is unavailable, treat this skill as a prompt-shaping guide rather than an executable workflow.
