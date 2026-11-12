import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { addDays } from "@/lib/dates/week";
import { loadLife } from "@/lib/life/load";
import { portionMacros } from "@/lib/life/nutrition";
import { spare, weekDays } from "@/lib/life/planner";
import { recipe } from "@/lib/life/recipes";
import { buildList, listTotal, money } from "@/lib/life/shopping";
import { placedMacros, remainingNeeds, unlogged, weekView, type LifeState, type WeekView as MealWeek } from "@/lib/life/state";
import { rank } from "@/lib/life/suggest";
import { ErrorNote } from "@/components/ui";
import { ActionButton } from "./kit";
import { planWeek, logPastAsEaten } from "./actions";
import { clock, dayLabel, LifeHeader, SetupCard, Tabs, weekRange, weekdayShort } from "./parts";
import { WeekView, type Alt, type CookGroup, type DayView } from "./week-view";
import { CalendarButton } from "./calendar-button";

export const metadata: Metadata = { title: "Meals" };
export const dynamic = "force-dynamic";

export default async function MealsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  // Both start at once: life_read checks for the owner itself.
  const [, loaded, params] = await Promise.all([requireOwner(), loadLife(), searchParams]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Meals" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const which = params.week === "next" ? "next" : "this";
  const v = weekView(s, which);
  const end = addDays(v.start, 6);
  // In the last two days of a week, the next one wants planning and shopping.
  const nudge = which === "this" && !s.next.plan && s.today >= addDays(s.next.start, -2);
  return (
    <div className="space-y-6">
      <LifeHeader eyebrow={weekRange(v.start, end)} title="Meals">
        {s.targets ? (
          <>
            {s.kcal.toLocaleString("en-GB")} kcal and {s.targets.protein} g protein a day. Portions are sized to hit it.
          </>
        ) : (
          "Pick the week's recipes, and the plan works out the cooking, the shopping and the freezer."
        )}
      </LifeHeader>
      {!s.setUp && <SetupCard />}
      <Tabs
        current={which}
        tabs={[
          { key: "this", label: "This week", href: "/life" },
          { key: "next", label: `Next week${s.next.plan ? "" : " · plan it"}`, href: "/life?week=next" },
        ]}
      />
      {nudge && (
        <Link href="/life?week=next" className="card-life flex flex-wrap items-center justify-between gap-3 ring-mint/30 transition hover:ring-mint/50">
          <span className="min-w-0">
            <span className="block font-semibold">Next week starts {dayLabel(s.next.start, s.today).toLowerCase()}</span>
            <span className="text-sm text-neutral-300">Plan it now so the shopping can arrive before the first cook.</span>
          </span>
          <span className="text-sm text-mint">Plan next week →</span>
        </Link>
      )}
      {v.plan ? <Planned key={v.start} s={s} v={v} /> : <Unplanned s={s} v={v} />}
    </div>
  );
}

function alts(s: LifeState, meal: "main" | "breakfast" | "shake", weekend = false): Alt[] {
  const spareStock = Object.fromEntries(s.stock.filter((x) => x.qty > 0).map((x) => [x.item, x.qty]));
  return rank(s.profile, meal, s.ratings, s.lastHad, spareStock, s.today)
    .filter((r) => (weekend ? true : !r.recipe.tags.includes("weekend")))
    .map((r) => {
      const m = portionMacros(r.recipe);
      return {
        key: r.recipe.key,
        name: r.recipe.name,
        cuisine: r.recipe.cuisine,
        minutes: r.recipe.totalMin,
        kcal: Math.round(m.kcal),
        protein: Math.round(m.protein),
        reasons: r.reasons,
        stars: s.ratings.find((x) => x.recipe === r.recipe.key)?.stars ?? null,
        explore: r.recipe.tags.includes("explore"),
        daily: Boolean(r.recipe.daily),
      };
    });
}

