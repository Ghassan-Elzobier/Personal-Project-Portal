import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { addDays, weekdayIndex } from "@/lib/dates/week";
import { BENCH_LIFTS, EXERCISE_MAP, lowestKg, PROGRAM, resolve, workout } from "@/lib/life/gym/program";
import { estimate, plan } from "@/lib/life/gym/duration";
import { consistency, e1rm, e1rmSeries, nextWorkout, project, target } from "@/lib/life/gym/progress";
import { demoFor } from "@/lib/life/gym/media";
import { loadLife } from "@/lib/life/load";
import { loadToday } from "@/lib/money/load";
import { pounds } from "@/lib/money/state";
import { gymCost } from "@/lib/portal/money";
import { isReturning } from "@/lib/life/state";
import { Chip, ErrorNote } from "@/components/ui";
import { dayLabel, LifeHeader, weekdayShort } from "../parts";
import { LineChart } from "../chart";
import { type TimedStep } from "../checklist";
import { SessionLogger, type BlockView } from "./session";

export const metadata: Metadata = { title: "Gym" };
export const dynamic = "force-dynamic";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function GymPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  // In parallel: life_read checks for the owner itself.
  const [, params, loaded, money] = await Promise.all([requireOwner(), searchParams, loadLife(), loadToday()]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Gym" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const today = s.today;
  const session = s.sessions.find((x) => x.day === today);
  const suggested = nextWorkout(s.sessions.filter((x) => x.day < today));
  const key = session?.workout ?? (params.w && workout(params.w) ? params.w : suggested);
  const w = workout(key)!;
  const before = s.sets.filter((x) => x.day < today);
  const returning = isReturning(s, today);
  const trainingDay = s.profile.gym.days.includes(weekdayIndex(today));
  // What the gym bill Money found costs a visit, this month.
  const cost = money ? gymCost(money.data, s.sessions, today) : null;
  // How long the session takes, and what fits the time you have today.
  const missing = s.profile.gym.missing;
  const length = estimate(w, missing);
  const todays = plan(w, s.profile.gym.minutes, missing);
  const steps = (list: typeof w.warmup): TimedStep[] =>
    list.map((x) => ({ text: x.text, seconds: x.seconds, optional: Boolean(x.optional) }));

  const blocks: BlockView[] = w.blocks.map((b, i) => ({
    title: b.title,
    superset: Boolean(b.superset),
    optional: Boolean(b.optional),
    planned: todays.blocks[i],
    minutes: Math.round(length.blocks[i] / 60),
    items: b.items.map((p) => {
      const ex = resolve(p.exercise, s.profile.gym.missing) ?? EXERCISE_MAP.get(p.exercise)!;
      const t = target({ ...p, exercise: ex.key }, before, returning);
      return {
        key: ex.key,
        name: ex.name,
        swappedFrom: ex.key !== p.exercise ? (EXERCISE_MAP.get(p.exercise)?.name ?? null) : null,
        perSide: Boolean(ex.perSide),
        cues: ex.cues,
        back: ex.back ?? null,
        demo: demoFor(ex),
        weighted:
          ex.load !== "time" &&
          ex.load !== "distance" &&
          ex.load !== "ball" &&
          !(ex.load === "bodyweight" && ex.step === 0),
        added: ex.load === "bodyweight",
        lowest: lowestKg(ex.key),
        unit: p.scheme === "timed" ? (ex.load === "distance" || ex.key === "farmer-carry" ? "m" : "s") : "reps",
        step: ex.step,
        rest: p.rest,
        scheme: p.scheme,
        note: p.note ?? null,
        range: p.reps,
        rir: t.rir,
        target: t.sets,
        change: t.change,
        why: t.why,
        ramp: p.ramp ?? [],
        logged: s.sets
          .filter((x) => x.day === today && x.exercise === ex.key)
          .map((x) => ({ position: x.position, kg: x.kg, reps: x.reps ?? 0, rir: x.rir })),
      };
    }),
  }));

  const goal = s.profile.gym.benchGoalKg;
  const series = e1rmSeries(s.sets, "bench");
  const forecast = goal ? project(series, goal, today) : null;
  const monday = addDays(today, -weekdayIndex(today));
  const week = consistency(s.sessions, s.profile.gym.days, monday);
  const best = (day: string, ex: string) =>
    s.sets
      .filter((x) => x.day === day && x.exercise === ex && x.kg && x.reps)
      .reduce<{ kg: number; reps: number } | null>(
        (b, x) => (!b || x.kg! > b.kg ? { kg: x.kg!, reps: x.reps! } : b),
        null,
      );
  const recent = [...s.sessions].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 6);

  return (
    <div className="space-y-6">
      <LifeHeader
        eyebrow={`${dayLabel(today, today)} · ${trainingDay ? "training day" : "rest day"}`}
        title="Gym"
        action={
          <div className="flex gap-1 rounded-2xl bg-white/5 p-1" role="group" aria-label="Session">
            {PROGRAM.workouts.map((x) => (
              <Link
                key={x.key}
                href={session ? "#" : `/life/gym?w=${x.key}`}
                aria-current={x.key === key ? "true" : undefined}
                aria-disabled={Boolean(session) && x.key !== key}
                className={`tap min-w-12 px-3 text-sm font-semibold ${x.key === key ? "bg-fern text-white" : session ? "pointer-events-none text-neutral-600" : "text-muted hover:text-white"}`}
              >
                {x.key}
              </Link>
            ))}
          </div>
        }
      >
        {PROGRAM.name}. {key === suggested ? "Next in the rotation:" : "You picked:"}{" "}
        <span className="text-white">
          {w.key}, {w.name}.
        </span>{" "}
        {w.focus}
      </LifeHeader>

      <section className="grid grid-cols-3 gap-3 card-life text-center" aria-label="This week">
        <div>
          <p className="text-2xl font-bold tabular-nums">
            {week.done}
            <span className="text-base font-normal text-muted">/{week.planned}</span>
          </p>
          <p className="text-xs text-muted">sessions this week</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{week.streak}</p>
          <p className="text-xs text-muted">{week.streak === 1 ? "full week" : "full weeks"} in a row</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">
            {series.length ? `${Math.round(series[series.length - 1].e1rm)}` : "–"}
          </p>
          <p className="text-xs text-muted">bench estimate, kg</p>
        </div>
      </section>

      {cost && (
        <p className="text-sm text-muted tabular-nums">
          The gym costs {pounds(cost.monthly)} a month:{" "}
          {cost.perVisit !== null
            ? `${cost.visits} ${cost.visits === 1 ? "visit" : "visits"} so far this month, ${pounds(cost.perVisit)} a visit.`
            : "no visits yet this month."}
        </p>
      )}

      {returning && (
        <p className="rounded-xl bg-sand/10 p-3 text-sm text-sand ring-1 ring-sand/25">
          Coming back from a break: for the first two weeks every set stops with one more rep in reserve than written.
          Strength returns fast; tendons and soreness take longer.
        </p>
      )}

      <SessionLogger
        key={`${today}:${w.key}`}
        day={today}
        workout={w.key}
        warmup={steps(w.warmup)}
        recovery={steps(w.recovery)}
        timing={{
          planned: todays.seconds,
          budget: s.profile.gym.minutes,
          left: w.blocks.filter((b, i) => b.optional && !todays.blocks[i]).length,
        }}
        blocks={blocks}
        finished={Boolean(session?.finished)}
        feel={session?.feel ?? null}
        notes={session?.notes ?? ""}
        started={Boolean(session)}
      />

      <section className="space-y-3 card-life" aria-labelledby="bench-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="bench-title" className="text-lg font-semibold">
            Bench press{goal ? ` to ${goal} kg` : ""}
          </h2>
          {forecast?.eta && (
            <Chip tone="mint">
              On pace for{" "}
              {new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
                new Date(`${forecast.eta}T12:00:00Z`),
              )}
            </Chip>
          )}
        </div>
        {series.length ? (
          <LineChart
            points={series.map((p) => ({ x: p.day, y: p.e1rm }))}
            goal={goal ?? undefined}
            unit="kg"
            label="Estimated one-rep max, best set of each heavy bench day"
          />
        ) : (
          <p className="text-sm text-muted">Your estimated max appears after the first heavy bench day (session A).</p>
        )}
        <p className="text-sm text-body">
          {forecast?.note ??
            "Estimated from your best set each day, with reps in reserve counted (Epley). A forecast, not a promise: it moves every session."}
          {forecast?.eta ? " Reaching it also needs the body weight: eat the plan." : ""}
        </p>
        <p className="text-xs text-faint">Paused bench days count too, but only the full bench is on the chart.</p>
      </section>

      <section className="space-y-3 card-life" aria-labelledby="history-title">
        <h2 id="history-title" className="text-lg font-semibold">
          Recent sessions
        </h2>
        {recent.length ? (
          <ul className="divide-y divide-white/5">
            {recent.map((r) => {
              const lift = BENCH_LIFTS.map((b) => ({ b, best: best(r.day, b) })).find((x) => x.best);
              const sets = s.sets.filter((x) => x.day === r.day).length;
              return (
                <li key={r.day} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                  <span>
                    <span className="font-medium">
                      {weekdayShort(r.day)} {r.day.slice(8)}/{r.day.slice(5, 7)}
                    </span>{" "}
                    · {r.workout}, {workout(r.workout)?.name}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {sets} sets
                    {lift?.best
                      ? ` · ${EXERCISE_MAP.get(lift.b)?.name.toLowerCase()} ${lift.best.kg} × ${lift.best.reps}`
                      : ""}
                    {lift?.best ? ` (≈${Math.round(e1rm(lift.best.kg, lift.best.reps) ?? 0)})` : ""}
                    {r.finished ? "" : " · not finished"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Nothing logged yet. Your first session starts with the first set you tick.
          </p>
        )}
      </section>

      <section className="space-y-3 card-life" aria-labelledby="program-title">
        <h2 id="program-title" className="text-lg font-semibold">
          The programme
        </h2>
        <p className="text-sm text-body">{PROGRAM.summary}</p>
        <p className="text-sm text-body">
          Days: {s.profile.gym.days.map((d) => DAYS[d]).join(", ")} at{" "}
          {String(Math.floor(s.profile.gym.start / 60)).padStart(2, "0")}:
          {String(s.profile.gym.start % 60).padStart(2, "0")}.{" "}
          <Link href="/life/settings#gym" className="text-mint hover:underline">
            Change
          </Link>
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PROGRAM.workouts.map((x) => {
            const e = estimate(x, missing);
            return (
              <div key={x.key} className="min-w-0 rounded-xl bg-white/5 p-3">
                <p className="font-semibold">
                  {x.key} · {x.name}
                </p>
                <p className="text-xs text-body tabular-nums">
                  About {Math.round(e.core / 60)} min, {Math.round(e.full / 60)} with the extras
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {x.blocks
                    .flatMap((b) => b.items.map((p) => ({ p, optional: Boolean(b.optional) })))
                    .map(({ p, optional }) => {
                      const ex = resolve(p.exercise, missing);
                      return (
                        <li key={p.exercise}>
                          {ex?.name}:{" "}
                          {p.note ?? `${p.sets} × ${p.reps[0] === p.reps[1] ? p.reps[0] : `${p.reps[0]}–${p.reps[1]}`}`}
                          {optional ? " (optional)" : ""}
                        </li>
                      );
                    })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-faint">
          Missing a piece of kit? Tell Settings what your gym lacks, and every exercise that needs it swaps for its
          alternative.
        </p>
        <p className="text-xs text-faint">
          Sessions are on the{" "}
          <Link href="/schedule" className="underline decoration-white/30 underline-offset-2 hover:text-white">
            Schedule
          </Link>{" "}
          and in Google Calendar on your gym days, with the workout the rotation says is next.
        </p>
      </section>
    </div>
  );
}
