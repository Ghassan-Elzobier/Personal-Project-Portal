import Link from "next/link";
import type { Roadmap, RoadmapPhase, RoadmapUnit } from "@/lib/study/load";
import { CUDA_TO_VULKAN, TOOLS } from "@/lib/study/roadmap";
import { LoadAllButton, RoadmapPaceForm } from "./plan-controls";

export function RoadmapTab({ roadmap, active }: { roadmap: Roadmap; active: boolean }) {
  const { phases, current } = roadmap;
  const done = phases.filter((p) => p.state === "done").length;
  const percent = Math.round((done / phases.length) * 100);
  return (
    <Link
      href="/study"
      aria-current={active ? "page" : undefined}
      className={`block rounded-xl p-3 ring-1 transition hover:ring-white/25 ${active ? "bg-lavender/15 ring-lavender" : "bg-white/5 ring-white/5"}`}
    >
      <span className="block text-sm font-semibold">Roadmap</span>
      <span className="block text-xs text-neutral-300 tabular-nums">
        {current ? `Phase ${current.index + 1} of ${phases.length}` : `All ${phases.length} phases done`}
      </span>
      <span
        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10"
        role="img"
        aria-label={`${percent}% of phases done`}
      >
        <span className="block h-full rounded-full bg-mint" style={{ width: `${percent}%` }} />
      </span>
    </Link>
  );
}

