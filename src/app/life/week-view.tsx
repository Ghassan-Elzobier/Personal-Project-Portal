"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { OTHER_LABEL, OTHER_SIZES, type OtherSize } from "@/lib/life/other-meal";
import { toast } from "@/components/toaster";
import { pounds } from "@/lib/life/basket";
import type { Slot } from "@/lib/life/nutrition";
import { logMeal, logPastAsEaten, planWeek, removeCook, setDaily, setFresh, setOut, swapCook, uncook } from "./actions";
import { ActionButton, Sheet, Stars, toastCooked } from "./kit";
import { cookedNote } from "@/lib/life/cooked";
import { Chip } from "@/components/ui";

export type Alt = {
  key: string;
  name: string;
  cuisine: string;
  minutes: number;
  kcal: number;
  protein: number;
  reasons: string[];
  stars: number | null;
  explore: boolean;
  daily: boolean;
  /** One portion at the written size, at your prices or typical ones. */
  pence: number;
};
export type CookGroup = {
  key: string;
  label: string;
  date: string;
  items: {
    id: string;
    recipe: string;
    name: string;
    meal: string;
    portions: number;
    kcal: number;
    protein: number;
    minutes: number;
    cooked: boolean;
    spare: number;
    /** The spare portions stay in the fridge for next week's first lunch. */
    spareCold?: boolean;
    /** Why the planner picked it ("Shares the peppers with …"). */
    why?: string;
  }[];
};

/** What the week costs as planned, in words, and what a cheaper week would save (pence). */
export type WeekCostView = { food: string; detail: string; saves: number | null };
export type MealView = {
  id: string;
  slot: Slot;
  time: string;
  recipe: string | null;
  name: string | null;
  source: string;
  storage: "fridge" | "freezer" | null;
  defrost: string | null;
  kcal: number;
  protein: number;
  status: "eaten" | "skipped" | "swapped" | null;
};
export type DayView = {
  date: string;
  label: string;
  past: boolean;
  today: boolean;
  meals: MealView[];
  kcal: number;
  protein: number;
  notes: string[];
};

const SLOT_LABEL: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", shake: "Shake", dinner: "Dinner" };
const OTHER_CHOICES = Object.keys(OTHER_SIZES) as OtherSize[];

type Picker =
  | { kind: "swap"; cookId: string; meal: "main" | "breakfast"; current: string }
  | { kind: "daily"; slot: "breakfast" | "shake"; current: string }
  // `other`: the sheet is asking how a meal eaten in place of the plan compared with it.
  | { kind: "meal"; day: DayView; meal: MealView; other?: boolean }
  | { kind: "fresh"; day: DayView; meal: MealView }
  | null;

/** "I ate them": every past meal not ticked, as eaten, and the cooks they came from. */
export function AteThem() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      className="btn-life px-4 py-2"
      onClick={() =>
        start(async () => {
          const r = await logPastAsEaten();
          if (r.error !== undefined) return void toast(r.error, { tone: "error" });
          const cooked = cookedNote(r.cooked ?? []);
          toast(cooked ? `Logged as eaten. ${cooked}` : "Logged as eaten.");
        })
      }
    >
      I ate them
    </button>
  );
}

