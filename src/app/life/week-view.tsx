"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import type { Slot } from "@/lib/life/nutrition";
import { logMeal, planWeek, removeCook, setDaily, setFresh, setOut, swapCook } from "./actions";
import { ActionButton, Sheet, Stars } from "./kit";

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
  }[];
};
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

type Picker =
  | { kind: "swap"; cookId: string; meal: "main" | "breakfast"; current: string }
  | { kind: "daily"; slot: "breakfast" | "shake"; current: string }
  | { kind: "meal"; day: DayView; meal: MealView }
  | { kind: "fresh"; day: DayView; meal: MealView }
  | null;

export function WeekView({
  start,
  today,
  groups,
  days,
  nothing,
  daily,
  options,
  canReplan,
}: {
  start: string;
  today: string;
  groups: CookGroup[];
  days: DayView[];
  nothing: number;
  daily: { breakfast: string; shake: string; shakes: string[] };
  options: { main: Alt[]; breakfast: Alt[]; shake: Alt[]; fresh: Alt[] };
  canReplan: boolean;
}) {
  const [picker, setPicker] = useState<Picker>(null);
  const [, start_] = useTransition();
  const [logs, setLog] = useOptimistic(
    Object.fromEntries(days.flatMap((d) => d.meals.map((m) => [m.id, m.status]))) as Record<string, MealView["status"]>,
    (current, change: { id: string; status: MealView["status"] }) => ({ ...current, [change.id]: change.status }),
  );
  const close = () => setPicker(null);
  const nameOf = (key: string) => [...options.breakfast, ...options.shake].find((a) => a.key === key)?.name ?? key;

  const tick = (day: DayView, meal: MealView, status: "eaten" | "skipped" | null) =>
    start_(async () => {
      setLog({ id: meal.id, status });
      const r = await logMeal(day.date, meal.slot, status);
      if (r.error) toast(r.error, { tone: "error" });
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
            <ActionButton
              action={() => planWeek(start)}
              className="text-sm text-neutral-400 hover:text-white"
              confirm="Pick a fresh set of recipes for this week?"
              done="Re-planned."
            >
              Pick again
            </ActionButton>
          )}
        </div>
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <p className="eyebrow">{g.label}</p>
            <ul className="space-y-2">
              {g.items.map((c) => (
                <li key={c.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-white/5 p-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/life/recipes/${c.recipe}`} className="line-clamp-2 block font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-neutral-400 tabular-nums">
                      {c.portions}{" "}
                      {c.meal === "breakfast"
                        ? c.portions === 1
                          ? "breakfast"
                          : "breakfasts"
                        : c.portions === 1
                          ? "portion"
                          : "portions"}{" "}
                      · {c.kcal} kcal · {c.protein} g · {c.minutes} min
                      {c.spare > 0 ? ` · ${c.spare} spare to freeze` : ""}
                    </p>
                  </div>
                  {c.cooked ? (
                    <span className="chip bg-mint/10 text-mint ring-mint/25">Cooked</span>
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
                        className="tap text-lg text-neutral-500 hover:text-coral"
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
            <span className="block text-xs text-neutral-400">Quick breakfast when no batch is ready</span>
            <span className="block truncate font-medium">{nameOf(daily.breakfast)}</span>
          </button>
          <button
            type="button"
            onClick={() => setPicker({ kind: "daily", slot: "shake", current: daily.shake })}
            className="min-w-0 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10"
          >
            <span className="block text-xs text-neutral-400">
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
              <span className="text-xs text-neutral-400 tabular-nums">
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
                      disabled={!m.recipe}
                      onClick={() => tick(d, m, eaten ? null : "eaten")}
                      aria-pressed={eaten}
                      aria-label={eaten ? `Untick ${SLOT_LABEL[m.slot]}` : `Ate ${SLOT_LABEL[m.slot]}`}
                      className={`tap h-11 w-11 shrink-0 rounded-full text-lg ring-1 ${eaten ? "bg-mint text-primary ring-mint" : status === "skipped" ? "bg-white/5 text-neutral-500 ring-white/10" : "bg-white/5 text-transparent ring-white/20 hover:text-mint/60"} disabled:opacity-30`}
                    >
                      {status === "skipped" ? "–" : "✓"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPicker({ kind: "meal", day: d, meal: m })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs text-neutral-400 tabular-nums">{m.time}</span>
                        <span className="text-xs font-medium tracking-wide text-neutral-300 uppercase">
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
                    </button>
                    {m.recipe && (
                      <span className="shrink-0 text-right text-xs text-neutral-500 tabular-nums">{m.kcal}</span>
                    )}
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
        {picker?.kind === "meal" && (
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
  if (!list.length) return <p className="text-sm text-neutral-400">Nothing else fits your food rules and kit.</p>;
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
              {a.stars ? (
                <Stars value={a.stars} size="text-xs" />
              ) : a.explore ? (
                <span className="chip shrink-0 bg-sand/10 text-sand ring-sand/25">New</span>
              ) : null}
            </span>
            <span className="block text-xs text-neutral-400 tabular-nums">
              {a.cuisine} · {a.kcal} kcal · {a.protein} g · {a.minutes} min
            </span>
            {a.reasons.length > 0 && <span className="block text-xs text-mint">{a.reasons.join(" · ")}</span>}
            {a.key === current && <span className="block text-xs text-mint">On the plan</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