/** All three plans as one path, with the current phase up front. */
export function RoadmapView({
  roadmap,
  today,
  defaultHours,
  market,
}: {
  roadmap: Roadmap;
  today: string;
  defaultHours: number;
  market?: Map<number, { name: string; must: number; soft: number }[]>;
}) {
  const { phases, missing, hoursLeft, dated, remaining } = roadmap;
  const untouched = phases.every((p) => p.tracks.every((t) => t.units.every((u) => !u.href)));

  return (
    <>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">One path through all three</h2>
        <p className="max-w-3xl text-sm text-neutral-300">
          Each phase puts a stretch of PMPP beside the Axler sections and renderer milestones that use it, so that each
          makes the others easier. Work on all three at once, and move on when the phase&apos;s end is true.
        </p>
      </div>

      {missing > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 card-special">
          <p className="text-sm text-white/90">
            {untouched
              ? "Load the plans to start."
              : `${missing} ${missing === 1 ? "unit is" : "units are"} in the plans but not added yet.`}{" "}
            You can edit or delete anything afterwards, and your existing work stays as it is.
          </p>
          <LoadAllButton
            label={untouched ? "Load all three plans" : `Add ${missing} missing`}
            className="btn bg-white/15 hover:bg-white/25"
          />
        </section>
      )}

      {hoursLeft > 0 && remaining > 0 && (
        <details open={dated === 0}>
          <summary className="cursor-pointer text-sm text-neutral-300 hover:text-white">
            {dated === 0 ? "Set a pace" : "Change the pace"}{" "}
            <span className="text-neutral-400 tabular-nums">
              about {Math.round(hoursLeft)} hours left, a rough guess
            </span>
          </summary>
          <div className="mt-3">
            <RoadmapPaceForm
              hoursLeft={hoursLeft}
              today={today}
              dated={dated}
              remaining={remaining}
              defaultHours={defaultHours}
            />
          </div>
        </details>
      )}

      <div className="space-y-4">
        {phases.map((p) => (
          <PhaseCard key={p.index} phase={p} count={phases.length} market={market?.get(p.index)} />
        ))}
      </div>

      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">Where things run</summary>
        <dl className="mt-3 space-y-3 text-neutral-300">
          {TOOLS.map((t) => (
            <div key={t.name}>
              <dt className="text-white">
                {t.name} <span className="text-neutral-400">{t.runs}</span>
              </dt>
              <dd>{t.use}</dd>
            </div>
          ))}
        </dl>
      </details>

      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">CUDA to Vulkan</summary>
        <p className="mt-3 text-neutral-300">
          What each thing in the book becomes when you port a kernel to a compute shader.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th scope="col" className="py-1.5 pr-4 font-normal">
                  In the book
                </th>
                <th scope="col" className="py-1.5 pr-4 font-normal">
                  In Vulkan and GLSL
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-neutral-300">
              {CUDA_TO_VULKAN.map((row) => (
                <tr key={row.cuda}>
                  <td className="py-1.5 pr-4 font-mono text-xs">{row.cuda}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{row.vulkan}</td>
                  <td className="py-1.5 text-xs">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function PhaseCard({
  phase: p,
  count,
  market,
}: {
  phase: RoadmapPhase;
  count: number;
  market?: { name: string; must: number; soft: number }[];
}) {
  const label = `Phase ${p.index + 1} of ${count}`;
  return (
    <details
      open={p.state === "now"}
      className={`group/phase ${p.state === "now" ? "card" : "rounded-xl bg-white/5 p-4 ring-1 ring-white/5"}`}
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>
          <span
            className="mr-2 inline-block text-xs text-neutral-400 transition-transform group-open/phase:rotate-90"
            aria-hidden
          >
            ▸
          </span>
          <span className="mr-2 eyebrow">{p.state === "now" ? `Now: ${label}` : label}</span>
          <h3 className="inline font-semibold">{p.phase.name}</h3>
        </span>
        <span className="text-xs text-neutral-400 tabular-nums">
          {p.done} of {p.total} done{p.hoursLeft > 0 ? `, about ${Math.round(p.hoursLeft)} h left` : ""}
        </span>
      </summary>

      <div className="mt-3 space-y-4">
        <p className="max-w-3xl text-sm text-neutral-300">{p.phase.why}</p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {p.tracks.map((t) => (
            <div key={t.project}>
              <h4 className="mb-1 text-sm font-semibold">{t.title}</h4>
              <ul className="space-y-1 text-sm">
                {t.units.map((u) => (
                  <PhaseUnit key={u.ref} unit={u} />
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="max-w-3xl text-sm">
          <span className="font-semibold">Done when: </span>
          <span className="text-neutral-300">{p.phase.exit}</span>
        </p>

        {market && market.length > 0 && (
          <p className="max-w-3xl text-sm">
            <span className="font-semibold">In the job market: </span>
            <span className="text-neutral-300">
              {market
                .map((m) => `${m.name} (${m.must + m.soft} ${m.must + m.soft === 1 ? "role" : "roles"})`)
                .join(", ")}
              .
            </span>{" "}
            <Link href="/jobs?view=skills" className="text-aqua underline-offset-4 hover:underline">
              See the market
            </Link>
          </p>
        )}

        {p.links.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-semibold hover:text-white">
              How they connect <span className="font-normal text-neutral-400 tabular-nums">{p.links.length}</span>
            </summary>
            <ul className="mt-2 max-w-3xl space-y-2 text-sm text-neutral-300">
              {p.links.map((l) => (
                <li key={`${l.a} ${l.b}`}>
                  <span className="text-white">
                    {l.aShort} and {l.bShort}:{" "}
                  </span>
                  {l.why}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}

function PhaseUnit({ unit }: { unit: RoadmapUnit }) {
  const label = (
    <>
      {unit.name}
      {unit.done && <span className="sr-only"> (done)</span>}
    </>
  );
  return (
    <li className="flex gap-1.5">
      <span className="w-3 shrink-0 text-center text-mint" aria-hidden>
        {unit.done ? "✓" : ""}
      </span>
      <span className={unit.done ? "text-neutral-400" : unit.optional ? "text-neutral-400" : ""}>
        {unit.href ? (
          <Link href={unit.href} scroll={false} className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {unit.optional && <span className="ml-1.5 text-xs text-neutral-400">optional</span>}
      </span>
    </li>
  );
}
