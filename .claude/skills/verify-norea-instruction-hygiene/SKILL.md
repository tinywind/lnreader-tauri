---
name: verify-norea-instruction-hygiene
description: Verify repo-local agent instruction files stay concise and do not duplicate product plans or status snapshots.
---

# Verify Norea Instruction Hygiene

Use after editing `AGENTS.md`, `CLAUDE.md`, nested instruction files, or `.claude/skills/**/SKILL.md`.

## Checks

- Inspect only project-local instruction files.
- Keep `CLAUDE.md` as an agent entry point, not a replacement for the product plan.
- Do not duplicate long product plans, route inventories, sprint acceptance tables, package script catalogs, or status snapshots.
- Link to the current product-plan document for product, architecture, stack, sprint, and acceptance policy.
- Link to the current status document for deferred work, smoke state, and tooling notes.
- Keep skill catalogs out of `AGENTS.md` and `CLAUDE.md`; point to `.claude/skills/` instead.
- Allow stable policy in instruction files: language policy, source-of-truth order, surgical changes, plugin fetch invariant, command/git restrictions, and communication policy.

## Output

Report duplicated owner doc, file path, line range, and shorter replacement direction.
