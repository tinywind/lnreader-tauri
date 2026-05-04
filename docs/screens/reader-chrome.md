# Reader Chrome

> Sourced from upstream lnreader at commit 639a2538:
> - `src/screens/reader/ReaderScreen.tsx` (1-159)
> - `src/screens/reader/ChapterContext.tsx` (1-46)
> - `src/screens/reader/ChapterLoadingScreen/ChapterLoadingScreen.tsx` (1-44)
> - `src/screens/reader/components/ReaderAppbar.tsx` (1-151)
> - `src/screens/reader/components/ReaderFooter.tsx` (1-201)
> - `src/screens/reader/components/ReaderBottomSheet/ReaderBottomSheet.tsx` (1-220)
> - `src/screens/reader/components/ChapterDrawer/index.tsx` (1-266)
> - `src/screens/reader/components/KeepScreenAwake.tsx` (1-10)
> - `src/screens/reader/components/SkeletonLines.tsx` (1-159)
> - `src/screens/reader/components/WebViewReader.tsx` (66-549, chrome-relevant slice only)
> - `src/screens/reader/hooks/useChapter.ts` (52-380, chrome-relevant slice only)
> - `src/hooks/common/useFullscreenMode.ts` (1-81)
> - `src/screens/novel/NovelContext.tsx` (38-62, for `statusBarHeight` / `navigationBarHeight`)

> Reader **content** behavior (paged/scroll modes, click zones, page math, settings) lives
> in [reader specification](../reader/specification.md). This doc covers only the chrome
> that wraps the WebView.

## 1. Purpose

The reader chrome is the React-side UI that surrounds the WebView while a chapter is open:
top appbar, bottom footer, left chapter drawer, settings bottom sheet, the loading skeleton
shown before chapter HTML is ready, and the screen-awake side effect. It does not render
chapter text — that is delegated to the WebView (see the reader spec).

The chrome is a **single overlay layer** that hides and shows in unison. Tapping the centre
of the WebView posts a `hide` message; the React layer flips a `hidden` flag and animates
appbar/footer in or out. While hidden, the WebView fills the entire screen and the system
status/navigation bars are hidden (when `fullScreenMode` is on).

## 2. Routes / Entry points

`ReaderStack -> ReaderScreen` with route params `{ novel, chapter }` (`ChapterScreenProps`,
upstream `src/navigators/types.ts`). Entered from any chapter list (novel screen, library
last-read, history, drawer, search results). Exited via the appbar back button or hardware
back; `useFullscreenMode` re-shows system bars on `beforeRemove`.

## 3. Layout

```
+------------------------------------------------+
| status bar (hidden in fullscreen)              |
+------------------------------------------------+
| ReaderAppbar (absolute, top:0, zIndex:1)       |  <- slides down/up
|  back  |  novel.name / chapter.name  | bookmark|
+------------------------------------------------+
|                                                |
|                                                |
|         WebView (fills full <View>)            |
|         OR ChapterLoadingScreen if loading     |
|                                                |
|                                                |
+------------------------------------------------+
| ReaderFooter (absolute, bottom:0, zIndex:1)    |  <- slides up/down
|  prev  | source(earth)  | top | drawer | cog | next |
+------------------------------------------------+
| navigation bar (hidden in fullscreen)          |
+------------------------------------------------+

Overlays (not in normal stacking flow):
- ChapterDrawer:        Drawer position="left"  (react-native-drawer-layout)
- ReaderBottomSheetV2:  modal sheet from bottom (@gorhom/bottom-sheet)
- TTS notification:     OS-level
- Image modal:          handled inside the WebView (out of scope here)
```

The outer wrapper applies `paddingStart: left` / `paddingEnd: right` from
`useSafeAreaInsets()` so left/right notches don't clip content
(`ReaderScreen.tsx:124-126`).

## 4. Major UI components

