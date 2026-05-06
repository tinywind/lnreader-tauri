---
name: verify-suppression-justification
description: Verify TypeScript, Rust, and custom Android suppressions are rare, narrow, and justified.
---

# Verify Suppression Justification

Use after adding or changing suppression comments or attributes.

## Scope

- TypeScript/React: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `oxlint-disable`, `biome-ignore`.
- Rust/Tauri: `#[allow(...)]`, `#![allow(...)]`, `#[expect(...)]`.
- Kotlin only for custom Android bridge or plugin code that the repo owns, including hand-written files under generated Android shells.
- Exclude generated/build/vendor paths such as `node_modules`, `dist`, `target`, and generated Android boilerplate that was not hand-written for this repo.

## Rules

1. Prefer removing the suppression by refactoring.
2. Kept suppressions need a nearby English reason tied to a real TypeScript, Rust, Tauri, platform, framework, or generated-boundary limitation.
3. Blanket file/module suppressions fail unless a repo-local rule explicitly permits them.
4. Bare disables fail; name the exact rule or diagnostic.
5. Convenience reasons or comments that repeat the rule name fail.
6. React hook dependency suppressions require stronger scrutiny.
7. Rust broad allow attributes require a narrow boundary reason.
8. Suppressions must not hide plugin-owned fetch invariant violations.
