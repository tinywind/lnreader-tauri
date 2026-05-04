# CLAUDE.md — guide for AI agents working in this repo

> Read this top-to-bottom before touching code or docs. Keep it
> short. Anything not here is in [`prd.md`](./prd.md).

> **🌐 Language policy — non-negotiable.**
>
> - **Every file committed to this repo is written in English.** That
>   includes Markdown, Rust and TypeScript source, inline comments,
>   JSDoc / Rust-doc, commit messages, identifiers, log strings,
>   `TODO:` notes.
> - **The only place Korean (or any non-English natural language) may
>   appear is `strings/languages/<locale>/` translation files.**
> - **The user prefers Korean for chat replies. That preference does
>   not extend to artifacts.** Reply summaries to the user can be
>   Korean; everything written to a file or to git stays English.
> - When importing reference material from upstream lnreader that
>   contains non-English strings or comments, **translate to English**
>   on the way in.

## 1. What this project is

**LNReaderTauri** is a **Tauri 2 light-novel reader** running on
**Windows, Linux, and Android** from one Rust + TypeScript codebase.

The project is **inspired by** upstream
[`lnreader/lnreader`](https://github.com/lnreader/lnreader) (a
React-Native + Expo + Fabric reader) but is **a separate, independent
project** — not a port, not compatibility-targeted. Upstream is
**reference material only** for behaviors and edge cases; nothing in
this repo is bound by an upstream contract.

The project is currently in the **Sprint 0 phase** (toolchain +
scaffold).

## 2. Source-of-truth documents

1. [`prd.md`](./prd.md) — product + engineering plan (canonical).
2. [`CLAUDE.md`](./CLAUDE.md) — this file.
3. [`docs/`](./docs/) — **upstream behavioral reference** captured
   from `lnreader/lnreader@639a2538`. Use as inspiration, not as a
   contract. See [`docs/HANDOFF.md`](./docs/HANDOFF.md) for which
   documents in that tree are still useful and which are superseded.

## 3. Repo layout

```
lnreader-tauri/
├── CLAUDE.md            ← this file
├── README.md
├── prd.md               ← product + engineering plan
├── docs/                ← upstream behavioral reference (mostly)
├── src/                 ← TypeScript code lands here in Sprint 0
├── src-tauri/           ← Rust core (lands in Sprint 0)
├── assets/              ← icons + splash (sourced from upstream — fine to use)
└── strings/             ← i18n base (sourced from upstream — fine to use)
```

`assets/` and `strings/` started life as upstream copies; upstream is
MIT, so they are licensed compatibly and acceptable to keep. They are
**not** binding — replace freely if the new app needs different
content.

## 4. Pinned upstream reference

When `docs/` references upstream code it is pinned to commit
`639a2538` (HEAD as of 2026-05-04). URL pattern:

```
https://github.com/lnreader/lnreader/blob/639a2538/<path>
```

That commit is a **frozen reference snapshot**; we are free to diverge
at any point.

## 5. Out of scope (intentional cuts in v0.1)

Items below may revisit in v0.2. Issues / PRs that try to add them in
v0.1 are closed `wontfix`:

| Cut | Reason |
|---|---|
| **macOS desktop builds** | No Apple Developer Program, no macOS hardware available for testing. |
| **iOS builds** | Same as above. |
| **Code signing on Windows / Linux / Android** | Unsigned debug builds only for v0.1. |
| **In-app auto-update** (`tauri-plugin-updater`) | Requires signing. v0.1 users get a "Latest release" link in More that opens GitHub Releases via `tauri-plugin-shell`. |
| **Upstream backup `.zip` round-trip compatibility** | Separate project; we design our own format. |
| **Upstream MMKV / settings shape compatibility** | Separate project; we design our own keys. |
| **Strict upstream plugin contract compatibility** | We aim for *most* community plugins to work, but invent our own contract where simpler. |
| **TTS reading + lockscreen media controls** | Niche, large platform-specific surface. |
| **Volume-button page turn** | Niche; needs Android keyevent plugin. |
| **Google Drive backup** | OAuth + Drive plumbing not worth carrying. |
| **Tracker integrations** (MAL, AniList, MangaUpdates, Kitsu) | OAuth × 4, multi-vendor; minority feature. |
| **Default-category settings sub-page** | Upstream stub never worked. Default category stays id=1. |