export function WeekView({
  start,
  today,
  groups,
  days,
  nothing,
  daily,
  options,
  canReplan,
  mode = "batch",
  shops = 0,
  cost = null,
}: {
  start: string;
  today: string;
  groups: CookGroup[];
  days: DayView[];
  nothing: number;
  daily: { breakfast: string; shake: string; shakes: string[] };
  options: { main: Alt[]; breakfast: Alt[]; shake: Alt[]; fresh: Alt[] };
  canReplan: boolean;
  /** A fresh week: short cooks of one dish and `shops` small shops. */
  mode?: "batch" | "fresh";
  shops?: number;
  /** What the week costs as planned, until its food is bought. */
  cost?: WeekCostView | null;
}) {
  const other = mode === "fresh" ? "batch" : "fresh";
  const [picker, setPicker] = useState<Picker>(null);
  const [, start_] = useTransition();
  const [logs, setLog] = useOptimistic(
    Object.fromEntries(days.flatMap((d) => d.meals.map((m) => [m.id, m.status]))) as Record<string, MealView["status"]>,
    (current, change: { id: string; status: MealView["status"] }) => ({ ...current, [change.id]: change.status }),
  );
  const close = () => setPicker(null);
  const nameOf = (key: string) => [...options.breakfast, ...options.shake].find((a) => a.key === key)?.name ?? key;

  const tick = (day: DayView, meal: MealView, status: "eaten" | "skipped" | "swapped" | null, size?: OtherSize) =>
    start_(async () => {
      setLog({ id: meal.id, status });
      const r = await logMeal(day.date, meal.slot, status, size);
      if (r.error !== undefined) return void toast(r.error, { tone: "error" });
      // A meal from a cook that wasn't logged logs the cook too; Undo takes both back.
      toastCooked(r.cooked, () =>
        start_(async () => {
          await logMeal(day.date, meal.slot, null);
          for (const c of r.cooked ?? []) {
            const back = await uncook(c.batch);
            if (back.error) return void toast(back.error, { tone: "error" });
          }
        }),
      );
    });

  // Today first, then the rest of the week in order, then the days gone.
  const ordered = [...days.filter((d) => d.date >= today), ...days.filter((d) => d.date < today)];

  return (
    <>
      <section className="space-y-4 card-life" aria-labelledby="menu-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="menu-title" className="text-lg font-semibold">
            The week&apos;s cooking
          </h2>
          {canReplan && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <ActionButton
                action={() => planWeek(start)}
                className="text-sm text-muted hover:text-white"
                confirm="Pick a fresh set of recipes for this week?"
                done="Re-planned."
              >
                Pick again
              </ActionButton>
              <ActionButton
                action={() => planWeek(start, other)}
                className="text-sm text-muted hover:text-white"
                confirm={`Plan this week again as a ${other} week?`}
                done={`Planned a ${other} week.`}
              >
                Make it a {other} week
              </ActionButton>
            </div>
          )}
        </div>
        {cost && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-white/5 p-3">
            <p className="min-w-0 text-sm">
              <span className="block text-body">{cost.food}</span>
              <span className="block text-xs text-muted">{cost.detail}</span>
            </p>
            {canReplan && cost.saves !== null && (
              <ActionButton
                action={() => planWeek(start, mode, true)}
                className="btn-soft px-3 py-1.5 text-xs"
                confirm={`Plan a cheaper week? It saves about ${pounds(cost.saves)}.`}
                done="Planned a cheaper week."
              >
                Cheaper week: save {pounds(cost.saves)}
              </ActionButton>
            )}
          </div>
        )}
        {mode === "fresh" && (
          <p className="text-sm text-body">
            <Chip tone="mint">Fresh week</Chip> {groups.length} short {groups.length === 1 ? "cook" : "cooks"} of one
            dish
            {shops ? ` and ${shops} ${shops === 1 ? "shop" : "shops"}` : ""}, each feeding the days until the next.
            Nothing goes in the freezer.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <p className="eyebrow">{g.label}</p>
            <ul className="space-y-2">
              {g.items.map((c) => (
                <li key={c.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-white/5 p-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/life/recipes/${c.recipe}?cook=${encodeURIComponent(c.id)}`}
                      className="line-clamp-2 block font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted tabular-nums">
                      {c.portions}{" "}
                      {c.meal === "breakfast"
                        ? c.portions === 1
                          ? "breakfast"
                          : "breakfasts"
                        : c.portions === 1
                          ? "portion"
                          : "portions"}{" "}
                      · {c.kcal} kcal · {c.protein} g · {c.minutes} min
                      {c.spare > 0
                        ? c.spareCold
                          ? ` · ${c.spare} for next week's first lunch`
                          : ` · ${c.spare} spare to freeze`
                        : ""}
                    </p>
                    {c.why && <p className="text-xs text-mint">{c.why}</p>}
                  </div>
                  {c.cooked ? (
                    <Chip tone="mint">Cooked</Chip>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setPicker({
                            kind: "swap",
                            cookId: c.id,
                            meal: c.meal === "breakfast" ? "breakfast" : "main",
                            current: c.recipe,
                          })
                        }
                        className="btn-soft px-3 py-1.5 text-xs"
                      >
                        Swap
                      </button>
                      <ActionButton
                        action={() => removeCook(start, c.id)}
                        className="tap text-lg text-faint hover:text-coral"
                        label={`Remove ${c.name}`}
                        confirm={`Take ${c.name} off this week?`}
                      >
                        ×
                      </ActionButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPicker({ kind: "daily", slot: "breakfast", current: daily.breakfast })}
            className="min-w-0 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10"
          >
            <span className="block text-xs text-muted">Quick breakfast when no batch is ready</span>
            <span className="block truncate font-medium">{nameOf(daily.breakfast)}</span>
          </button>
          <button
            type="button"
            onClick={() => setPicker({ kind: "daily", slot: "shake", current: daily.shake })}
            className="min-w-0 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10"
          >
            <span className="block text-xs text-muted">
              {daily.shakes.length > 1 ? "Shakes, one a day in turn" : "Daily shake"}
            </span>
            <span className="line-clamp-2 block font-medium">
              {daily.shakes.length > 1
                ? daily.shakes.map((k) => nameOf(k).replace(/ oat shake$/i, "")).join(", ")
                : nameOf(daily.shake)}
            </span>
          </button>
        </div>
        {nothing > 0 && (
          <p className="text-xs text-sand">
            {nothing === 1 ? "One meal has" : `${nothing} meals have`} nothing planned. Tap it below to cook something
            fresh or mark it as eating out.
          </p>
        )}
      </section>

      <section aria-label="Days" className="space-y-3">
        {ordered.map((d) => (
          <article
            key={d.date}
            className={`space-y-2 card-life ${d.past ? "opacity-70" : ""} ${d.today ? "ring-mint/40" : ""}`}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="font-semibold">{d.label}</h3>
              <span className="text-xs text-muted tabular-nums">
                {d.kcal.toLocaleString("en-GB")} kcal · {d.protein} g protein
              </span>
            </header>
            <ul className="divide-y divide-white/5">
              {d.meals.map((m) => {
                const status = logs[m.id];
                const eaten = status === "eaten" || status === "swapped";
                return (
                  <li key={m.id} className="flex min-w-0 items-center gap-3 py-2">
                    <button
                      type="button"
                      // With no meal planned (eating out, say) there is nothing to tick as planned: the
                      // tick asks what was eaten instead, once the day has come.
                      disabled={!m.recipe && !eaten && d.date > today}
                      onClick={() =>
                        eaten
                          ? tick(d, m, null)
                          : m.recipe
                            ? tick(d, m, "eaten")
                            : setPicker({ kind: "meal", day: d, meal: m, other: true })
                      }
                      aria-pressed={eaten}
                      aria-label={
                        eaten
                          ? `Untick ${SLOT_LABEL[m.slot]}`
                          : m.recipe
                            ? `Ate ${SLOT_LABEL[m.slot]}`
                            : `Log ${SLOT_LABEL[m.slot]}`
                      }
                      className={`tap size-11 shrink-0 rounded-full text-lg ring-1 ${eaten ? "bg-mint text-primary ring-mint" : status === "skipped" ? "bg-white/5 text-faint ring-white/10" : "bg-white/5 text-transparent ring-white/20 hover:text-mint/60"} disabled:opacity-30`}
                    >
                      {status === "skipped" ? "–" : "✓"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPicker({ kind: "meal", day: d, meal: m })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs text-muted tabular-nums">{m.time}</span>
                        <span className="text-xs font-medium tracking-wide text-body uppercase">
                          {SLOT_LABEL[m.slot]}
                        </span>
                      </span>
                      <span
                        className={`line-clamp-2 block ${m.name ? "" : "text-sand"} ${status === "skipped" ? "line-through opacity-60" : ""}`}
                      >
                        {m.name ?? (m.source === "out" ? "Eating out" : "Nothing planned")}
                      </span>
                      {m.storage === "freezer" && m.source !== "fresh" && (
                        <span className="block text-xs text-sky-300">From the freezer: defrost {m.defrost} night</span>
                      )}
                      {m.source === "fresh" && <span className="block text-xs text-sand">Cook fresh</span>}
                      {status === "swapped" && <span className="block text-xs text-mint">Ate something else</span>}
                    </button>
                    {m.recipe && <span className="shrink-0 text-right text-xs text-faint tabular-nums">{m.kcal}</span>}
                  </li>
                );
              })}
            </ul>
            {d.notes.length > 0 && (
              <ul className="space-y-1 border-t border-white/5 pt-2 text-xs text-sky-300">
                {d.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <Sheet
        open={picker?.kind === "swap" || picker?.kind === "daily" || picker?.kind === "fresh"}
        onClose={close}
        title={
          picker?.kind === "fresh"
            ? "Cook something fresh"
            : picker?.kind === "daily"
              ? picker.slot === "shake"
                ? "Daily shake"
                : "Quick breakfast"
              : "Swap this recipe"
        }
      >
        {picker && (picker.kind === "swap" || picker.kind === "daily" || picker.kind === "fresh") && (
          <AltList
            list={
              picker.kind === "fresh"
                ? options.fresh
                : picker.kind === "daily"
                  ? picker.slot === "shake"
                    ? options.shake
                    : options.breakfast.filter((a) => a.daily)
                  : picker.meal === "breakfast"
                    ? options.breakfast
                    : options.main
            }
            current={picker.kind === "fresh" ? null : picker.current}
            onPick={async (key) => {
              const r =
                picker.kind === "swap"
                  ? await swapCook(start, picker.cookId, key)
                  : picker.kind === "daily"
                    ? await setDaily(start, picker.slot, key)
                    : await setFresh(start, picker.day.date, picker.meal.slot, key);
              if (r.error) toast(r.error, { tone: "error" });
              else close();
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={picker?.kind === "meal"}
        onClose={close}
        title={picker?.kind === "meal" ? `${picker.day.label}: ${SLOT_LABEL[picker.meal.slot]}` : ""}
      >
        {picker?.kind === "meal" && picker.other && (
          <div className="space-y-2">
            <p className="text-sm text-body">
              How did it compare with {picker.meal.name ? "the planned meal" : "a usual meal"}? A rough size is enough.
            </p>
            {OTHER_CHOICES.map((size) => (
              <button
                key={size}
                type="button"
                className="btn-soft w-full justify-start"
                onClick={() => (tick(picker.day, picker.meal, "swapped", size), close())}
              >
                {OTHER_LABEL[size]}
              </button>
            ))}
            <p className="text-xs text-muted">
              {picker.meal.recipe
                ? "The planned portion stays in the kitchen, and the day still counts the food."
                : "The day counts the food, as an estimate."}
            </p>
          </div>
        )}
        {picker?.kind === "meal" && !picker.other && (
          <div className="space-y-2">
            {picker.meal.recipe && (
              <Link
                href={`/life/recipes/${picker.meal.recipe}`}
                className="btn-soft w-full justify-start"
                onClick={close}
              >
                Open the recipe: {picker.meal.name}
              </Link>
            )}
            {picker.meal.recipe && picker.day.date <= today && (
              <button
                type="button"
                className="btn-soft w-full justify-start"
                onClick={() => (tick(picker.day, picker.meal, "skipped"), close())}
              >
                I skipped it
              </button>
            )}
            {picker.day.date <= today && logs[picker.meal.id] !== "swapped" && (
              <button
                type="button"
                className="btn-soft w-full justify-start"
                onClick={() => setPicker({ ...picker, other: true })}
              >
                I ate something else
              </button>
            )}
            {logs[picker.meal.id] && (
              <button
                type="button"
                className="btn-soft w-full justify-start"
                onClick={() => (tick(picker.day, picker.meal, null), close())}
              >
                Clear what I logged
              </button>
            )}
            {picker.meal.slot !== "shake" && (
              <button
                type="button"
                className="btn-soft w-full justify-start"
                onClick={() => setPicker({ kind: "fresh", day: picker.day, meal: picker.meal })}
              >
                Cook something fresh instead
              </button>
            )}
            {picker.meal.slot !== "shake" && (
              <ActionButton
                action={async () => {
                  const r = await setOut(start, picker.meal.id, picker.meal.source !== "out");
                  if (!r.error) close();
                  return r;
                }}
                className="btn-soft w-full justify-start"
              >
                {picker.meal.source === "out" ? "Not eating out after all" : "I'm eating out"}
              </ActionButton>
            )}
            {picker.meal.source === "fresh" && (
              <ActionButton
                action={async () => {
                  const r = await setFresh(start, picker.day.date, picker.meal.slot, null);
                  if (!r.error) close();
                  return r;
                }}
                className="btn-soft w-full justify-start"
              >
                Back to the batch plan
              </ActionButton>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function AltList({
  list,
  current,
  onPick,
}: {
  list: Alt[];
  current: string | null;
  onPick: (key: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!list.length) return <p className="text-sm text-muted">Nothing else fits your food rules and kit.</p>;
  return (
    <ul className="space-y-2">
      {list.map((a) => (
        <li key={a.key}>
          <button
            type="button"
            disabled={a.key === current || busy !== null}
            onClick={async () => {
              setBusy(a.key);
              await onPick(a.key);
              setBusy(null);
            }}
            className={`w-full min-w-0 rounded-xl p-3 text-left ring-1 transition ${a.key === current ? "bg-mint/10 ring-mint/30" : "bg-white/5 ring-white/5 hover:bg-white/10"} ${busy === a.key ? "opacity-60" : ""}`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 font-medium">{a.name}</span>
              {a.stars ? <Stars value={a.stars} size="text-xs" /> : a.explore ? <Chip tone="sand">New</Chip> : null}
            </span>
            <span className="block text-xs text-muted tabular-nums">
              {a.cuisine} · {a.kcal} kcal · {a.protein} g · {a.minutes} min · about {pounds(a.pence)}
            </span>
            {a.reasons.length > 0 && <span className="block text-xs text-mint">{a.reasons.join(" · ")}</span>}
            {a.key === current && <span className="block text-xs text-mint">On the plan</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
