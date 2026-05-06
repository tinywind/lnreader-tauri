# CLAUDE.md - agent guide for this repo

Read this before touching code or docs. Keep changes narrow, current, and tied
to the user's request.

## Language Policy

- Every committed file in this repo is written in English.
- The only place Korean or other non-English UI text may appear is under
  `strings/languages/<locale>/`.
- User-facing chat summaries may be Korean.
- Translate upstream reference comments or strings to English when importing
  them into this repo.

## Project Shape

Norea is a Tauri 2 light-novel reader for Windows, Linux, and Android.
It uses a Rust host plus a React/TypeScript UI. The project is inspired by
upstream `lnreader/lnreader`, but it is not a compatibility port. Upstream is
reference material for behavior and edge cases only.

Pinned upstream reference:

```text
https://github.com/lnreader/lnreader/tree/639a2538
```

## Living Documentation

- `README.md` - public overview, current status, and common commands.
- `CLAUDE.md` - repo rules for agents and contributors.
- `docs/plugins/contract.md` - plugin runtime compatibility reference.

Do not recreate removed planning snapshots unless the user explicitly asks for
an archive or roadmap document.

## Current Scope

Targets:

- Windows desktop.
- Linux desktop.
- Android sideload APK.

Out of scope unless the user changes direction:

- macOS and iOS builds.
- Upstream backup zip round-trip compatibility.
- Upstream MMKV/settings shape compatibility.
- Strict pixel parity with upstream React Native UI.
- TTS, volume-button page turn, Google Drive backup, and tracker integrations.
- In-app auto-update.

Release notes:

- Android APKs are built by GitHub Actions and kept as short-lived workflow
  artifacts for tester download.
- Do not track keystores, signing properties, passwords, or generated APKs.
- Repository secrets, not files in the worktree, provide release signing inputs.

## Repo Layout

```text
norea/
  README.md
  CLAUDE.md
  docs/
    plugins/contract.md
  src/
  src-tauri/
  assets/
  strings/
```

`assets/` and `strings/` started from upstream-compatible MIT material. They
are acceptable to keep, but they are not binding.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Native shell | Tauri 2 |
| Frontend | React 19 |
| UI | Mantine |
| Routing | TanStack Router |
| State | Zustand and TanStack Query |
| Database | SQLite through `tauri-plugin-sql` and drizzle proxy |
| HTTP | `tauri-plugin-http`, Rust-side fetch commands, and scraper WebView |
| Package manager | pnpm |
| Node | 22 LTS |

## Plugin Fetch Invariant

Plugin-owned site traffic must preserve browser-like session behavior.

- App and repository fetches may use ordinary app-side HTTP helpers.
- Plugin-owned source browsing, search, novel parsing, library update checks,
  and chapter downloads must go through the plugin fetch path in `src/lib/http.ts`
  and `src-tauri/src/scraper.rs`.
- The scraper WebView owns browser session state. When a protected site needs
  manual challenge clearing, use the site browser overlay instead of replacing
  plugin traffic with raw app-origin fetches.
- Do not switch plugin-owned site fetches to bare `fetch`, `reqwest`, copied
  cookies, or unrelated HTTP helpers without updating the plugin contract and
  tests.

## Coding Standards

- Keep changes surgical. Do not refactor adjacent code unless required.
- Match the existing style before introducing a new pattern.
- Use self-documenting code. Add comments only for public API docs, intent that
  is hard to infer, justified lint disables, or actionable TODOs.
- Do not add mock data, partial features, speculative options, or unused
  abstractions.
- Keep visible UI strings in the existing i18n files.
- Do not write generated artifacts, screenshots, logs, or temporary outputs into
  the repo. Use the project-root `.tmp/` directory and clean it up when done.

## Verification

Do not run build, compile, test, or git-mutating commands unless the user
explicitly requests them in the current message.

When verification is allowed, choose the smallest relevant loop:

| Change | Check |
| --- | --- |
| TypeScript or React | `pnpm tsc`, `pnpm test` |
| Rust host | `cargo check`, `cargo test --lib` from `src-tauri` |
| Desktop native integration | `pnpm tauri build --debug` |
| Android APK/release workflow | `pnpm android:apk:release` plus device smoke when behavior is Android-only |
| Docs only | Link/reference scan and `git diff --check` when requested |

## Git Workflow

- Work on `main` unless the user asks for another branch.
- Do not bypass hooks.
- Commit subject format: `<type>(<module>): <imperative summary>`.
- Types: `feat | fix | chore | docs | style | refactor | test`.
- Keep one coherent purpose per commit.
- Do not add `Co-Authored-By`, `Generated`, or AI-tool trailers.
- Do not push unless the user explicitly asks in the current message.
- If a push is rejected as non-fast-forward, stop and ask.

## Ask vs. Do

Ask before:

- Adding a third-party Tauri plugin or changing the stack.
- Renaming top-level paths or route structure.
- Using paid certificates, OAuth secrets, or other credentials.
- Running destructive filesystem or git operations.

Do without extra ceremony:

- Keep docs aligned with the current repo.
- Fix broken references caused by your own edits.
- Remove imports, variables, and files orphaned by your change.

## References

- Upstream repo: <https://github.com/lnreader/lnreader/tree/639a2538>
- Trigger issue for the rewrite: <https://github.com/lnreader/lnreader/issues/1835>
- Plugin catalog: <https://github.com/lnreader/lnreader-plugins>
- Tauri 2 docs: <https://v2.tauri.app/>
- This repo: <https://github.com/tinywind/norea>