| Component | Role | Upstream file:lines |
|---|---|---|
| `Chapter` | Top-level: wraps everything in `ChapterContextProvider` and the left `Drawer` | `ReaderScreen.tsx:22-56` |
| `ChapterContent` | Body: hosts loading screen / WebView, bottom sheet, appbar+footer; renders `ErrorScreenV2` on error | `ReaderScreen.tsx:62-152` |
| `ChapterContextProvider` | Hosts `webViewRef`, `useChapter` state, `novel`, exposed via `useChapterContext` | `ChapterContext.tsx:15-41` |
| `ReaderAppbar` | Top bar: back, novel + chapter title, bookmark toggle | `components/ReaderAppbar.tsx:26-121` |
| `ReaderFooter` (filename `ReaderFooter.tsx`, exported as `ChapterFooter`) | Bottom bar: prev / source / scroll-to-top / drawer / settings / next | `components/ReaderFooter.tsx:25-180` |
| `ReaderBottomSheetV2` | Settings sheet with three tabs: Reader, General, TTS | `components/ReaderBottomSheet/ReaderBottomSheet.tsx:137-198` |
| `ChapterDrawer` | Left drawer: virtualised chapter list with scroll-to-current button | `components/ChapterDrawer/index.tsx:31-210` |
| `ChapterLoadingScreen` | Background-tinted skeleton lines while chapter HTML loads | `ChapterLoadingScreen/ChapterLoadingScreen.tsx:8-41` |
| `SkeletonLines` | Generic shimmer placeholder used by the loading screen | `components/SkeletonLines.tsx:7-106` |
| `KeepScreenAwake` | Renders `null`, calls `useKeepAwake()` from `expo-keep-awake` | `components/KeepScreenAwake.tsx:1-9` |
| `WebViewReader` | Chrome-side: positions WebView, dispatches `hide`/`save`/`next`/`prev` messages | `components/WebViewReader.tsx:66-549` |
| `useChapter` | Owns `hidden` / `loading` / `error` / `chapter` / adjacent chapters / `hideHeader` | `hooks/useChapter.ts:41-380` |
| `useFullscreenMode` | Coordinates status + navigation bar visibility based on `fullScreenMode` and `hidden` | `hooks/common/useFullscreenMode.ts:17-78` |

## 5. States

State lives on `useChapter` and is exposed through `useChapterContext` (`ChapterContext.tsx:6-9`).

| State | Source | Behavior |
|---|---|---|
| `loading: true` | initial mount + `refetch()` | Render `ChapterLoadingScreen` (skeleton lines on theme background); WebView is not mounted |
| `loading: false`, content visible | after `getChapter()` resolves | Render `<WebViewReader />` |
| `error: string` | thrown inside `getChapter()` / `loadChapterText()` | Render `ErrorScreenV2` with Retry + open-in-WebView actions; chrome bypassed (`ReaderScreen.tsx:99-122`) |
| `hidden: true` (default) | `useChapter.ts:52` | Appbar + footer not rendered; system bars hidden if `fullScreenMode`; WebView shows full-screen |
| `hidden: false` | `hideHeader()` toggle | Appbar + footer mount with their entering animation; status / nav bars re-shown |
| Drawer open | local `open` state in `Chapter` | `react-native-drawer-layout` slides chapter list from the left; hardware back closes it (`ReaderScreen.tsx:25-31`) |
| Settings sheet open | `readerSheetRef.current?.present()` | `@gorhom/bottom-sheet` modal at snap points `[360, 600]` (`ReaderBottomSheet.tsx:175`) |
| Image modal open | inside WebView | Not React-side state; handled by in-WebView JS — see reader spec |
| Chapter-end transition | WebView posts `next`/`prev` | `nextChapterScreenVisible` ref flips so the in-WebView `.transition-chapter` element slides; React re-renders WebView with new `chapter` |

## 6. Interactions

