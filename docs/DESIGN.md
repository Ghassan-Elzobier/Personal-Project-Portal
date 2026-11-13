# Design system

Everything the portal looks like comes from a small set of tokens and shared
components, shown together at `/design`. This file says why they are the way
they are; the code is the source of truth.

## Principles

1. **Phone first.** The owner uses the portal on a Pixel 7, mid-routine: in the
   kitchen, at the gym, on the way to work. Every page is designed at 412 px and
   must hold at 360 px; desktop is the wider case, not the main one.
2. **One tap, and it shows.** A tap that changes data changes the screen at once,
   with the loading bar and `aria-busy` covering the wait. Stale screens read as a
   broken app.
3. **Two spaces that never blur.** Work is the night palette; Life is greens. A
   glance says which space you are in. Today and the Schedule belong to both.
4. **Colour carries meaning, never alone.** Mint is done or on track, sand is due
   or at risk, coral is overdue or an error, aqua is in progress or a link. A word
   always says the same thing.
5. **Calm density.** Cards group one thing; one primary action per view; detail
   sits behind a panel or a link rather than on the page.

## Tokens

In `src/app/globals.css`, under `@theme` (colours, the font) and `@utility`
(composed classes):

| Group | Tokens |
| --- | --- |
| Work surfaces | `primary` (page), `midnight`, `navy`, `indigo`, `storm` (cards) |
| Life surfaces | `moss`, `pine`, `fern` |
| Brand | `royal`, `lavender`, `lilac` (lavender for text on dark) |
| Accents | `aqua`, `mint`, `sand`, `coral`, `orange`, `fuchsia` |
| Text roles | `text-white` (headings), `bright`, `body`, `muted`, `faint` (as `text-`, `fill-`, `placeholder-`) |
| Type | `text-heading`, `subtext`, `eyebrow`, `field-label`, Tailwind's scale |
| Containers | `card`, `card-special`, `card-link`, `card-life`, `dialog.sheet` |
| Actions | `btn-primary`, `btn-ghost`, `btn-soft`, `btn-life`, `tap` (44 px target) |
| Forms | `field-input` |
| Status | `Chip` in eight tones: `neutral`, `quiet`, `aqua`, `mint`, `sand`, `coral`, `lilac`, `ice` |

Text greys are roles, not steps: `body` for reading text and labels, `muted` for
secondary detail (dates, counts, captions), `faint` for the least important,
`bright` for emphasised detail. Pick the role that says why the text is grey;
the values live in one place.

The linter rejects raw hex colours and one-off pixel font sizes. When the scale
lacks a step, add a token here and in `globals.css`, then use it everywhere it
fits. That is how a new decision becomes part of the system rather than a
one-off.

## Components

`src/components/ui.tsx`: `PageHeader`, `SectionTitle`, `Chip` (and `StagePill`,
`StatusPill` built on it), `DueDate`, `ErrorNote`, `Empty`, `Hours`, `EvidenceLink`,
`TaskLink`, `Tabs`, `Ring`. `src/app/life/parts.tsx`: `LifeHeader`, `SetupCard`.

A chip is a few words in a tone: `<Chip tone="sand">Due Fri</Chip>`. Never write a
chip's colours by hand; a chip that is also a link takes `toneClass(tone)`. The
tones mean what the accents mean, plus `quiet` (present but unimportant), `lilac`
(complete) and `ice` (frozen).

## Known debt

- The Lab figures use about 230 one-off pixel font sizes for SVG text. They want
  a small figure type scale (three or four tokens) and a codemod, proven by
  screenshots of the Lab views.
