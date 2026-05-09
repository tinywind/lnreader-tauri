---
name: verify-norea-release-compatibility
description: Verify Norea release-line compatibility for database, backup, storage, import/export, release packaging, migration, plugin contract, and compatibility-impacting changes.
---

# Verify Norea Release Compatibility

Use this skill when checking whether a Norea change is complete and safe to
merge or release.

## Required References

- Read `CLAUDE.md` before judging repository rules.
- Read `docs/release-compatibility.md` when the change touches data, backups,
  storage, local files, import/export, migrations, or release behavior.
- Read `docs/plugins/contract.md` when the change touches source plugin runtime
  behavior.

## Compatibility Rule

Norea guarantees compatibility only inside the active release line:

- `1.0.0` and later: same major version only.
- `0.x.y`: same minor version only.

Inside the supported line, existing app data must remain readable through
migrations or backward-compatible readers. Outside that line, incompatible data
changes are allowed only when the release boundary and user-facing guidance are
documented.

## Verification Checklist

For data or release-affecting changes:

1. Identify whether the change is inside the current compatibility scope.
2. Check that database migrations, backup format handling, local file handling,
   and reader/import paths preserve data inside that scope.
3. Check that incompatible changes are aligned with the next allowed release
   boundary.
4. Check that README, `CLAUDE.md`, release notes, or developer docs reference
   the compatibility impact when users or agents need to know it.
5. Prefer the smallest relevant automated check, then add manual smoke steps
   only when automation cannot cover the behavior.
