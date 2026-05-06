---
name: run-verify-skills
description: Run norea project-local verify-* skills in scope-aware order and write reports under .tmp/skill-reports.
---

# Run Verify Skills

Run active `.claude/skills/verify-*/SKILL.md` skills after meaningful repository changes.

## Scopes

- `full`: run every active verifier.
- `changed`: run verifiers intersecting explicitly provided changed paths.
- `frontend`: `src/**`, `strings/languages/**`, `package.json`.
- `rust`: `src-tauri/**`.
- `tauri`: `src/**` plus `src-tauri/**` when IPC, SQL, plugin fetch, backup, shell, dialog, or deep-link behavior is involved.
- `android`: Android-only custom code and foreground-service work.
- `docs`: repo source-of-truth docs, `README.md`, `docs/**`, `.claude/**`, and root agent instruction files.
- `custom`: only user-provided paths.

If `changed` scope is requested but changed files are unknown, ask instead of guessing.

## Execution

1. Build the queue from active local verifier directories, not stale reports.
2. Keep only prerequisites declared by target verifier docs.
3. Run isolated `skill-verifier` agents with a maximum of five concurrent agents.
4. Do not run build, compile, test, or git-mutating commands unless the current user message explicitly asks for them.
5. Continue after one verifier errors; record `ERROR`.
6. Keep generated reports in English.

## Reports

- Per-skill report: `.tmp/skill-reports/skill-run-<skill>.md`
- Master report: `.tmp/skill-reports/skill-execution-master-<YYYY-MM-DD>.md`

Run false-positive review only for `FAIL` or `WARN` reports when `norea-report-finding-reviewer` is available.

Console output should include only totals, FAIL/WARN summaries, false-positive totals, and the master report path.
