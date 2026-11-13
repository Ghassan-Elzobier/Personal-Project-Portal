---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**/*.tsx"
  - "src/app/globals.css"
---

# UI rules

- Build from the design system: tokens in `src/app/globals.css`, components in
  `src/components/ui.tsx` and `src/app/life/parts.tsx`, all shown at `/design`.
  For anything new, follow the `/design` skill. Never a raw hex colour, a
  one-off pixel font size or a raw grey for text (use the text roles `bright`,
  `body`, `muted`, `faint`): the linter rejects them.
- Phone first. The owner uses a Pixel 7 (412 px); every page must also hold at
  360 px. A responsive grid needs `grid-cols-1` before `md:grid-cols-*`, and
  columns use `minmax(0,1fr)`: a grid with only responsive columns grows its
  implicit column to min-content and pushes the page sideways. Edge-to-edge bands
  on phones use `-mx-5 px-5`.
- Fresh pages over speed. Never copy props into `useState` without a `key` tied
  to the data; derive the value instead. No `staleTimes`, `prefetch={true}`,
  `loading.tsx` or `<Suspense>` on pages that save: server renders take 35 to 80
  ms and the global loading bar (`src/components/navigation-progress.tsx`) covers
  the wait. Call `startNavigation()` before any `router.push`.
- Work and Life look different on purpose: Work is the night palette (navy,
  storm, royal), Life is greens (moss, pine, fern, mint). Mentors only ever see Work.
- Buttons say what they do; a busy one sets `aria-busy`. Errors use `ErrorNote`
  and say what to do next. Empty states use `Empty` and point somewhere useful.
- A component used twice becomes shared and appears on `/design`.
