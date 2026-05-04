# Reader Specification

> Tier 1.3. Source-of-truth for every reader behavior we must reproduce.
> Extracted from upstream `android/app/src/main/assets/js/core.js`,
> `src/screens/reader/`, `src/hooks/persisted/useSettings.ts`, and
> `src/hooks/common/useFullscreenMode.ts` at commit `639a2538`.
>
> The reader is the most complex screen in the app. Most "feel" is
> non-obvious unless you read the upstream JS that runs inside the
> WebView. This document captures that JS so the new React component
> can be written from the spec, not by reverse engineering.

## 1. Two reader modes

Controlled by `chapterGeneralSettings.pageReader: boolean`.

| Mode | `pageReader` | Layout | Saves progress on |
|---|---|---|---|
| Scroll | `false` | `display: block` chapter; the user scrolls the body | `scrollend` |
| Paged | `true` | `column-width: 100vw` chapter; transform translates between columns | every page move that advances `progress` past the previous max |

Mode switching at runtime is a `van.derive` reaction: when
`pageReader` flips, the body class `page-reader` is added/removed and
the layout is rebuilt after a 100 ms timeout (gives the browser time to
re-flow before recomputing). On the way **into** paged mode the current
scroll ratio (`window.scrollY + layoutHeight) / chapterHeight`) is
mapped to a target page so the user does not lose their place.

## 2. Layout invariants

The reader JS captures these on mount:

- `paddingTop` — `getComputedStyle(body).padding-top`, integer.
- `chapterHeight` — `chapterElement.scrollHeight + paddingTop`, refreshed via `reader.refresh()`.
- `chapterWidth` — `chapterElement.scrollWidth`, refreshed via `reader.refresh()`.
- `layoutHeight` — `window.innerHeight`. **Do not use `screen.height`** — this is the explicit fix introduced in upstream `3962a151`. WSA, foldables, freeform, split-screen all break if you use `screen.*`.
- `layoutWidth` — `window.innerWidth`, same reasoning.

A debounced 150 ms `window.resize` listener rereads `layoutHeight` and
`layoutWidth` and, in paged mode, re-runs `calculatePages()`. The
ResizeObserver on `chapterElement` does the same when the chapter
content itself resizes (font load, image load, etc.).

## 3. Click zones

`detectTapPosition(x, y, horizontal)` divides the viewport into thirds.
`x` and `y` are normalized: `x = clientX / layoutWidth`, `y = clientY / layoutHeight`.

Paged mode (`horizontal = true`):

- `x < 0.33` → `'left'` → previous page
- `x > 0.66` → `'right'` → next page
- otherwise → `'center'` → toggle reader chrome (`reader.post({ type: 'hide' })`)

Scroll mode with `tapToScroll = true` (`horizontal = false`):

- `y < 0.33` → scroll **up** by `0.75 * layoutHeight`
- `y > 0.66` → scroll **down** by `0.75 * layoutHeight`
- otherwise → toggle reader chrome

Scroll mode with `tapToScroll = false`: any tap toggles chrome.

## 4. Swipe gestures

Listener attached to `reader.chapterElement`. Tracks `initialX/Y` on
`touchstart`, computes deltas on `touchend`.

Paged mode:

- During `touchmove`, `chapterElement.transform = translateX(-(page - dragRatio) * 100%)` provides live drag preview.
- On `touchend`:
  - `dragRatio < -0.3` → advance one page
  - `dragRatio > 0.3` → previous page
  - otherwise → snap back to current page

Scroll mode with `swipeGestures = true`:

- A swipe is recognized when `|diffX| > 2 * |diffY|` AND `|diffX| > 180px`.
- Right-to-left swipe starting from the **right half** of the screen → next chapter (`reader.post({ type: 'next' })`).
- Left-to-right swipe starting from the **left half** → previous chapter (`reader.post({ type: 'prev' })`).

Scrollbar drags (`e.target.id startsWith 'scrollbar'`) and image-modal taps (`Image-Modal-img`) are exempt.

## 5. Keyboard navigation

Added in upstream `3962a151`. Active on **all** platforms (was added
because WSA and DeX are keyboard-driven, but is harmless on phone).

Skipped if the event target is `INPUT`, `TEXTAREA`, `SELECT`, or
`isContentEditable === true`. Skipped if any of `ctrlKey`, `metaKey`,
`altKey` is held.

Paged mode:

- `PageDown`, `ArrowRight`, `Space`, `Spacebar` → next page
- `PageUp`, `ArrowLeft` → previous page

Scroll mode:

- `PageDown`, `ArrowDown`, `Space`, `Spacebar` → scroll down `0.75 * layoutHeight`
- `PageUp`, `ArrowUp` → scroll up `0.75 * layoutHeight`

