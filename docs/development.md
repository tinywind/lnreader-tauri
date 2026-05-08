# Development Guide

This guide is for contributors who want to run, test, or change Norea locally.
The public README stays user-focused; this document keeps the practical developer
workflow in one place.

## Source of Truth

- `package.json` defines package scripts, dependencies, and the pinned package
  manager version.
- GitHub workflows define supported build tooling and release artifact jobs.
- `CLAUDE.md` defines repository rules for agents and contributors.
- `docs/plugins/contract.md` defines the source plugin compatibility contract.

## Build and Test Environment

Use the same major versions as CI when possible.

| Tool | Version / target | Used for |
| --- | --- | --- |
| Node.js | 22 LTS | Frontend build, tests, and Tauri CLI |
| pnpm | 10.27.0 | Package manager, pinned by `packageManager` |
| Rust | stable | Tauri host and native plugins |
| Java | JDK 17 | Android Gradle builds |
| Android SDK platform | `android-36` | Android APK builds |
| Android build tools | `36.0.0` | APK signing and build tools |
| Android NDK | `27.1.12297006` | Rust Android targets |
| Android Rust targets | `aarch64-linux-android`, `x86_64-linux-android` | Device APK and emulator/WSA APK |
| Linux Rust targets | `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` | Linux x64 and ARM64 release bundles |
| Windows Rust targets | `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | Windows x64 and ARM64 release bundles |

Desktop Linux builds also need the Tauri 2 system packages used by CI:
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
`librsvg2-dev`, `patchelf`, and `rpm`.

## Local Development

Install dependencies and start the desktop app:

```bash
pnpm install
pnpm tauri dev
```

`pnpm install` configures the local Git hooks path to `.githooks`. If hooks are
missing in an existing checkout, run this once:

```bash
pnpm hooks:install
```

## Automated Checks

Use the smallest relevant check for the change.

```bash
pnpm tsc
pnpm test
pnpm db:generate
pnpm tauri build --debug
```

After `pnpm db:generate`, commit any intended `drizzle/` migration changes. CI
fails when generated migrations drift from the checked-in schema.

Rust-side checks:

```bash
cd src-tauri
cargo check
cargo test --lib
```

Android APK build:

```bash
pnpm android:apk:release
```

This builds arm64 APKs for current physical devices and x86_64 APKs for
emulators or WSA.

## Release Artifact Workflows

The public README keeps download guidance user-focused. These are the workflow
artifact names and release-upload behavior used by maintainers.

| Workflow | Artifact names |
| --- | --- |
| Windows Release Bundles | `norea-windows-x64-nsis`, `norea-windows-x64-msi`, `norea-windows-arm64-nsis`, `norea-windows-arm64-msi`, plus matching checksum artifacts |
| Linux Release Bundles | `norea-linux-x64-appimage`, `norea-linux-x64-deb`, `norea-linux-x64-rpm`, `norea-linux-arm64-appimage`, `norea-linux-arm64-deb`, `norea-linux-arm64-rpm`, plus matching checksum artifacts |
| Android Release APKs | `norea-arm64-signed-release-apk`, `norea-x86_64-signed-release-apk`, and `norea-signed-release-apk-checksums` |

Pushes to `main` create short-lived workflow artifacts. Version tags matching
`v*` also upload collected bundles to the matching GitHub Release.

## Manual Smoke Test

Use this path when checking that the app still works end to end:

1. Start the desktop app with `pnpm tauri dev`.
2. Open Browse -> Sources.
3. Set the repository URL to the sample catalog from the README.
4. Refresh the repository and install one source plugin.
5. Browse or search that source and open a novel detail page.
6. Add the novel to the library.
7. Open a chapter in the reader and confirm paged or scrolling mode works.
8. Download at least one chapter and reopen it from the library.
9. Change reader theme or font settings and confirm they persist after reopening
   the reader.
10. Export a local backup and import it into a clean test profile when the change
    touches library, progress, category, repository, or downloaded chapter data.

For protected sources, open the in-app site browser first so the app can use the
same browser session for later source actions.

## Local Source Plugin Testing

The public sample source catalog is maintained in
[tinywind/norea-plugins](https://github.com/tinywind/norea-plugins). The app
stores a single active repository URL, and the published sample manifest is:

```text
https://raw.githubusercontent.com/tinywind/norea-plugins/plugins/v0.1.0/.dist/plugins.min.json
```

For local plugin development, keep a sibling checkout at `../norea-plugins` and
serve its generated manifest:

```bash
cd ../norea-plugins
npm install
cp .env.template .env
node scripts/generate-plugin-index.js
npm run build:compile
npm run build:manifest:dev
npm run dev
```

Then set the app's repository URL to:

```text
http://localhost:3000/.dist/plugins.min.json
```

When testing from Android or another device, replace `localhost` in `.env` and in
the app with a host address the device can reach, such as the development
machine's LAN IP or `10.0.2.2` for the Android emulator.

## Project Map

| Area | Path |
| --- | --- |
| React app | `src/` |
| Tauri/Rust host | `src-tauri/` |
| Android project shell | `src-tauri/gen/android/` |
| Database schema and migrations | `src/db/`, `drizzle/` |
| Plugin runtime | `src/lib/plugins/`, `src/lib/http.ts`, `src-tauri/src/scraper.rs` |
| i18n strings | `strings/languages/` |

## Contribution Rules

- Keep changes narrow and tied to the issue or request.
- Do not commit generated APKs, keystores, signing properties, local logs, or
  temporary build artifacts.
- Write user-facing app text through the existing i18n files.
- Keep documentation and source comments in English.
- Do not add mock data, partial features, or speculative options.
- Update tests or smoke-test notes when behavior changes.
