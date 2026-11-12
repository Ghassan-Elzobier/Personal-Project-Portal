import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { addDays, weekdayIndex } from "@/lib/dates/week";
import { loadLife } from "@/lib/life/load";
import { bmr, KCAL_PER_KG_GAINED, weeklyRate } from "@/lib/life/nutrition";
import { ageOn } from "@/lib/life/profile";
import { effort } from "@/lib/life/state";
import { ErrorNote } from "@/components/ui";
import { applyAdjustment } from "../actions";
import { LineChart } from "../chart";
import { ActionButton } from "../kit";
import { LifeHeader, Ring, SetupCard } from "../parts";
import { WeighIn } from "./weigh-in";

export const metadata: Metadata = { title: "Body" };
export const dynamic = "force-dynamic";

export default async function BodyPage() {
  await requireOwner();
  const loaded = await loadLife();
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Body" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const todays = s.weights.find((w) => w.day === s.today)?.kg ?? null;
  const last = s.weights[s.weights.length - 1];
  const since = addDays(s.today, -60);
  const shown = s.trend.filter((p) => p.day >= since);
  const rate = weeklyRate(s.weights, s.today);
  const wanted = s.kg ? (s.profile.goal.ratePct / 100) * s.kg : null;
  const monday = addDays(s.today, -weekdayIndex(s.today));
  const e = effort(s, monday);
  const age = ageOn(s.profile, s.today);
  const rest = s.setUp && s.kg && age ? Math.round(bmr({ sex: s.profile.body.sex!, age, heightCm: s.profile.body.heightCm!, kg: s.kg })) : null;

  return (
    <div className="space-y-6">
      <LifeHeader eyebrow="Weight, targets and effort" title="Body">
        Weigh in each morning after the loo and before food. The trend line ignores the daily swings; the target follows the trend.
      </LifeHeader>
      {!s.setUp && <SetupCard />}

      <WeighIn today={s.today} todays={todays} last={last?.kg ?? null} />

      <section className="card-life space-y-3" aria-labelledby="trend-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trend-title" className="text-lg font-semibold">
            Trend
          </h2>
          {s.kg !== null && <span className="text-2xl font-bold tabular-nums">{s.kg.toFixed(1)} kg</span>}
        </div>
        {shown.length > 1 ? (
          <LineChart points={shown.map((p) => ({ x: p.day, y: p.kg }))} smooth={shown.map((p) => ({ x: p.day, y: Math.round(p.trend * 100) / 100 }))} unit="kg" label="Daily weigh-ins and the smoothed trend, last 60 days" />
        ) : (
          <p className="text-sm text-neutral-400">The chart starts with your second weigh-in.</p>
        )}
        <p className="text-sm text-neutral-300">
          {rate !== null && wanted !== null ? (
            <>
              {rate >= 0 ? "Gaining" : "Losing"} <strong className="text-white tabular-nums">{Math.abs(rate).toFixed(2)} kg</strong> a week over three weeks, against a
              target of <span className="tabular-nums">{wanted.toFixed(2)} kg</span> ({s.profile.goal.ratePct}% of body weight).
            </>
          ) : (
            "The weekly rate needs eight weigh-ins in three weeks. Until then it's water, glycogen and food in the gut, not tissue."
          )}
        </p>
      </section>

      {s.targets && (
        <section className="card-life space-y-4" aria-labelledby="targets-title">
          <h2 id="targets-title" className="text-lg font-semibold">
            Daily targets
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Energy", `${s.kcal.toLocaleString("en-GB")}`, "kcal"],
              ["Protein", `${s.targets.protein}`, "g"],
              ["Fat", `${s.targets.fat}`, "g"],
              ["Carbs", `${s.targets.carbs}`, "g"],
            ].map(([k, v, u]) => (
              <div key={k} className="rounded-xl bg-white/5 p-3">
                <dt className="text-xs text-neutral-400">{k}</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {v} <span className="text-sm font-normal text-neutral-400">{u}</span>
                </dd>
              </div>
            ))}
          </dl>
          {s.adjustment && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
              <p className="min-w-0 flex-1 text-sm">{s.adjustment.why}</p>
              {s.adjustment.change !== 0 && (
                <ActionButton action={applyAdjustment} className="btn-life px-4 py-2" done="Target updated. Next week's portions follow it.">
                  {s.adjustment.change > 0 ? "+" : ""}
                  {s.adjustment.change} kcal
                </ActionButton>
              )}
            </div>
          )}
          <details className="text-sm text-neutral-300">
            <summary className="cursor-pointer text-mint">Where these come from</summary>
            <div className="mt-2 space-y-2">
              <p>
                Resting energy {rest ? <span className="tabular-nums">{rest.toLocaleString("en-GB")} kcal</span> : ""} from the Mifflin-St Jeor equation, the most accurate of the common ones
                for healthy adults (Frankenfield et al., 2005), times {s.profile.activity} for a desk job plus training, gives maintenance of about{" "}
                <span className="tabular-nums">{s.targets.maintenance.toLocaleString("en-GB")} kcal</span>.
              </p>
              <p>
                On top: {s.profile.goal.ratePct}% of body weight a week, the pace that suits lifters building muscle without much fat (Iraki et al., 2019). A kilo gained as a lifter
                is part muscle, part fat: about {KCAL_PER_KG_GAINED.toLocaleString("en-GB")} kcal.
              </p>
              <p>
                Protein at {s.profile.goal.proteinPerKg} g/kg: gains level off around 1.6 g/kg with an upper bound near 2.2 (Morton et al., 2018). Fat at least{" "}
                {Math.round(s.profile.goal.fatShare * 100)}% of energy for hormones; carbs fill the rest and fuel training.
              </p>
              <p>
                The equation is only a start. After two weeks the target moves by what your weight trend says, at most 150 kcal a week, and only if you ate the
                plan.
              </p>
            </div>
          </details>
        </section>
      )}

      <section className="card-life space-y-4" aria-labelledby="effort-title">
        <div>
          <h2 id="effort-title" className="text-lg font-semibold">
            This week&apos;s effort
          </h2>
          <p className="text-sm text-neutral-400">Monday to today. Consistency builds muscle; one bad day doesn&apos;t.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Ring value={e.train.done} max={e.train.planned} label="Train" sub={`${e.train.done} of ${e.train.planned}`} />
          <Ring value={e.eat.eaten} max={e.eat.planned || 1} label="Eat the plan" sub={e.eat.planned ? `${e.eat.eaten} of ${e.eat.planned} meals` : "No meals yet"} color="var(--color-sand)" />
          <Ring value={e.protein.hit} max={e.protein.days || 1} label="Protein" sub={e.protein.days ? `${e.protein.hit} of ${e.protein.days} days` : "From tomorrow"} color="var(--color-aqua)" />
          <Ring value={e.weigh.done} max={e.weigh.days} label="Weigh in" sub={`${e.weigh.done} of ${e.weigh.days} days`} color="var(--color-lavender)" />
        </div>
      </section>
    </div>
  );
}
