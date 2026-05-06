# LNReaderTauri

LNReaderTauri is a Tauri 2 light-novel reader for Windows, Linux, and Android.
It is inspired by [lnreader/lnreader](https://github.com/lnreader/lnreader),
but it is a separate project with its own database, backup format, plugin
runtime, and desktop-first shell.

The goal is a local-first reader that can run community source plugins, keep a
large web-novel library manageable, and work well in desktop windows as well as
Android freeform/DeX-style layouts.

## Highlights

- Cross-platform Tauri app targeting Windows, Linux, and Android sideload APKs.
- Plugin repository support for installing JavaScript source plugins.
- Browse, source-scoped search, and global search across installed plugins.
- Novel detail pages with chapter indexing, download state, and library actions.
- Reader with paged and scrolling modes, tap zones, keyboard navigation, themes,
  font controls, and persisted reading progress.
- Library, category, update queue, and reading-history screens.
- Local backup export/import for library data, progress, categories, repository
  settings, and downloaded chapter content.

## Status

The main application surface is implemented and usable for development/testing.

Current limits:

- macOS and iOS are out of scope.
- Protected sources may require opening the in-app site browser once so the
  scraper WebView can establish a browser session.
- Android background-download foreground-service behavior still needs
  device-level validation before it should be treated as complete.
- Release APK artifacts are for tester distribution, not an in-app updater.

## Get a Build

- Latest release page: [GitHub Releases](https://github.com/tinywind/lnreader-tauri/releases/latest)
- Tester APK artifacts: [Android Release APKs workflow](https://github.com/tinywind/lnreader-tauri/actions/workflows/android.yml)

The Android workflow uploads signed release APKs plus `SHA256SUMS.txt` as a
short-lived artifact. Open the latest successful workflow run and download
`lnreader-tauri-signed-release-apks`.

## Plugin Repository

Source plugins are distributed separately from the app. The legal-safe sample
catalog is [tinywind/lnreader-tauri-plugins](http://github.com/tinywind/lnreader-tauri-plugins),
which contains public-domain, open-license, official-API, and user-owned
self-hosted source examples.

To use the published catalog in the app:

1. Open Browse -> Sources.
2. In Repository, choose Set repository.
3. Enter the repository manifest URL:

   ```text
   https://raw.githubusercontent.com/tinywind/lnreader-tauri-plugins/plugins/v0.1.0/.dist/plugins.min.json
   ```

4. Save it, refresh the repository if needed, then install plugins from
   Available source plugins.

The app keeps one active repository URL. Saving a different URL replaces the
current repository index.

For local plugin development, keep a sibling checkout at
`../lnreader-tauri-plugins` and serve its generated manifest:

```bash
cd ../lnreader-tauri-plugins
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

When testing from Android or another device, replace `localhost` in `.env` and
in the app with a host address the device can reach, such as the development
machine's LAN IP or `10.0.2.2` for the Android emulator.

## Screenshots

Screenshots should use public-domain demo text, not copyrighted novel content.
Use [docs/screenshots/README.md](./docs/screenshots/README.md) for the capture
list and legal sample books. Once captured, add:

- `docs/screenshots/library.png` - library, categories, progress, and unread state.
- `docs/screenshots/browse.png` - plugin repository, installed sources, and global search.
- `docs/screenshots/reader.png` - paged reader with settings-friendly typography.

## Develop

Requirements:

- Node.js 22 LTS
- pnpm 10
- Rust stable
- Platform prerequisites for Tauri 2
- Android SDK, NDK, and JDK 17 when building Android APKs locally

Install and run the desktop app:

```bash
pnpm install
pnpm tauri dev
```

Useful checks:

```bash
pnpm tsc
pnpm test
pnpm tauri build --debug
```

Android APK build:

```bash
pnpm android:apk:release
```

Rust-side checks:

```bash
cd src-tauri
cargo check
cargo test --lib
```

## Project Map

| Area | Path |
| --- | --- |
| React app | `src/` |
| Tauri/Rust host | `src-tauri/` |
| Android project shell | `src-tauri/gen/android/` |
| Database schema and migrations | `src/db/`, `drizzle/` |
| Plugin runtime | `src/lib/plugins/`, `src/lib/http.ts`, `src-tauri/src/scraper.rs` |
| i18n strings | `strings/languages/` |

## Documentation

- [CLAUDE.md](./CLAUDE.md) - repo rules for agents and contributors.
- [docs/plugins/contract.md](./docs/plugins/contract.md) - plugin runtime
  compatibility reference.

Implementation-time planning snapshots have been removed from the live docs so
new work does not inherit obsolete roadmap assumptions.

## Contributing

Keep changes narrow and current. Do not commit generated APKs, keystores,
signing properties, local logs, or temporary build artifacts. User-facing text
belongs in the existing i18n files.

## License

MIT. Upstream lnreader assets and translation seeds remain MIT-compatible and
are credited in the app where relevant.
