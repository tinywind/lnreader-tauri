# CLAUDE.md — guide for AI agents working in this repo

> Read this top-to-bottom before touching code or docs. It is short
> on purpose. Anything that is not here is in [`prd.md`](./prd.md) or
> [`docs/HANDOFF.md`](./docs/HANDOFF.md).

> **🌐 Language policy — non-negotiable.**
>
> - **Every file committed to this repo is written in English.** That
>   includes Markdown documentation, Rust and TypeScript source code,
>   inline comments, JSDoc / Rust-doc, commit messages, PR
>   descriptions, issue titles and bodies, identifiers, log strings,
>   `UNKNOWN:` markers, and `TODO:` notes.
> - **The only place Korean (or any non-English natural language) may
>   appear is the `strings/languages/<locale>/` translation files.**
>   Those exist precisely because the rest of the repo is English.
> - **The user prefers Korean for chat replies. That preference does
>   not extend to artifacts.** Reply summaries to the user can be
>   Korean; everything you write to a file or to git stays English.
> - If you are running as a sub-agent and your "report back" includes
>   Korean, that is fine — it is a transient message, not a file.
>   The file you wrote must still be English.
> - When porting upstream lnreader code or docs that contain Korean
>   strings or comments, **translate them to English** as you import
>   them. Never preserve non-English comments verbatim into this repo.

## 1. What this project is