All matched keys call `e.preventDefault()`.

## 6. Page count math

```
totalPages = floor(
  (chapterWidth + readerSettings.padding * 2) / layoutWidth
)
```

Triggered:

- Initial mount, after `document.fonts.ready` and a `requestAnimationFrame + setTimeout(0)` to let the column layout settle.
- ResizeObserver on `chapterElement`.
- `pageReader` flips from `false → true`.
- Window resize (debounced 150 ms).

## 7. Page-to-progress mapping

Saving progress (paged mode):

```
progress = floor(((page + 1) / totalPages) * 100)
```

Persisted only when `progress > previously-saved progress` — never
goes backwards.

Saving progress (scroll mode):

```
progress = floor(((scrollY + layoutHeight) / chapterHeight) * 100)
```

Persisted on `scrollend` (modern browsers; a polyfill is shipped at
`assets/js/polyfill-onscrollend.js`).

## 8. Chapter-end transition (paged mode)

Element: `.transition-chapter`, controlled by `pageReader`. The
prev/next chapter title slides into view from off-screen using
`transform: translateX(-100vw)` baseline:

- Forward to next: at last page, set transition's text to
  `nextChapter.name`, animate `0 → -100vw`, then post `{type:'next'}`.
- Backward to prev: at page `< 0`, animate `0 → -200vw` first, then post `{type:'prev'}` after 200 ms.
- The transition is dismissable with a tap that maps to a backward page move (returns the user to the chapter without crossing).

## 9. Reader settings (rendered as CSS custom properties)

`van.derive` on `readerSettings` rewrites these on every change:

| CSS variable | From `readerSettings.*` | Effect |
|---|---|---|
| `--readerSettings-theme` | `theme` (color) | Background |
| `--readerSettings-padding` | `padding` + `'px'` | Body padding |
| `--readerSettings-textSize` | `textSize` + `'px'` | Body font size |
| `--readerSettings-textColor` | `textColor` | Body color |
| `--readerSettings-textAlign` | `textAlign` (`left`/`right`/`center`/`justify`) | Body alignment |
| `--readerSettings-lineHeight` | `lineHeight` (number) | Body line height |
| `--readerSettings-fontFamily` | `fontFamily` (string id) | Body font family |

When `fontFamily` is set, the JS loads
`file:///android_asset/fonts/<fontFamily>.ttf` via `FontFace` and
adds it to `document.fonts`. When `fontFamily` is empty all currently
loaded `FontFace` entries are deleted to fall back to system / declared
font. (The new app needs to ship the same font files in
`assets/reader-fonts/` and load them via a `@font-face` injection.)

## 10. Bionic reading + paragraph spacing

`van.derive` on `chapterGeneralSettings` rewrites
`chapterElement.innerHTML` from the captured `rawHTML`:

1. If `bionicReading` is on, run the chapter HTML through
   `textVide.textVide(rawHTML)` (the `text-vide` JS shipped in
   `assets/js/text-vibe.js`).
2. If `removeExtraParagraphSpacing` is on, three regex passes remove
   `&nbsp;` / `​`, collapse runs of `<br>` to at most two, and
   strip `<br><br>` adjacent to `<p>` boundaries. (The exact regex
   chain is in upstream `core.js` lines 853–874 — copy verbatim, it
   was tuned against many sites.)

## 11. Fullscreen / system bars

Implemented in `src/hooks/common/useFullscreenMode.ts`. Reader entry:

- If `chapterGeneralSettings.fullScreenMode` is on, hide both the
  React Native `StatusBar` and `react-native-edge-to-edge`'s
  `SystemBars`.
- Otherwise, set the status bar color to the reader background and
  reset the navigation bar color via `expo-navigation-bar` /
  `setBarColor` helpers.

Reader exit (`navigation.addListener('beforeRemove', ...)`):

- Show status bar.
- `NavigationBar.setVisibilityAsync('visible')`.
- Restore the app theme bar colors.

The new app needs the equivalent: in fullscreen, hide the WebView host
window's chrome (Tauri `WindowExt::set_decorations(false)` on desktop;
`SystemBars`-equivalent plugin call on mobile). Reader exit restores.

## 12. Persistence keys

| Setting object | MMKV key | Type | Defaults source |
|---|---|---|---|
| App settings | `APP_SETTINGS` | `AppSettings` | `useSettings.ts:151–191` |
| Browse settings | `BROWSE_SETTINGS` | `BrowseSettings` | `useSettings.ts:193–197` |
| Library settings | `LIBRARY_SETTINGS` | `LibrarySettings` | `useSettings.ts:267–276` |
| Chapter general (per-reader) | `CHAPTER_GENERAL_SETTINGS` | `ChapterGeneralSettings` | `useSettings.ts:199–216` |
| Chapter reader (typography) | `CHAPTER_READER_SETTINGS` | `ChapterReaderSettings` | `useSettings.ts:218–239` |

