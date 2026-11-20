import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { clock } from "@/lib/dates/week";
import { loadLife } from "@/lib/life/load";
import { freezeCount } from "@/lib/life/planner";
import { cookPlan } from "@/lib/life/prep";
import { recipe } from "@/lib/life/recipes";
import { viewOn } from "@/lib/life/state";
import { Empty, ErrorNote } from "@/components/ui";
import { cookPlanned } from "../actions";
import { ActionButton } from "../kit";
import { dayLabel, LifeHeader, Steps } from "../parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cook" };

/**
 * A cook session from one page: get ready, cook each dish with its done check, and
 * box up, at the amounts the shopping list bought. `?day=2026-11-18&at=990` is the
 * session's day and start (minutes after midnight), as the Schedule has it.
 */
export default async function CookPage({ searchParams }: { searchParams: Promise<{ day?: string; at?: string }> }) {
  const [, loaded, ask] = await Promise.all([requireOwner(), loadLife(), searchParams]);
  if (loaded.error !== undefined) return <ErrorNote message={loaded.error} />;
  const s = loaded.state;
  const day = ask.day && /^\d{4}-\d{2}-\d{2}$/.test(ask.day) ? ask.day : s.today;
  const at = ask.at === undefined ? null : Number(ask.at);
  const v = viewOn(s, day);
  const cooks = (v.plan?.cooks ?? []).filter((c) => c.date === day && (at === null || c.start === at));
  const back = (
    <p>
      <Link href="/life/kitchen?tab=fridge" className="text-sm text-muted hover:text-white">
        ← Kitchen
      </Link>
    </p>
  );
  if (!v.plan || !cooks.length)
    return (
      <article className="space-y-6">
        {back}
        <LifeHeader eyebrow={dayLabel(day, s.today)} title="Cook" />
        <Empty>
          Nothing to cook then. The Kitchen&apos;s Fridge tab lists this week&apos;s cook sessions; open one from there.
        </Empty>
      </article>
    );

  const plan = v.plan;
  const prep = cookPlan(
    cooks.flatMap((c) => {
      const r = recipe(c.recipe);
      return r
        ? [
            {
              id: c.id,
              recipe: r,
              portions: c.portions,
              scale: c.scale,
              freeze: freezeCount(plan, c, v.placements),
              date: c.date,
              cooked: s.batches.some((b) => b.planStart === v.start && b.cookId === c.id),
            },
          ]
        : [];
    }),
  );
  const names = prep.dishes.map((d) => d.name);

  return (
    <article className="space-y-6">
      {back}
      <LifeHeader
        eyebrow={`${dayLabel(day, s.today)} · ${clock(cooks[0].start)}`}
        title={`Cook: ${names.join(" and ")}`}
      >
        Get ready, cook, box up, at the amounts your shopping list bought.
      </LifeHeader>

      {prep.warnings.length > 0 && (
        <ul className="space-y-1 card-life text-sm text-sand">
          {prep.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <section className="space-y-3 card-life" aria-labelledby="ready-title">
        <h2 id="ready-title" className="font-semibold">
          Get ready
        </h2>
        <Steps steps={prep.ready} />
      </section>

      {prep.dishes.map((d, i) => (
        <section key={d.id} className="space-y-3 card-life" aria-labelledby={`dish-${d.key}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="eyebrow text-mint/80">{i === 0 && prep.dishes.length > 1 ? "Start this first" : "Cook"}</p>
              <h2 id={`dish-${d.key}`} className="font-semibold">
                <Link href={`/life/recipes/${d.key}?cook=${encodeURIComponent(d.id)}`} className="hover:underline">
                  {d.name}
                </Link>
              </h2>
            </div>
            {d.cooked ? (
              <span className="text-sm text-mint">Cooked</span>
            ) : (
              <ActionButton
                action={cookPlanned.bind(null, v.start, d.id)}
                className="btn-life px-4 py-2"
                done="In the fridge. Box it up below."
              >
                Cooked it
              </ActionButton>
            )}
          </div>
          <Steps steps={d.steps} />
          {d.done && <p className="rounded-xl bg-white/5 p-3 text-sm text-body">{d.done}</p>}
        </section>
      ))}

      <section className="space-y-3 card-life" aria-labelledby="box-title">
        <h2 id="box-title" className="font-semibold">
          Box up
        </h2>
        <Steps steps={prep.boxUp} />
        {prep.kit.length > 0 && (
          <ul className="space-y-1 text-xs text-muted">
            {prep.kit.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