## 6. Coding & doc standards

- All code and docs in English.
- Self-documenting code; comments only for: public API JSDoc / Rust
  doc, intent explanations, justified lint-disables, `TODO:` with
  reference.
- No partial features, mock data, stubs, or speculative code (YAGNI).
- No marketing language. State trade-offs honestly.
- Surgical changes: every changed line should trace to a stated
  request. No drive-by refactor.
- One coherent purpose per commit; split mixed Rust+TS+docs commits.
- Commit subject: `<type>(<module>): <imperative summary>`, ≤72 chars.
  Types: `feat | fix | chore | docs | style | refactor | test`.
- Branches: **`main` only** for v0.1 (per user direction). No feature
  branches, no PRs.
- Prohibited commit metadata: `Co-Authored-By: Claude` trailers,
  `🤖 Generated with` footers.
- `git push` is **handled manually by the user** — agents do not
  push.

## 7. Tech stack (v0.1)

| Layer | Choice |
|---|---|
| Native shell | Tauri 2.x |
| Frontend framework | React 19 |
| **UI** | **Mantine** (`@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `@mantine/modals`, `@mantine/dates` as needed) — batteries-included React UI library |
| Routing | TanStack Router (type-safe) |
| State | Zustand + TanStack Query |
| Animation | Framer Motion + CSS — never animate layout-bound props (`width`, `height`, `top`, `left`); only `transform`, `opacity`, `clip-path`, `filter` |
| ORM | drizzle-orm + `drizzle-orm/sqlite-proxy` calling `tauri-plugin-sql` |
| DB | SQLite via `tauri-plugin-sql` (sqlx underneath) |
| HTTP | `tauri-plugin-http` + Rust `reqwest` (cookie jar built-in) |
| EPUB | Rust `rbook` crate |
| Zip | Rust `zip` crate |
| Package manager | pnpm |
| Node | 22 LTS |

## 8. Sprint structure (`prd.md §8`)

| Sprint | Theme |
|---|---|
| 0 | Toolchain, scaffold, fresh DB schema, drizzle bridge |
| 1 | Library tab end-to-end |
| 2 | Plugin scraping + Cloudflare hidden-WebView (gated) |
| 3 | Reader (paged + scroll, single chapter) |
| 4 | Background download (Android foreground service) |
| 5 | Backup & restore (local + self-hosted) — our own format |
| 6 | Remaining UI surface + polish |

Each sprint is one focused week. Don't work on Sprint N+1 until
Sprint N's acceptance is met. Sprint 2 (CF bypass) is the
load-bearing gate.

## 9. Testing methodology

**Default test target: desktop** (Windows / Linux). Mobile is Android
only — no iOS hardware.

### 9.1 Test matrix

| Layer | Tool | Frequency |
|---|---|---|
| TS unit | Vitest | Every commit (`pnpm test`) |
| Rust unit | `cargo test` | Every commit on Rust changes |
| Type check | `pnpm tsc --noEmit` + `cargo check` | Every commit |
| TS+Rust IPC | Vitest with mocked `invoke` + `tauri::test` | Sprint boundaries |
| Plugin sandbox | Vitest fixtures running real upstream plugins | Sprint 2+ |
| Backup round-trip | Rust integration test | Sprint 5 |
| E2E desktop | WebdriverIO + `tauri-driver` (preferred) | Sprint boundaries |
| Manual smoke (desktop) | Run on Windows + Linux | Pre-release |
| Manual smoke (Android) | adb on real device or emulator | Sprint 4 + pre-release |

Mobile-only verification (Android only):
- **Android freeform / DeX window resize** — the bug class that
  motivated the rewrite must be gone by construction.
- **Android foreground service for downloads** (Sprint 4).
- **Cloudflare hidden WebView on Android Chromium** (Sprint 2).
- **Deep link `lnreader://`**.
- **Touch gestures** — paged-mode swipe.

### 9.2 Per-sprint test minimum

| Sprint | Required before "done" |
|---|---|
| 0 | Type check, `cargo check`, smoke launch on Windows + Linux. |
| 1 | + Vitest covers Library DB queries through drizzle proxy. |
| 2 | + Plugin sandbox Vitest passes; CF hidden-webview Rust integration test on a real CF site. |
| 3 | + Reader Vitest for paged-mode page-count math; E2E read-chapter on desktop. |
| 4 | + Foreground-service Rust unit test (mocked); manual smoke 50-chapter download on real Android. |
| 5 | + Backup round-trip Rust integration test (lnreader-tauri → file → lnreader-tauri lossless). |
| 6 | + Full acceptance journey list on desktop + Android DeX. |

### 9.3 AI agent test loops

| Loop | Mode | Use when |
|---|---|---|
| **A. Frontend-only browser** | `pnpm dev` + Playwright MCP + mocked `invoke()` | Default for UI work. ~80 % of bugs. Sub-second iteration. |
| **B. Tauri desktop E2E** | WebdriverIO + `tauri-driver` (`cargo install tauri-driver`) | When the change crosses into Rust commands (Sprint 2/4/5). |
| **C. Android device / emulator** | `adb` via Bash (install / launch / `screencap` / `uiautomator dump`) | Mobile-only items in §9.1. |
| **D. Unit / type checks** | `pnpm tsc --noEmit && pnpm test`, `cargo check && cargo test` | Every commit. |

Default loop is **A**. Move to B when IPC is exercised. Move to C
only for the mobile-only items.

## 10. When you make changes

- Don't bypass git hooks (no `--no-verify`).
- Don't push (the user handles `git push`).
- Don't add a `Co-Authored-By: Claude` footer.
- Don't write Korean or other-language source/doc comments.
- Don't keep dead code "just in case." Remove imports/variables/files
  your changes orphaned.

## 11. Ask vs. do

Use judgment, but err on **ask** for:
- Adopting a third-party Tauri plugin not listed in `prd.md §6`.
- Changing the §7 tech stack picks.
- Renaming repo top-level paths or `src/` subdirectories.
- Anything that requires a paid certificate, OAuth secret, or other
  credential.
- Destructive Bash (`rm -rf`, `git reset --hard`, etc.) — even when
  the user pre-authorized auto-commits.

Err on **do** for:
- Implementing planned sprint deliverables.
- Filling in or correcting docs.
- Adding `UNKNOWN: <what>` markers when behavior is unclear.
- Auto-committing per the agreed cadence (one coherent purpose per
  commit, English message, no AI footers).

## 12. Communication

Korean replies are preferred for user-facing summaries; code,
comments, commits, and docs remain in English.

When the user asks for analysis or a multi-step task and parallel
sub-agents help, use them — the `docs/screens/` and
`docs/acceptance/` trees were originally produced by 10 parallel
sub-agents.

## 13. References

- Upstream repo (pinned `639a2538`, **reference only**):
  <https://github.com/lnreader/lnreader/tree/639a2538>
- Upstream issue that triggered the rewrite:
  <https://github.com/lnreader/lnreader/issues/1835>
- lnreader-plugins (community plugin catalog we may consume):
  <https://github.com/lnreader/lnreader-plugins>
- Tauri 2 docs: <https://v2.tauri.app/>
- This repo: <https://github.com/tinywind/lnreader-tauri>
