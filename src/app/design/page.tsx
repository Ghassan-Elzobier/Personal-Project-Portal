import { CopyButton } from "@/components/copy-button";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireOwner } from "@/lib/auth/access";
import {
  Chip,
  DueDate,
  Empty,
  ErrorNote,
  Fold,
  PageHeader,
  Ring,
  ScrollX,
  SectionTitle,
  StagePill,
  StatusPill,
  Tabs,
} from "@/components/ui";
import { LifeHeader, Steps } from "@/app/life/parts";
import { TimedChecklist } from "@/app/life/checklist";
import { DailyBars } from "@/components/daily-bars";
import { TodoRow } from "@/components/todos";

export const metadata: Metadata = { title: "Design" };
export const dynamic = "force-dynamic";

// The design system on one page: every token and shared component, each in its
// states. It is the reference for new UI, and the screenshot suite photographs
// it (e2e/visual.spec.ts), so a change to a shared piece shows up in review.
// Add a component here when it becomes shared. See docs/DESIGN.md.

const WORK_COLOURS = [
  ["primary", "bg-primary"],
  ["midnight", "bg-midnight"],
  ["navy", "bg-navy"],
  ["indigo", "bg-indigo"],
  ["storm", "bg-storm"],
  ["royal", "bg-royal"],
  ["lavender", "bg-lavender"],
  ["lilac", "bg-lilac"],
] as const;

const ACCENTS = [
  ["aqua", "bg-aqua"],
  ["mint", "bg-mint"],
  ["sand", "bg-sand"],
  ["coral", "bg-coral"],
  ["orange", "bg-orange"],
  ["fuchsia", "bg-fuchsia"],
] as const;

const LIFE_COLOURS = [
  ["moss", "bg-moss"],
  ["pine", "bg-pine"],
  ["fern", "bg-fern"],
] as const;

const STAGES = ["Not started", "In progress", "Blocked", "Needs review", "Done"];
const STATUSES = ["on_track", "at_risk", "off_track", "on_hold", "complete"];
const CHIP_TONES = ["neutral", "quiet", "aqua", "mint", "sand", "coral", "lilac", "ice"] as const;
const TEXT_ROLES = [
  ["text-bright", "Bright: emphasised detail, text on buttons"],
  ["text-body", "Body: reading text and labels"],
  ["text-muted", "Muted: secondary detail, such as a date"],
  ["text-faint", "Faint: the least important, such as a footnote"],
] as const;