Per-novel reader overrides (font, padding, etc.) live in
`src/hooks/persisted/useNovelSettings.ts` and key on novel ID.

## 13. Auto-save interval

`autoSaveInterval` ships in the initial reader config. Upstream uses
this as the throttle for `progress` save messages. The new app should
honor it for the scroll-mode `scrollend` saver too.

## 14. Battery & time HUD

If `chapterGeneralSettings.showBatteryAndTime` is on, the WebView
displays a small HUD with `batteryLevel` (provided in the initial
config) and `new Date().toLocaleTimeString()`. The native side updates
`batteryLevel` periodically via `expo-battery` equivalents — Tauri's
`battery2` Rust crate or `tauri-plugin-device-info` covers this.

## 15. Auto-scroll

If `chapterGeneralSettings.autoScroll` is on (scroll mode only),
`window.scrollBy(0, autoScrollOffset || 1)` runs on
`autoScrollInterval` (seconds). Pause on tap, resume on next tap.

## 16. EPUB rendering

EPUB chapters are rendered via the same WebView with a different
template. Settings:

- `epubLocation` — last-known scroll/page position, opaque string.
- `epubUseAppTheme` / `epubUseCustomCSS` / `epubUseCustomJS` — mirror the equivalent HTML reader settings.

In the new app, EPUB content can be parsed in Rust via `rbook` and
streamed into a `<iframe>` per spine entry, which preserves CSS
isolation while remaining in-process.

## 17. Things explicitly cut from the rewrite

Per `prd.md §3`, the new app **does not** ship:

- TTS engine usage (`tts` namespace in `core.js`, `expo-speech`).
- TTS lockscreen media controls (`NativeTTSMediaControl`).
- Volume-button page turn (`useVolumeButtons`, `volumeButtonsOffset`,
  `NativeVolumeButtonListener`).

When porting `core.js`, the entire `window.tts = new (function () {…})()`
block (upstream lines 149–487 plus the stop-on-disable derive at
489–496) is dropped. Persisted reader-settings shape keeps the `tts`
sub-object only for backup compatibility — values are read for
restore but never acted on.

## 18. Reader chrome (React side)

These RN components are the chrome that surrounds the WebView. When
porting, replace each with the equivalent Mantine/shadcn component:

| Upstream component | Role | Tauri-side approach |
|---|---|---|
| `ReaderAppbar.tsx` | Top bar with chapter title, back, jump-to-chapter | Standard appbar component, slide-in on chrome toggle |
| `ReaderFooter.tsx` (renamed `ChapterFooter`) | Bottom bar with prev/next/chapter-list/settings/source | Same; uses `useWindowDimensions().height` for animation targets (upstream `3962a151`) |
| `ReaderBottomSheet/` | Settings drawer | Mantine `Drawer` with `position="bottom"` |
| `ChapterDrawer/` | Side drawer with chapter list | Mantine `Drawer` with `position="left"` |
| `KeepScreenAwake.tsx` | `expo-keep-awake` wrapper | `tauri-plugin-prevent-default` or platform wake-lock crate |
| `WebViewReader.tsx` | Hosts the WebView and message bridge | In Tauri the *whole app* is a WebView; this becomes a regular React route. The `core.js` logic ports to a React effect inside that route. |
| `SkeletonLines.tsx` | Loading state | Same; replace `react-native-shimmer-placeholder` with a CSS-only skeleton |

## 19. Reader → host messages

Upstream message types (posted via
`window.ReactNativeWebView.postMessage(JSON.stringify({type, ...}))`):

| `type` | Payload | Action on host |
|---|---|---|
| `hide` | — | Toggle reader chrome visibility |
| `next` | `autoStartTTS?` | Navigate to next chapter |
| `prev` | — | Navigate to previous chapter |
| `save` | `data: number` (0–100 progress) | Persist chapter progress |
| `console` | `msg: string` | Forward to host logger (DEBUG only) |
| `speak` / `pause-speak` / `stop-speak` / `tts-state` / `tts-queue` | TTS-related | **Drop in rewrite** |

Tauri equivalent: an `invoke('reader:event', payload)` IPC channel.
The whole reader runs in the same renderer, so this can be a direct
function call instead of a serialized message — simpler and faster.

## 20. References

- Upstream `core.js`: <https://github.com/lnreader/lnreader/blob/639a2538/android/app/src/main/assets/js/core.js>
- Reader components: <https://github.com/lnreader/lnreader/tree/639a2538/src/screens/reader>
- Reactive viewport regression fix that informs §2: <https://github.com/lnreader/lnreader/commit/3962a151>