| Trigger | Effect | Implementation |
|---|---|---|
| Tap centre of WebView | Toggle chrome visibility | In-WebView click zones post `{type:'hide'}`; `WebViewReader.onMessage` calls the prop `onPress`, which is `hideHeader` (`ReaderScreen.tsx:131`, `WebViewReader.tsx:370-372`). `hideHeader` flips `hidden`, posts `reader.hidden.val = ...` back into the WebView, and calls `setImmersiveMode()` or `showStatusAndNavBar()` (`useChapter.ts:283-292`). |
| Appbar back | Exit reader | `IconButton` -> `navigation.goBack` (`ReaderAppbar.tsx:87-93`). `useFullscreenMode` `beforeRemove` listener restores system bars (`useFullscreenMode.ts:66-75`). |
| Bookmark toggle | Persist + flip icon | `bookmarkChapter(chapter.id)` then `setBookmarked(!bookmarked)` (`ReaderAppbar.tsx:108-117`). |
| Footer prev / next | Navigate chapter | `navigateChapter('PREV' \| 'NEXT')` from `useChapter.ts:294-317`; loads the adjacent chapter via `getChapter(nextNavChapter)` and toasts `noNextChapter` / `noPreviousChapter` if at the boundary. Disabled icon if `prevChapter` / `nextChapter` is missing (`ReaderFooter.tsx:111, 171`). |
| Footer source (earth icon) | Open original webview | `navigation.navigate('WebviewScreen', {name, url, pluginId})` (`ReaderFooter.tsx:119-128`). Hidden for `novel.isLocal` (`ReaderFooter.tsx:115`). |
| Footer scroll-to-top | Reset position | Calls `scrollToStart` from `ChapterContent` which injects either `window.scrollTo({top:0, ...})` (scroll mode) or resets `data-page` + transform (paged mode) (`ReaderScreen.tsx:80-92`). |
| Footer drawer icon | Open chapter list | `openDrawer()` -> `setOpen(true)` and also calls `hideHeader()` to retract the chrome behind the drawer (`ReaderScreen.tsx:94-97`). |
| Footer cog icon | Open settings sheet | `readerSheetRef.current?.present()` (`ReaderFooter.tsx:155`). |
| Long-press image | Image modal | Handled in-WebView; chrome takes no action. See reader spec section on image handling. |
| Swipe to next/prev chapter | Navigate chapter | Initiated inside the WebView based on `swipeGestures` setting; surfaces in chrome via the `next`/`prev` messages handled by `WebViewReader.tsx:373-385`. See reader spec section 4. |
| Hardware back, drawer open | Close drawer (consume back) | `useBackHandler` returns `true` and clears `open` (`ReaderScreen.tsx:25-31`). |

## 7. Affecting settings

Reader chrome reads these settings via `useChapterGeneralSettings()` and
`useChapterReaderSettings()` (`@hooks/persisted/useSettings`):

| Setting | Used by | Effect |
|---|---|---|
| `ChapterGeneralSettings.fullScreenMode` | `useFullscreenMode.ts` | When `true`, `setImmersiveMode()` hides system bars; when `false`, only colors are tinted |
| `ChapterGeneralSettings.keepScreenOn` | `ReaderScreen.tsx:127` | Renders `<KeepScreenAwake />` (`expo-keep-awake`) |
| `ChapterGeneralSettings.pageReader` | `ReaderScreen.tsx:80-92` | Picks `scrollToStart` injection branch |
| `ChapterGeneralSettings.verticalSeekbar` / `showScrollPercentage` / `showBatteryAndTime` / `swipeGestures` / `tapToScroll` / `useVolumeButtons` / `bionicReading` / `autoScroll` / `removeExtraParagraphSpacing` | All flow through to the WebView (read by in-WebView JS); chrome only exposes them as toggles in the General tab | `ReaderBottomSheet.tsx:83-99` |
| `ChapterReaderSettings.theme` | `ChapterLoadingScreen`, `WebViewReader` style | Background color of skeleton + WebView container |
| `ChapterReaderSettings.padding`, `textSize`, `lineHeight`, `textColor`, `textAlign`, `fontFamily`, `customCSS`, `customJS` | Skeleton spacing, in-WebView CSS variables | `ChapterLoadingScreen.tsx:9-14`, `WebViewReader.tsx:460-495` |
| `AppSettings.disableLoadingAnimations` | `SkeletonLines.tsx:26` | Stops shimmer auto-run when set |

The Reader tab in the bottom sheet exposes `TextSizeSlider`, `ReaderThemeSelector`,
`ReaderTextAlignSelector`, line-height and padding sliders, and `ReaderFontPicker`
(`ReaderBottomSheet.tsx:48-70`). The TTS tab is rendered by `TTSTab`.

## 8. Data this screen reads / writes

Reads:
- `useChapterContext()`: `novel`, `chapter`, `chapterText`, `loading`, `error`, `hidden`,
  `nextChapter`, `prevChapter`, `webViewRef`, `hideHeader`, `navigateChapter`,
  `saveProgress`, `setLoading`, `getChapter`, `refetch` (`ChapterContext.tsx:6-9`,
  `useChapter.ts:344-379`).
