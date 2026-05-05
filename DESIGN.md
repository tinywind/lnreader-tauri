# LNReaderTauri Design Contract

This file is the repo-local design contract for agent work. It captures the visual direction from the Claude Design export in `C:\Users\tinywind\Downloads\design` so implementation, review, and future sub-agent work share the same source of truth.

## Source Materials

- `direction-b.jsx`: selected product direction.
- `responsive.jsx`: shell and settings responsive behavior.
- `global-search.jsx`: Browse global search scope and result filtering.
- `history.jsx`: History behavior and row contract.
- `shared.jsx`: shared sample assets and icon language.

## Chosen Direction

Use Direction B, "Console": quiet utility, dense reading workflows, neutral surfaces, narrow navigation, and moss accent. LNReaderTauri is an operational reader, not a marketing site. The interface should optimize scanning, comparison, continuation, source troubleshooting, and repeated daily use.

## Tokens

- Background: `#fbfbfa`.
- Surface: `#ffffff`.
- Panel: `#f4f4f2`.
- Primary text: `#1a1a18`.
- Secondary text: `#4a4a47`.
- Muted text: `#8a8a85`.
- Rule: `#e8e8e4`.
- Strong rule: `#d4d4ce`.
- Accent: `#3d6e58`.
- Accent soft: `rgba(61,110,88,0.10)`.
- Error: `#b23b3b`.
- Warning: `#9a6a1a`.
- Success: `#3d7a4d`.
- Radius: 4 to 6 px for product surfaces and controls.
- Typography: Inter or system sans for UI, Source Serif or Georgia for page titles, JetBrains Mono or UI monospace for metadata.

## Layout Rules

- Expanded desktop uses a left navigation rail plus content that fills the available height.
- Tablet and freeform desktop windows keep the rail compact and reduce secondary panel width before changing core content.
- Compact mobile uses bottom navigation, stacked content, and no nested cards.
- Repeated lists must use stable row grids or stable card dimensions so badges, buttons, and long titles do not resize the layout.
- Avoid decorative hero sections, gradient backgrounds, floating cards, or cards inside cards.
- Page content must not stop at a wrapper shell; each route needs its actual content layout adapted to this contract.

## Screen Contracts

### Library

- Use a category subpanel on wide screens and compact category controls on narrow screens.
- Main content should default to a dense "currently reading" list/table with cover, title, author/source, progress, unread count, updated time, and actions.
- Preserve grid/list view behavior when already supported, but the list view must be first-class and more useful than a plain card grid.
- Include a status strip with library count, unread count, current sort, and sync/update hint when data is available.

### Browse

- Global search lives inside `/browse`; do not create a separate route just for the search design.
- Search scope is chosen before fan-out: all, pinned, or selected sources, plus language and recent-source chips when data exists.
- Result filters happen after search: with results, hide empty, failures/Cloudflare, sort, and retry failed.
- One plugin/source equals one result row with source name, pinned/language/status, count, action, and a preview strip when results exist.
- Failed or Cloudflare rows show retry/open WebView affordances and inline diagnostic text.

### History

- History is one latest row per novel, sorted by most recent read time.
- Row body opens novel details. Continue opens the next available chapter, or the last-read chapter when no next chapter exists.
- Details opens the novel page. Remove clears history for that novel only.
- Rows include cover, title, status dot and label, last chapter, progress, percent, timestamp, and next-chapter hint when available.

### Updates

- Updates should feel like a work queue, not a generic list. Surface per-source update state, changed novels, chapter deltas, failures, and retry actions.
- Use dense rows with source/status metadata and a summary/status strip.
- Preserve refresh behavior and empty/error states.

### Novel Detail

- The novel page is a task surface: cover, title, author/source/status metadata, library and read actions, progress, and chapter list are all first-viewport information.
- Chapter rows should be dense and scannable with read/download/current indicators and stable action placement.
- Do not turn the page into a decorative hero that hides the chapter list.

### Reader

- Reader uses a thin top chrome, optional chapter side panel on wide screens, centered content column, and bottom progress/status strip.
- Keep body text readable, but reader metadata and controls should follow the console density.
- Preserve current reader settings, chapter navigation, and content rendering behavior.

### Settings

- Use category list-detail layout on tablet and desktop.
- Compact mobile shows a category list and drills into a category detail.
- Categories should cover App, Reader, Library, Browse, Data, and About when the controls exist.
- Settings rows use a consistent label, description, and control alignment.

## Evaluation Contract

Every design pass is incomplete until it satisfies these checks:

- Fidelity: core route content matches the selected Direction B density, typography, palette, and interaction model.
- Behavior: existing data fetching, navigation, mutations, and Tauri guards still work.
- Responsiveness: desktop, tablet/freeform, and compact mobile do not overlap, crop controls, or hide core actions.
- Accessibility: interactive controls have accessible labels where icon-only; focus order follows the visible workflow.
- Real data: no hardcoded mock content in route implementations unless it was already existing sample/demo state.
- Verification: run type check, tests, build, and a browser visual smoke pass after implementation.
