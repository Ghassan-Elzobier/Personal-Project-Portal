---
name: design
description: Build or change UI in the portal so it stays one cohesive design - pages, components, layout, colour, type, phone layout. Use whenever a change touches what the owner sees.
argument-hint: "[the screen or component]"
---

# Design within the system

Target: $ARGUMENTS

The design system is code: tokens in `src/app/globals.css` (`@theme` and the
`@utility` classes), components in `src/components/ui.tsx` and
`src/app/life/parts.tsx`, all of it shown at `/design`. `docs/DESIGN.md` explains
the choices. Cohesion comes from reuse, so start there, not from a blank file.

1. **Look first.** Open `/design` (or read `src/app/design/page.tsx`) and the
   nearest existing page that does something similar. Match its structure:
   `PageHeader` or `LifeHeader`, `SectionTitle`, cards, the button hierarchy.
2. **Use tokens only.** Colours from the palette (`aqua`, `mint`, `coral`,
   `lilac`, ...), Work surfaces in navy and storm, Life surfaces in moss, pine and
   fern. Type from the existing classes. The linter rejects raw hex and one-off
   pixel sizes; if the scale truly lacks a step, add a token to `@theme` and say
   why in the PR.
3. **Phone first.** Design for 412 px, then check 360 px and desktop. Grids get
   `grid-cols-1` before any `md:grid-cols-*`, columns use `minmax(0,1fr)`, long
   words wrap, tap targets are at least 44 px (`tap`), and nothing may cross the
   main column (the end-to-end suite checks).
4. **States.** Every view has its empty, loading-by-tap (`aria-busy`), error
   (`ErrorNote`) and full states. Data changes show at once: key client state to
   its data, never copy props into state.
5. **Accessible.** Real buttons and links, labels on fields, colour backed by a
   word, contrast at WCAG AA (axe runs in the suite).
6. **Promote what repeats.** The second time a pattern appears, make it a shared
   component in `src/components/`, replace both uses, and add it to `/design` in
   its states. That is how the design stays one design.
7. **Prove it.** `npm run test:e2e`. Intended visual changes: `npm run test:e2e:update`,
   then read each changed screenshot before committing. Unintended ones are bugs.