function Unplanned({ s, v }: { s: LifeState; v: MealWeek }) {
  const menu = alts(s, "main").slice(0, 6);
  return (
    <section className="card-life space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Plan this week in one tap</h2>
        <p className="text-sm text-neutral-300">
          Picks two recipes for each cook session from what you like, sizes every portion to your target, and works out what goes in the freezer. Swap
          anything afterwards.
        </p>
      </div>
      <ActionButton action={planWeek.bind(null, v.start)} className="btn-life w-full sm:w-auto" done="Planned.">
        Plan {weekRange(v.start, addDays(v.start, 6))}
      </ActionButton>
      {menu.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">Top of your menu</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {menu.map((m) => (
              <li key={m.key} className="min-w-0 rounded-xl bg-white/5 p-3">
                <Link href={`/life/recipes/${m.key}`} className="block font-medium hover:underline">
                  {m.name}
                </Link>
                <p className="text-xs text-neutral-400">
                  {m.cuisine} · {m.kcal} kcal · {m.protein} g protein
                </p>
                {m.reasons[0] && <p className="text-xs text-mint">{m.reasons[0]}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Planned({ s, v }: { s: LifeState; v: MealWeek }) {
  const plan = v.plan!;
  const cooked = new Set(s.batches.filter((b) => b.planStart === plan.start && b.cookId).map((b) => b.cookId!));
  const left = spare(plan, v.placements);
  const groups: CookGroup[] = [];
  for (const c of [...plan.cooks].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    const r = recipe(c.recipe);
    if (!r) continue;
    const key = `${c.date}-${c.start}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: `${dayLabel(c.date, s.today)} · ${clock(c.start)}`, date: c.date, items: [] };
      groups.push(g);
    }
    const m = portionMacros(r);
    g.items.push({
      id: c.id,
      recipe: r.key,
      name: r.name,
      meal: r.meal,
      portions: c.portions,
      kcal: Math.round(m.kcal * c.scale),
      protein: Math.round(m.protein * c.scale),
      minutes: r.totalMin,
      cooked: cooked.has(c.id),
      spare: left.find((x) => x.cookId === c.id)?.portions ?? 0,
    });
  }
  const from = plan.createdOn ?? plan.start;
  const days: DayView[] = weekDays(plan.start).filter((date) => date >= from).map((date) => {
    const meals = v.placements
      .filter((p) => p.date === date)
      .sort((a, b) => a.time - b.time)
      .map((p) => {
        const r = p.recipe ? recipe(p.recipe) : undefined;
        const m = placedMacros(p);
        const log = s.meals.find((x) => x.day === date && x.slot === p.slot);
        return {
          id: p.id,
          slot: p.slot,
          time: clock(p.time),
          recipe: p.recipe,
          name: r?.name ?? null,
          source: p.source,
          storage: p.storage ?? null,
          defrost: p.defrostOn ? weekdayShort(p.defrostOn) : null,
          kcal: m?.kcal ?? 0,
          protein: m?.protein ?? 0,
          status: log?.status ?? null,
        };
      });
    return {
      date,
      label: dayLabel(date, s.today),
      past: date < s.today,
      today: date === s.today,
      meals,
      kcal: meals.reduce((t, m) => t + m.kcal, 0),
      protein: meals.reduce((t, m) => t + m.protein, 0),
      notes: v.reminders.filter((r) => r.date === date && (r.kind === "defrost" || r.kind === "freeze")).map((r) => `${clock(r.time)} · ${r.text}`),
    };
  });
  const lines = buildList(remainingNeeds(s, v), s.stock, s.products, s.profile.food, plan.shop?.deliveredOn ?? null);
  const total = listTotal(lines);
  const missing = v.start === s.weekStart ? unlogged(s, s.today).length : 0;
  const nothing = v.placements.filter((p) => p.source === "none" && p.date >= s.today && (p.slot === "lunch" || p.slot === "dinner")).length;

  return (
    <div className="space-y-6">
      {missing > 0 && (
        <section className="card-life flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {missing} past {missing === 1 ? "meal is" : "meals are"} not ticked.
          </p>
          <ActionButton action={logPastAsEaten} className="btn-life px-4 py-2" done="Logged as eaten.">
            I ate them
          </ActionButton>
        </section>
      )}
      <Link href={v.start === s.weekStart ? "/life/kitchen" : "/life/kitchen?week=next"} className="card-life flex flex-wrap items-center justify-between gap-3 transition hover:ring-mint/30">
        <span className="min-w-0">
          <span className="block font-semibold">{plan.shop?.deliveredOn ? (total.packs ? "Top-ups" : "Shopping is in") : plan.shop?.orderedOn ? "Order placed" : "Shopping list"}</span>
          <span className="text-sm text-neutral-300">
            {plan.shop?.deliveredOn && !total.packs
              ? "Everything for the week is in the kitchen."
              : plan.shop?.deliveredOn
                ? `${total.packs} ${total.packs === 1 ? "thing" : "things"} short since the delivery · ${money(total.pence)}`
                : `${total.packs} ${total.packs === 1 ? "pack" : "packs"} · food ${total.estimated ? "about " : ""}${money(total.food)}${s.profile.shopping.budgetPence ? ` of ${money(s.profile.shopping.budgetPence)}` : ""}${total.cupboard ? ` + ${money(total.cupboard)} cupboard` : ""}`}
          </span>
        </span>
        <span className="text-sm text-mint">Open the list →</span>
      </Link>
      <WeekView
        start={plan.start}
        today={s.today}
        groups={groups}
        days={days}
        nothing={nothing}
        daily={{ breakfast: plan.breakfast, shake: plan.shake, shakes: plan.shakes ?? [] }}
        options={{ main: alts(s, "main"), breakfast: alts(s, "breakfast"), shake: alts(s, "shake"), fresh: alts(s, "main", true) }}
        canReplan={!s.batches.some((b) => b.planStart === plan.start)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <CalendarButton />
        <Link href="/schedule" className="text-sm text-neutral-400 hover:text-white">
          Open the schedule →
        </Link>
      </div>
    </div>
  );
}