`lnreader-tauri` is a **Tauri 2 rewrite** of upstream
[`lnreader/lnreader`](https://github.com/lnreader/lnreader) targeting
Windows, macOS, Linux, iOS, and Android from one Rust + TypeScript
codebase. The trigger for the rewrite is a class of bugs in the
React-Native + Expo + Fabric stack that no longer come for free
(see [lnreader/lnreader#1835](https://github.com/lnreader/lnreader/issues/1835)
— the DeX/freeform decor-view clamp). The economics: smaller
binaries, real desktop builds, sane plugin model, and the bug class
disappears at the framework level because Tauri attaches the OS
WebView directly to the window.

The project is currently in the **planning / handoff phase**. No
runtime code yet. The next code commit will be Sprint 0 from
`prd.md §9`.

## 2. Source-of-truth documents (read these first)

In rough order of importance for any task:

1. [`prd.md`](./prd.md) — product + engineering plan. Every section
   is load-bearing.
2. [`docs/HANDOFF.md`](./docs/HANDOFF.md) — index of upstream
   knowledge transferred into this repo.
3. [`docs/reader/specification.md`](./docs/reader/specification.md) —
   the most non-obvious spec; touch this if the reader needs work.
4. [`docs/plugins/contract.md`](./docs/plugins/contract.md) — plugin
   module shape; **must remain compatible** with
   [lnreader-plugins](https://github.com/lnreader/lnreader-plugins).
5. [`docs/plugins/cloudflare-bypass.md`](./docs/plugins/cloudflare-bypass.md)
   — the highest-risk subsystem. Sprint 2 is gated on this.
6. [`docs/backup/format.md`](./docs/backup/format.md) — wire format
   for `data.zip` / `download.zip`. Round-trip with upstream is a
   release blocker.
7. [`docs/settings/catalog.md`](./docs/settings/catalog.md) — every
   persisted MMKV key with type and default.
8. [`docs/domain/model.md`](./docs/domain/model.md) — ER diagram +
   row lifecycles + invariants.
9. [`docs/screens/`](./docs/screens/) — per-screen layout +
   interactions (incrementally produced).
10. [`docs/acceptance/critical-paths.md`](./docs/acceptance/critical-paths.md)
    — top user journeys that must not regress.

## 3. Repo layout

```
lnreader-tauri/
├── CLAUDE.md            ← this file
├── README.md
├── prd.md               ← product + engineering plan (read me)
├── docs/                ← human-written specs
│   ├── HANDOFF.md
│   ├── reader/
│   ├── plugins/
│   ├── backup/
│   ├── settings/
│   ├── domain/
│   ├── screens/         ← per-screen specs (in progress)
│   └── acceptance/      ← critical paths (in progress)
├── src/                 ← TypeScript code lands here in Sprint 0
│   ├── database/schema/ ← drizzle schema (verbatim from upstream)
│   └── theme/           ← 9 themes (verbatim from upstream)
├── strings/languages/en/strings.json   ← base i18n catalog (verbatim)
├── drizzle/             ← migration history (verbatim)
├── drizzle.config.ts
├── assets/              ← icons + splash (verbatim from upstream)
└── src-tauri/           ← Rust core (lands in Sprint 0)
```

The `src/`, `strings/`, `drizzle/`, `assets/` directories are
**verbatim copies** from upstream `lnreader/lnreader@639a2538`. Treat
them as authoritative for the schema and design tokens — do not
"improve" them on the way in unless the rewrite explicitly requires
the change.

## 4. Pinned upstream version

All references to upstream code in this repo's docs are pinned to
**commit `639a2538`** of `lnreader/lnreader` (HEAD as of 2026-05-04).
When linking to upstream files, use:

```
https://github.com/lnreader/lnreader/blob/639a2538/<path>
```

Behaviors that change in upstream after that commit must be
re-evaluated before adopting them here.

## 5. Out-of-scope features (`prd.md §3`)

These are **intentional cuts**. Issues and PRs that try to bring them
back will be closed `wontfix`:

- TTS reading (`expo-speech`) and lockscreen media controls.
- Volume-button page turn (Android `dispatchKeyEvent`).
- Google Drive backup (`@react-native-google-signin/google-signin`).
- Tracker integrations (MAL, AniList, MangaUpdates, Kitsu) — same
  OAuth-on-mobile reasoning as the Drive cut. Tracker users continue
  to use upstream lnreader as their tracker companion in v0.1.
- Default-category settings sub-page — upstream's `LibrarySettings`
  route is registered but unmounted at `639a2538`. Default category
  stays hardcoded to id=1; users pick category at add-time.

Backup files round-trip those fields for compatibility (see
[`docs/settings/catalog.md`](./docs/settings/catalog.md) §5/§6) but
the runtime never acts on them.

## 6. Things you must NOT break

| Invariant | Why |
|---|---|
| The plugin module shape in [`docs/plugins/contract.md`](./docs/plugins/contract.md) | Hundreds of community plugins exist; users get continuity on day one. |
| The backup zip layout in [`docs/backup/format.md`](./docs/backup/format.md) | Round-trip migration with upstream lnreader. |
| The drizzle schema in [`src/database/schema/`](./src/database/schema/) | User databases imported via backup must open without migrations. |
| The MMKV key set in [`docs/settings/catalog.md`](./docs/settings/catalog.md) | Settings round-trip in backups. |
| The 9 themes in [`src/theme/md3/`](./src/theme/md3/) (typo `mignightDusk` preserved) | Theme key strings are used in backups; renaming breaks restore. |
| The MMKV key string `INSTALL_PLUGINS` (literal — note the JS const name is `INSTALLED_PLUGINS` but the persisted string is `INSTALL_PLUGINS`) | Backup round-trip of the installed-plugin list. See [`docs/settings/catalog.md`](./docs/settings/catalog.md) §1. |
| `LibrarySettings` is the **canonical** source for `incognitoMode` and `downloadedOnlyMode`; the `AppSettings` copies are deprecated leftovers. The new app reads/writes only `LibrarySettings`; backups handle the deprecated fields per [`docs/backup/format.md` §7.4](./docs/backup/format.md). | Single-source state — replicating the upstream duplication would propagate the bug. |

If a rewrite truly requires breaking one of these, propose it in an
issue first with a migration plan — never silently.

## 7. Coding & doc standards

- All code and docs in English.
- Self-documenting code; comments only for: public API JSDoc, intent
  explanations, justified lint-disables, TODOs with ticket refs.
- No partial features, mock data, stubs, or speculative code (YAGNI).
- No marketing language. State trade-offs honestly.
- Surgical changes: every changed line should trace to a stated
  request. Don't drive-by refactor adjacent code.
- One coherent purpose per commit; split mixed Rust+TS+docs commits.
- Commit subject: `<type>(<module>): <imperative summary>`, max 72
  chars. Types: `feat | fix | chore | docs | style | refactor | test`.
- Branches: `main` (stable), `feature/*`, `bugfix/*`, `hotfix/*`.
- Prohibited commit metadata: `Co-Authored-By: Claude` style trailers,
  `🤖 Generated with` footers.

## 8. Tech-stack constraints from `prd.md`

- **Frontend**: React 19. UI library is **Mantine** (preferred) or
  **shadcn/ui** — final pick is Sprint 0 deliverable. Until decided,
  do not commit code that locks one in.
- **Routing**: TanStack Router.
- **State**: Zustand + TanStack Query.
- **Animation**: Framer Motion + CSS. Never animate layout-bound
  props (`width`, `height`, `top`, `left`); only `transform`,
  `opacity`, `clip-path`, `filter`.
- **ORM**: drizzle-orm + `drizzle-orm/sqlite-proxy`. The proxy
  adapter calls into `tauri-plugin-sql`.
- **DB**: SQLite via `tauri-plugin-sql` (sqlx underneath).
- **HTTP**: `tauri-plugin-http` + Rust `reqwest`. Cookie jar is
  built-in but is separate from the WebView store — see
  [`docs/plugins/cloudflare-bypass.md` §4.3](./docs/plugins/cloudflare-bypass.md).
- **EPUB parsing**: Rust `rbook` crate.
- **Zip**: Rust `zip` crate.

## 9. Sprint structure (`prd.md §9`)

Each sprint is one focused week. Do not work on Sprint N+1 until
Sprint N's acceptance is met.

| Sprint | Theme |
|---|---|
| 0 | Toolchain, scaffold, DB bridge |
| 1 | Library tab end-to-end |
| 2 | Plugin scraping + Cloudflare hidden-WebView (gated) |
| 3 | Reader (paged + scroll, single chapter) |
| 4 | Background download (Android foreground service) |
| 5 | Backup & restore (local + self-hosted) |
| 6 | Remaining UI surface + polish |

Sprint 2 is **the gate**. If Cloudflare bypass cannot complete in one
week, escalate before continuing.

## 10. When you make changes

### 10.1 Touching specs (`docs/`)

- The pinned commit hash applies — if upstream behavior diverges from
  `639a2538`, mark the doc with a dated note instead of silently
  rewriting.
- `UNKNOWN: <what>` is acceptable when behavior cannot be confirmed
  from code. Do not invent.
- Cross-link instead of duplicating; the docs are designed to be
  read in any order.

### 10.2 Touching code (when Sprint 0 starts)

- See §11 below for the full testing methodology.
- Don't bypass git hooks (no `--no-verify`).
- Don't force-push `main`.

### 10.3 Discovering new gaps

If a real user behavior is not covered by these docs, **add a section**
rather than silently coding around the gap. The docs are the spec; code
that disagrees with them is a bug regardless of which side moved.

## 11. Testing methodology

**Default test target: desktop.** Tauri 2 attaches the OS WebView
(WebKit2GTK on Linux, WebView2 on Windows, WKWebView on macOS)
directly to the window — no extra layout layer like RN/Fabric — so
the desktop builds expose 90% of the bugs that the mobile builds will
hit. Iterate on desktop; promote to mobile only at sprint boundaries
and before releases.

### 11.1 Why desktop first

- `pnpm tauri dev` reloads in ~1 s. Mobile emulators need 30+ s per
  cycle plus Xcode/Android Studio overhead.
- DevTools (right-click → Inspect) work natively in the WebView.
- Rust + TypeScript unit tests run without any device.
- Window resize, multi-display, freeform-style layouts are easy to
  reproduce by dragging the window — covers the upstream DeX bug
  class for free.
- The OS WebViews ARE the same engines used on iOS (WKWebView) and on
  Android (Chromium-based System WebView), so JS behavior matches
  closely. Differences mostly show up in input (touch vs mouse) and
  background-task limits, both of which are sprint-specific (4, 6).

### 11.2 Test matrix

| Layer | Tool | Frequency | Notes |
|---|---|---|---|
| TS unit (UI logic, parsers, state) | **Vitest** | Every commit | `pnpm test`. Co-located `*.test.ts(x)` files. |
| Rust unit (Tauri commands, plugins) | `cargo test` | Every commit on Rust changes | `mod tests { ... }` in the same file. |
| Type check | `pnpm tsc --noEmit` + `cargo check` | Every commit | Cheap; run before push. |
| TS + Rust IPC integration | Vitest with mocked `invoke`, plus a small `tauri::test` harness on the Rust side | Sprint boundaries | Verifies command shapes match. |
| Plugin runtime sandbox | Vitest fixtures running real upstream plugins (e.g. BoxNovel index.js) | Sprint 2 onward | Ensures the sandbox semantics in [`docs/plugins/contract.md`](./docs/plugins/contract.md) §5 are intact. |
| Backup round-trip | Rust integration test | Sprint 5 | Pack a fixture DB, unpack into a fresh DB, diff. Must match upstream zip layout — [`docs/backup/format.md` §13](./docs/backup/format.md). |
| E2E (desktop) | **WebdriverIO + tauri-driver** (preferred) or Playwright (frontend-only mode) | Sprint boundary | Drives a real release build. Used for the journeys in [`docs/acceptance/critical-paths.md`](./docs/acceptance/critical-paths.md). |
| Manual smoke (desktop) | Run on Windows + macOS + Linux | Pre-release | One pass on each platform; window resize, deep link, fullscreen. |
| Manual smoke (mobile) | Android phone, iOS phone, S23 DeX | Release candidates | Mobile-only items only — see §11.4. |

### 11.3 Per-sprint test minimum

| Sprint | Required tests before "done" |
|---|---|
| 0 | Type check, `cargo check`, smoke launch on Win + macOS + Linux. |
| 1 | + Vitest covers Library DB queries through drizzle proxy; manual smoke restoring an upstream backup zip. |
| 2 | + Plugin sandbox Vitest fixtures pass; CF hidden-webview Rust integration test (real CF site); E2E "browse + add to library" journey on desktop. |
| 3 | + Reader Vitest for paged-mode page-count math; E2E "read a chapter end-to-end" on desktop with both scroll and paged modes; manual smoke on phone for swipe gestures. |
| 4 | + Foreground-service Rust unit test (mocked); manual smoke on a real Android phone: queue 50 chapters, background the app, confirm completion. |
| 5 | + Backup round-trip Rust integration test passes upstream-tauri-upstream loss-free; E2E "create backup → restore" on desktop. |
| 6 | + Run the full acceptance journey list on desktop and on the S23 DeX (the rewrite's reason-for-being). |

### 11.4 Mobile-only test cases

The following can only be observed on real devices; do not pretend
desktop coverage is sufficient:

- **DeX / freeform window resize** — the original bug. After Sprint 6,
  the app must render the entire UI to the freeform bounds for any
  window position and size.
- **Android foreground service for downloads** — Sprint 4 acceptance.
- **iOS background-fetch limits** — Sprint 4 (document the
  constraint; do not promise parity with Android).
- **Cloudflare hidden WebView on Android Chromium** — JS timing
  differs slightly from desktop WebViews.
- **Deep link `lnreader://`** — handled by `tauri-plugin-deep-link`
  per platform; verify on each.
- **Touch gestures** — paged-mode swipe dragging is finger-driven;
  mouse drag covers the simple case but not multi-touch.

### 11.5 Continuous integration

Sprint 0 wires up GitHub Actions:

- `pnpm install && pnpm tsc --noEmit && pnpm test && cargo check && cargo test` on every PR.
- `pnpm tauri build` on every PR for Linux + Windows + macOS (matrix).
- Mobile builds are **not** run on PRs (slow; needs signing certs).
  Triggered manually on tag releases.

### 11.6 Fixtures and seed data

- `tests/fixtures/upstream-backup-small.zip` — real upstream backup
  with 3 novels and 30 chapters. Used for backup round-trip tests.
- `tests/fixtures/plugins/boxnovel-index.js` — vendored copy of a
  simple upstream plugin for sandbox tests.
- `tests/fixtures/db-1k-novels.sqlite` — large-library performance
  fixture for Library scroll tests.

Do **not** commit user backups or real reading history into fixtures.

### 11.7 What an AI agent (Claude / Claude Code) can drive directly

The agent can act as the test runner via the loops below. Use these
to iterate without a human in the seat — same pattern that diagnosed
the DeX bug in upstream lnreader.

| Loop | Mode | How |
|---|---|---|
| **A. Frontend-only browser** | Vite dev server + mocked `invoke()` | Run `pnpm dev` in background. Use the `mcp__playwright__browser_*` MCP tools to `navigate http://localhost:5173`, then click / fill / `snapshot` / `take_screenshot`. Mock `window.__TAURI__` per test. Covers ~80 % of UI logic at sub-second iteration. |
| **B. Full Tauri desktop E2E** | Real Rust + real OS WebView | WebdriverIO + [`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/). Install once via `cargo install tauri-driver` + `msedgedriver` (Windows) / `WebKitWebDriver` (Linux/macOS). Run `wdio` via Bash. **Playwright cannot drive a Tauri window** — it targets Chromium/Firefox/WebKit-standalone, not the OS WebView attached to a Tauri window. |
| **C. Android device / emulator** | Real APK on real device | `adb` via Bash. `adb install -r app-release.apk`, `adb shell am start --display N -n …`, `adb shell screencap -d <id> /sdcard/x.png && adb pull` then `Read` the PNG. `adb shell uiautomator dump` for view-tree assertions. Verified working on the upstream DeX repro. |
| **D. iOS simulator** | macOS only | `xcrun simctl` + Tauri's iOS build. The agent can drive this only on a macOS host; on Windows / Linux, hand it to a human. |
| **E. Visual regression** | Screenshot diff | Capture in any of A/B/C, save under `.tmp/`, `Read` the PNG (multi-modal), compare. Or use Playwright's `toHaveScreenshot()` against pixel baselines. |
| **F. Unit / type checks** | CLI | `pnpm tsc --noEmit && pnpm test`, `cargo check && cargo test`. Standard Bash. |

**Preferred default loop is (A)**: it matches the desktop-first stance
in §11.1 and the agent already has Playwright MCP tools loaded. Move
to (B) when a feature crosses the IPC boundary into Rust commands —
Sprint 2 (CF hidden WebView), Sprint 4 (foreground service control),
Sprint 5 (backup pack/unpack). Move to (C) only for the §11.4
mobile-only items.

When opening a (B) or (C) loop, write the setup commands into the
sprint's PR description so the next contributor can re-run them.

## 12. Don'ts

- Don't reintroduce TTS, volume-button page turn, or Google Drive.
- Don't rename theme keys (especially `mignightDusk`).
- Don't break the drizzle schema unless via a new dated migration.
- Don't change backup field shapes unless the change round-trips with
  upstream.
- Don't add a `Co-Authored-By: Claude` footer to commits.
- Don't write Korean or other-language source/doc comments. (User
  conversation language ≠ code language; user prefers Korean replies
  but code/docs are English.)
- Don't keep dead code "just in case." Remove imports/variables/files
  your changes orphaned.
- Don't claim mobile coverage based on desktop tests. The §11.4 list
  must be exercised on real hardware.

## 13. Conventions specific to this repo

- The legacy upstream typo `mignightDusk` (instead of `midnightDusk`)
  is preserved across the schema, the file path
  `src/theme/md3/mignightDusk.ts`, and the persisted theme key. Do
  not "fix" it.
- The pseudo-plugin id `'local'` is reserved. See
  [`docs/domain/model.md` §7](./docs/domain/model.md#7-pseudo-plugin-local).
- The reader's `progress` column is monotonic non-decreasing. Never
  persist a smaller value.
- The MMKV key `SELF_HOST_BACKUP` is intentionally **excluded** from
  backups (machine-bound credentials). See
  [`docs/backup/format.md` §4](./docs/backup/format.md#4-settingjson).

## 14. Ask vs. do

Use judgment, but err on **ask** for:

- Anything that breaks one of the §6 invariants.
- Adopting a third-party Tauri plugin not listed in `prd.md §6`.
- Changing the §8 tech stack picks.
- Renaming repo top-level paths or `src/` subdirectories.

Err on **do** for:

- Filling in `docs/screens/<area>.md` from upstream code reading.
- Fixing typos / formatting in markdown.
- Adding mermaid diagrams that clarify a doc.
- Adding `UNKNOWN: <what>` markers when a behavior is unclear.

## 15. Communication

When the user asks for analysis or a multi-step task and you can run
sub-agents in parallel, do so — the `docs/screens/` and
`docs/acceptance/` directories were originally produced by 10
parallel sub-agents per the planning conversation. Use the
general-purpose agent type unless a specialized one fits better.

Korean replies are preferred for user-facing summaries (per the user
profile); code, comments, commits, and docs remain in English.

## 16. References

- Upstream repo (pinned `639a2538`): <https://github.com/lnreader/lnreader/tree/639a2538>
- Upstream issue that triggered the rewrite: <https://github.com/lnreader/lnreader/issues/1835>
- lnreader-plugins (the plugin catalog we must stay compatible with): <https://github.com/lnreader/lnreader-plugins>
- Tauri 2 docs: <https://v2.tauri.app/>
- This repo: <https://github.com/tinywind/lnreader-tauri>
