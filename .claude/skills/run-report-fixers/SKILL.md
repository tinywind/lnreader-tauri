---
name: run-report-fixers
description: Run fixer agents for reviewed norea verification reports with confirmed actionable findings.
---

# Run Report Fixers

Run `norea-report-fixer` workers only for reviewed verification reports with confirmed actionable fixes.

## Inputs

Use reports from `.tmp/skill-reports/skill-run-verify-*.md` unless the user explicitly names another report path.

Process only reports that:
- include `## False Positive Review`;
- include actionable `Fix now` items;
- reference an existing local skill at `.claude/skills/<skill-name>/SKILL.md`.

## Scheduling

- Never schedule two workers with overlapping actionable file sets.
- Treat uncertain or broad file scopes as exclusive.
- Keep worker prompts report-scoped.

## Worker Prompt Requirements

Include:
- repository: `norea`
- report path
- source skill path
- `fix: confirmed-only`
- `skip: false-positive, needs-decision`
- the instruction to obey current repo source-of-truth docs and the command gate

Do not use bypass-permission modes. Do not run build, compile, test, or git-mutating commands unless explicitly requested in the current invocation.

Write English-only fixer summaries and master reports under `.tmp/skill-reports/`.