function Swatches({ colours }: { colours: readonly (readonly [string, string])[] }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {colours.map(([name, bg]) => (
        <li key={name} className="min-w-0 space-y-1.5">
          <div className={`h-12 rounded-xl ring-1 ring-white/10 ${bg}`} />
          <p className="truncate text-xs text-muted">{name}</p>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <SectionTitle>{title}</SectionTitle>
      <p className="-mt-2 subtext">{note}</p>
      {children}
    </section>
  );
}

export default async function DesignPage() {
  await requireOwner();
  const today = "2026-11-16";

  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Reference" title="Design">
        The tokens and shared components every page is built from. Use these before writing new styles, and add a piece
        here when it becomes shared.
      </PageHeader>

      <Section title="Colour" note="Work uses the night palette; Life uses greens. Accents carry meaning.">
        <div className="space-y-5">
          <Swatches colours={WORK_COLOURS} />
          <Swatches colours={ACCENTS} />
          <Swatches colours={LIFE_COLOURS} />
        </div>
      </Section>

      <Section title="Type" note="One family, Funnel Display. Headings are white and bold; greys are text roles.">
        <div className="space-y-3 card">
          <p className="eyebrow">Eyebrow</p>
          <p className="text-heading">Page heading</p>
          <p className="text-xl font-semibold">Section heading</p>
          <p className="text-base">Body text for reading.</p>
          <p className="subtext">Subtext explains what a section is for.</p>
          <p className="text-sm text-body">
            Running text with{" "}
            <a href="#type" className="link">
              a link
            </a>
            , underlined so colour is not the only cue.
          </p>
          <p className="text-xs text-faint tabular-nums">Fine print and numbers: 12.5 h · 3 of 8</p>
          <p className="flex flex-wrap items-baseline gap-x-3 text-muted">
            <span className="text-sm">Figure title</span>
            <span className="text-xs">label</span>
            <span className="text-2xs">note, 2xs</span>
            <span className="text-3xs">tick, 3xs</span>
          </p>
          <ul className="space-y-1 border-t border-white/10 pt-3 text-sm">
            {TEXT_ROLES.map(([role, text]) => (
              <li key={role} className={role}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Surfaces" note="Cards group one thing. Life cards are green so the two spaces never mix.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card">
            <p className="font-semibold">card</p>
            <p className="text-sm text-muted">The default container.</p>
          </div>
          <div className="card-special">
            <p className="font-semibold">card-special</p>
            <p className="text-sm text-white/80">For the one thing that matters most on a page.</p>
          </div>
          <a href="#surfaces" className="card-link">
            <p className="font-semibold">card-link</p>
            <p className="text-sm text-muted">A whole card that opens something.</p>
          </a>
          <div className="card-life">
            <p className="font-semibold">card-life</p>
            <p className="text-sm text-body">The Life space&apos;s container.</p>
          </div>
        </div>
      </Section>

      <Section title="Actions" note="One primary action per view. Busy buttons say so with aria-busy.">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary">
            Primary
          </button>
          <button type="button" className="btn-ghost">
            Ghost
          </button>
          <button type="button" className="btn-soft">
            Soft
          </button>
          <button type="button" className="btn-life">
            Life
          </button>
          <button type="button" className="btn-primary" aria-busy="true">
            Saving
          </button>
          <button type="button" className="btn-ghost" disabled>
            Disabled
          </button>
          <button type="button" className="tap bg-white/5 ring-1 ring-white/10" aria-label="A 44 px tap target">
            +
          </button>
        </div>
      </Section>

      <Section title="Forms" note="Labels sit above fields. Fields are at least 40 px tall for a thumb.">
        <form className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2" action="#">
          <label className="block">
            <span className="field-label">Text</span>
            <input className="field-input" placeholder="Placeholder" />
          </label>
          <label className="block">
            <span className="field-label">Choice</span>
            <select className="field-input" defaultValue="b">
              <option value="a">First</option>
              <option value="b">Second</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Longer text</span>
            <textarea className="field-input" rows={2} defaultValue="A note that wraps onto a second line." />
          </label>
        </form>
      </Section>

      <Section
        title="Status"
        note="One Chip in eight tones; stages and statuses map onto them. Colour backs up the word, never replaces it."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <StagePill key={s} stage={s} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {CHIP_TONES.map((t) => (
              <Chip key={t} tone={t}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <DueDate dueOn="2026-11-12" today={today} />
            <DueDate dueOn={today} today={today} />
            <DueDate dueOn="2026-11-20" today={today} />
          </div>
        </div>
      </Section>

      <Section
        title="Copy"
        note="CopyButton puts text on the clipboard and says Copied; on a phone that refuses it says so instead."
      >
        <div className="flex flex-wrap gap-2">
          <CopyButton value="Example text to copy" />
          <CopyButton value="Example prompt" label="Copy prompt" className="btn-primary" />
        </div>
      </Section>

      <Section
        title="Wide content"
        note="Tables and timelines scroll sideways on a phone, in a ScrollX a keyboard can focus."
      >
        <ScrollX label="Example table" className="card p-0">
          <table className="w-full min-w-xl text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                {["Week", "Planned", "Logged", "Done", "Note"].map((h) => (
                  <th key={h} className="px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-body tabular-nums">
              <tr>
                <td className="px-4 py-3">16 Nov</td>
                <td className="px-4 py-3">12 h</td>
                <td className="px-4 py-3">9.5 h</td>
                <td className="px-4 py-3">3 of 5</td>
                <td className="px-4 py-3 text-muted">Chapter 4 exercises</td>
              </tr>
            </tbody>
          </table>
        </ScrollX>
      </Section>

      <Section
        title="Trends"
        note="DailyBars counts something per day: full size with its dates as text, compact in a list row, and empty."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card">
            <DailyBars
              label="Example errors"
              days={[0, 0, 1, 0, 3, 0, 0, 2, 5, 1, 0, 0, 2, 1].map((count, i) => ({
                day: `2026-11-${String(i + 3).padStart(2, "0")}`,
                count,
              }))}
            />
          </div>
          <div className="space-y-4 card">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-body">Compact, in a row</span>
              <DailyBars
                size="compact"
                label="Example errors"
                days={[0, 1, 0, 0, 4, 2, 0, 0, 0, 1, 3, 0, 0, 2].map((count, i) => ({
                  day: `2026-11-${String(i + 3).padStart(2, "0")}`,
                  count,
                }))}
              />
            </div>
            <DailyBars
              label="Nothing yet"
              days={Array.from({ length: 14 }, (_, i) => ({
                day: `2026-11-${String(i + 3).padStart(2, "0")}`,
                count: 0,
              }))}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Fold"
        note="Extra detail that opens in place. The whole row is the target, the chevron turns as it opens, and meta keeps a total in view while it is closed."
      >
        <div className="space-y-1 card">
          <Fold title="Where it goes">
            <p className="pb-2 text-body">The detail, shown once it opens.</p>
          </Fold>
          <Fold
            title={<span className="font-medium text-body">This week</span>}
            meta="£84.15 out · £0.00 in · 2 to sort"
            open
          >
            <p className="pb-2 text-body">Open to start with: open sets only how it starts.</p>
          </Fold>
        </div>
      </Section>

      <Section title="Feedback" note="Say what happened and what to do next.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ErrorNote title="Could not save" message="The connection dropped. Your change is still here; try again." />
          <Empty>Nothing due today. Pick something from Study.</Empty>
        </div>
      </Section>

      <Section
        title="Life pieces"
        note="The Life header, with the shared Tabs, Steps (a method, or the Cook view's get ready), a timed checklist (the gym's warm-up and recovery), Ring and a to-do row (on the To-dos page and Today: tick, move, delete) as they look on Life's greens."
      >
        <div className="space-y-5 rounded-2xl bg-moss p-4 sm:p-5">
          <LifeHeader eyebrow="Life" title="Page heading">
            Life pages open with this header.
          </LifeHeader>
          <Tabs
            current="week"
            tabs={[
              { key: "week", label: "Week", href: "#life" },
              { key: "list", label: "List", href: "#life", count: 4 },
              { key: "fridge", label: "Fridge", href: "#life" },
            ]}
          />
          <div className="card-life">
            <Steps
              steps={[
                "Heat the oven to 200°C.",
                "Prep Onions 3: 2 for Spaghetti bolognese, 1 for Cottage pie.",
                "Then wash your hands, the board and the knife in hot soapy water.",
              ]}
            />
          </div>
          <TimedChecklist
            id="design-checklist"
            title="Warm-up"
            steps={[
              { text: "Bike: 2 min easy, then 3 spin-ups of 6 s", seconds: 120, optional: false },
              { text: "Vibrating roller: 75 s on the quads", seconds: 75, optional: false },
              { text: "Couch stretch, 30 s a side", seconds: 60, optional: true },
            ]}
          />
          <ul className="divide-y divide-white/5 card-life py-1 sm:py-2">
            <TodoRow todo={{ gid: "0", title: "Renew the example permit", dueOn: today, doneAt: null }} today={today} />
            <TodoRow
              todo={{ gid: "0", title: "Post the example form", dueOn: null, doneAt: `${today}T08:00:00Z` }}
              today={today}
            />
          </ul>
          <div className="grid grid-cols-3 gap-3">
            <Ring value={2} max={3} label="Gym" sub="2 of 3" />
            <Ring value={17} max={21} label="Meals" sub="17 of 21" color="var(--color-sand)" />
            <Ring value={0} max={7} label="Weigh-ins" sub="0 of 7" color="var(--color-aqua)" />
          </div>
        </div>
      </Section>
    </div>
  );
}
