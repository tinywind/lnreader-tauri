# Norea

Norea is a local-first light-novel reader for people who want their library,
web sources, downloads, and reading progress in one place.

It is inspired by [lnreader/lnreader](https://github.com/lnreader/lnreader),
but it is a separate app with its own data, backup, and source system.

## What You Can Do

- Browse and search installed reading sources.
- Add novels to your library and organize them with categories.
- Read in paged or scrolling mode.
- Adjust themes, font size, text color, tap zones, and keyboard navigation.
- Track reading progress, history, unread chapters, and download state.
- Download chapter content for later reading.
- Export and import local backups for your library, progress, categories, source
  settings, and downloaded chapters.
- Use tester builds on Windows, Linux, and Android sideload APKs.

## Reader Goals

- Import and read local `.epub`, `.txt`, and `.html` files.
- Read HTML chapters downloaded from internet sources through installed source
  plugins.
- Keep images and other media from downloaded HTML chapters available locally.
- Render downloaded chapters correctly even when the internet connection is
  unavailable.

## Current State

Norea is usable for development and testing. It is not presented as a polished
store release yet.

Current limits:

- macOS and iOS are not planned right now.
- Some protected sources may require opening the in-app site browser once before
  search or downloads work.
- Android background-download behavior still needs device-level validation.
- APK artifacts are short-lived tester downloads, not an in-app updater.

## Get a Build

- Latest release page: [GitHub Releases](https://github.com/tinywind/norea/releases/latest)
- Linux desktop artifacts: [Linux Release Bundles workflow](https://github.com/tinywind/norea/actions/workflows/linux.yml)
- Tester APK artifacts: [Android Release APKs workflow](https://github.com/tinywind/norea/actions/workflows/android.yml)

The Android workflow uploads signed release APKs plus `SHA256SUMS.txt` as a
short-lived artifact. Open the latest successful workflow run and download
`norea-arm64-signed-release-apk` for physical devices or
`norea-x86_64-signed-release-apk` for emulators and WSA.

## Add Reading Sources

Reading sources are distributed separately from the app. The legal-safe sample
catalog is [tinywind/norea-plugins](https://github.com/tinywind/norea-plugins),
which contains public-domain, open-license, official-API, and user-owned
self-hosted source examples.

To use the published catalog in the app:

1. Open Browse -> Sources.
2. In Repository, choose Set repository.
3. Enter the repository manifest URL:

   ```text
   https://raw.githubusercontent.com/tinywind/norea-plugins/plugins/v0.1.0/.dist/plugins.min.json
   ```

4. Save it, refresh the repository if needed, then install sources from
   Available source plugins.

The app keeps one active repository URL. Saving a different URL replaces the
current repository index.

## For Developers

See [docs/development.md](./docs/development.md) for local setup, testing,
contribution rules, and the project map. Scripts and dependencies live in
`package.json`.

## Contributing

See [docs/development.md](./docs/development.md) before opening a contribution.

## License

MIT. Upstream assets and translation seeds remain MIT-compatible and are
credited in the app where relevant.