- `useNovelContext()`: `chapters`, `pages`, `novelSettings`, `batchInformation`,
  `getNextChapterBatch`, `setPageIndex`, `setLastRead`, `markChapterRead`,
  `updateChapterProgress`, `chapterTextCache`, `statusBarHeight`, `navigationBarHeight`
  (`NovelContext.tsx:9-13, 54-62`).
- Settings: `useChapterGeneralSettings`, `useChapterReaderSettings`, `useAppSettings`,
  `useLibrarySettings` (incognito).
- Theme: `useTheme()` (Material 3 colors).
- Insets: `useSafeAreaInsets()`.

Writes (via `useChapter`):
- Chapter progress on every WebView `save` message (`useChapter.ts:262-281`,
  `WebViewReader.tsx:386-390`). When `>= 97` -> `markChapterRead` and tracker update.
- Bookmark on appbar tap (`bookmarkChapter` in `ReaderAppbar.tsx:111-113`).
- History row on chapter mount, plus on unmount (`useChapter.ts:319-330`); skipped under
  `incognitoMode`.
- TTS playback state via the TTS notification module (`WebViewReader.tsx:172-188`,
  `392-443`); incidental to chrome but lives in the same component.

## 9. Edge cases / gotchas

- **Footer animation must use the live viewport height.** `ReaderFooter` uses
  `useWindowDimensions().height` and computes target `originY = screenHeight -
  navigationBarHeight - 64` (`ReaderFooter.tsx:44-83`). Upstream commit `3962a151`
  fixed a bug where the captured `SCREEN_HEIGHT` constant from `@gorhom/bottom-sheet`
  is set at module load and does not update across rotation, WSA window resize,
  foldables, or split-screen — the footer would slide to the wrong Y. The Tauri port
  must use the equivalent reactive viewport (e.g. `window.innerHeight` via a resize
  listener or `useElementSize`).
- **Appbar animation is symmetric to the status bar.** Entering/exiting animate
  `originY` between `0` and `-statusBarHeight`, opacity 0..1 over 250 ms with
  `Easing.bezier(0.4, 0, 0.2, 1)` (`ReaderAppbar.tsx:35-72`). `statusBarHeight` is the
  cached `top` inset from `NovelContext` (`NovelContext.tsx:38-53`).
- **Fullscreen entry/exit is split between two callbacks.** `setImmersiveMode` hides
  bars only when `fullScreenMode` is on, otherwise just tints them. `showStatusAndNavBar`
  always shows them but still tints with `Color(theme.surface).alpha(0.01).hexa()` —
  a near-transparent navigation bar overlay so the footer can extend over it without
  visible color seams (`useFullscreenMode.ts:23-56`). The `0.01` alpha is intentional
  because some Android themes treat fully transparent (`#xxxxxx00`) as a different color.
- **`beforeRemove` always restores bars.** Even if the user exits while in immersive
  mode, system bars come back and re-tint to the app surface
  (`useFullscreenMode.ts:66-75`).
- **Chapter loading skeleton uses an aware background.** Light themes darken by 4 %,
  dark themes lighten by 10 %, with a fallback for pure-black themes that negates and
  darkens by 98 % (`ChapterLoadingScreen.tsx:22-35`). Shimmer can be disabled globally
  via `disableLoadingAnimations`.
- **Chapter-end transition is in-WebView.** The `.transition-chapter` element is
  absolutely positioned and its `transform` flips between `translateX(0)` and
  `translateX(-100%)` based on `nextChapterScreenVisible.current`
  (`WebViewReader.tsx:499-504`). React only sets the initial value when re-rendering
  after `next`/`prev`.
- **Drawer open also retracts chrome.** `openDrawerI` calls both `openDrawer()` and
  `hideHeader()` so the chrome doesn't stay visible behind the drawer
  (`ReaderScreen.tsx:94-97`).
- **Source button hidden for local novels.** `!novel.isLocal` gate at
  `ReaderFooter.tsx:115`.
- **`refetch()` re-runs chapter load on error.** `setLoading(true)` and clear
  `error` before re-running `getChapter` (`useChapter.ts:338-342`); the error screen
  shows Retry + "open in WebView" actions.
- **TTS lives inside the WebView component.** Although TTS controls + media
  notification are mounted from `WebViewReader`, the chrome itself only carries the
  TTS tab in the settings sheet. Chrome-show/hide does not stop TTS.
- **Image modal is also in the WebView.** Long-press image and the resulting modal
  are rendered by the in-WebView reader UI; the React layer does not need a dedicated
  component for it.
- **Volume-button scroll re-binds across chapter changes.** `useChapter.ts:90-104`
  removes and re-adds listeners on every chapter change because `chapter` is a
  dependency.

## 10. Tauri-side notes

- The whole app is one WebView — no nested WebView is needed; the reader becomes a
  regular React route. The chrome becomes overlay components on top of an iframe / Shadow
  DOM that hosts the upstream reader JS, OR the upstream reader JS is ported directly
  into the same WebView. Either way, the React chrome layer is the same.
- **Layout shell:** Mantine `AppShell` with collapsible `header` and `footer` sections,
  or a simple `position: fixed` overlay pattern controlled by Framer Motion. The
  upstream `Animated.View entering/exiting` pattern is best replicated with Framer
  Motion `AnimatePresence` + `motion.div` (slide + fade, 250 ms `cubic-bezier(0.4, 0,
  0.2, 1)` for transform, 150 ms linear for opacity).
- **Drawer:** Mantine `Drawer position="left"` for the chapter list. Hardware-back
  equivalent on desktop is `Escape` and on mobile-web / Tauri-mobile use the system
  back gesture; both should close the drawer first.
- **Settings sheet:** Mantine `Drawer position="bottom"` (or a custom modal) with two
  snap heights matching the upstream `[360, 600]`. Tabs ("Reader", "General", "TTS")
  via Mantine `Tabs`.
- **Fullscreen:** desktop -> `tauri-plugin-os` window decorations + `setFullscreen`;
  mobile-web -> Fullscreen API on a chosen element. The split between
  `setImmersiveMode` and `showStatusAndNavBar` maps to `enter` / `exit` calls plus a
  `beforeunload` / route-leave guard that always exits fullscreen. On Tauri mobile use
  the equivalent of `SystemBars.setHidden`.
- **Keep awake:** desktop -> `@tauri-apps/plugin-os` or wake-lock plugin; mobile-web
  Tauri -> `navigator.wakeLock.request('screen')` mounted while `keepScreenOn` is on.
  The upstream component is a no-render side-effect (`KeepScreenAwake.tsx`) — keep
  the same shape.
- **Animations:** Framer Motion timeline matching upstream:
  `appbar.enter = { y: [-statusBarHeight, 0], opacity: [0, 1] }, duration 0.25s`
  `footer.enter = { y: [screenHeight - 64, screenHeight - navBarH - 64], opacity:[0,1] }, duration 0.25s`
  Use `useViewportSize` (Mantine) or a window resize hook so `screenHeight` is
  reactive. **Do not** capture the value once at mount — that re-introduces the
  `3962a151` bug.
- **Skeleton:** `SkeletonLines` -> Mantine `Skeleton` with custom width per row.
  Random long/short distribution can stay; the shimmer pause toggle maps to the
  `disableLoadingAnimations` setting.
- **Error screen:** map `ErrorScreenV2` to a generic `<ErrorState />` with two action
  buttons (Retry, Open in browser).
- **Bookmark icon:** Mantine `ActionIcon` with `IconBookmark` / `IconBookmarkFilled`.
- **Image modal:** out of scope for chrome (handled in-WebView per reader spec).
- **TTS notification:** UNKNOWN — the upstream uses an Android `MediaSession`-style
  notification (`@utils/ttsNotification`); on Tauri this needs `tauri-plugin-os`
  notifications + manual play / pause UI inside the chrome. Defer until TTS is wired.

## 11. References

- Reader content behavior: [reader specification](../reader/specification.md)
- Upstream commit pinned for this doc: `639a2538`
- Upstream commit that fixed the footer-height bug called out in section 9:
  `3962a151 feat(reader): reactive viewport layout + keyboard navigation`
- Settings shapes: `src/hooks/persisted/useSettings.ts` (`ChapterGeneralSettings`,
  `ChapterReaderSettings`)
- Navigation types: `src/navigators/types.ts` (`ReaderStackParamList`,
  `ChapterScreenProps`)
- Outer novel context (provides `statusBarHeight`, `navigationBarHeight`,
  `chapterTextCache`, chapter list batching): `src/screens/novel/NovelContext.tsx`
