import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { addDays } from "@/lib/dates/week";
import { loadLife } from "@/lib/life/load";
import { portionMacros } from "@/lib/life/nutrition";
import { spare, spareStaysCold, weekDays, type WeekPlan } from "@/lib/life/planner";
import { recipe } from "@/lib/life/recipes";
import { portionCost } from "@/lib/life/combo";
import { buildList, listTotal, money } from "@/lib/life/shopping";
import {
  kitchenFor,
  placedMacros,
  remainingNeeds,
  tripLists,
  unlogged,
  weekView,
  type LifeState,
  type WeekView as MealWeek,
} from "@/lib/life/state";
import { rank } from "@/lib/life/suggest";
import { ErrorNote, Tabs } from "@/components/ui";
import { ActionButton } from "./kit";
import { planWeek } from "./actions";
import { clock, dayLabel, LifeHeader, SetupCard, weekRange, weekdayShort } from "./parts";
import { AteThem, RateEaten, WeekView, type Alt, type CookGroup, type DayView, type WeekCostView } from "./week-view";
import { toRate } from "@/lib/life/to-rate";

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
  // Dishes eaten this week and not rated: a star each, so the planner learns what you like.
  const rateNow =
    which === "this" ? toRate(s.meals, s.ratings, s.today).map((key) => ({ key, name: recipe(key)?.name ?? key })) : [];
  // Next week planned itself when this week's last cook was logged: say so, and where.
  const plannedItself = which === "this" && Boolean(s.next.plan?.auto);
  return (
    <div className="space-y-6">
      <LifeHeader eyebrow={weekRange(v.start, end)} title="Meals">
        {s.targets ? (
          <>
            {s.kcal.toLocaleString("en-GB")} kcal and {s.targets.protein} g protein a day. Portions are sized to hit it.
          </>
        ) : s.setUp ? (
          <>
            Log a weigh-in on{" "}
            <Link href="/life/body" className="text-mint underline">
              Body
            </Link>{" "}
            to work out your targets. Until then portions are sized to {s.kcal.toLocaleString("en-GB")} kcal a day.
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
        <Link
          href="/life?week=next"
          className="flex flex-wrap items-center justify-between gap-3 card-life ring-mint/30 transition hover:ring-mint/50"
        >
          <span className="min-w-0">
            <span className="block font-semibold">
              Next week starts {dayLabel(s.next.start, s.today).toLowerCase()}
            </span>
            <span className="text-sm text-body">Plan it now so the shopping can arrive before the first cook.</span>
          </span>
          <span className="text-sm text-mint">Plan next week →</span>
        </Link>
      )}
      {plannedItself && (
        <Link
          href="/life?week=next"
          className="flex flex-wrap items-center justify-between gap-3 card-life transition hover:ring-mint/30"
        >
          <span className="min-w-0">
            <span className="block font-semibold">Next week is planned</span>
            <span className="text-sm text-body">
              It planned itself once this week&apos;s last cook was done. Swap anything you like.
            </span>
          </span>
          <span className="text-sm text-mint">See next week →</span>
        </Link>
      )}
      {rateNow.length > 0 && <RateEaten dishes={rateNow} />}
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
        pence: portionCost(r.recipe, s.products),
      };
    });
}

function Unplanned({ s, v }: { s: LifeState; v: MealWeek }) {
  const menu = alts(s, "main").slice(0, 6);
  const batchCooks = s.profile.routine.cooks.length;
  const fresh = s.profile.routine.fresh;
  return (
    <section className="space-y-5 card-life">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Plan this week in one tap</h2>
        <p className="text-sm text-body">
          Picks recipes from what you like, sizes every portion to your target, and builds the shopping. Swap anything
          afterwards.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-white/5 p-3">
          <p className="font-medium">Batch week</p>
          <p className="text-sm text-muted">
            {batchCooks} long {batchCooks === 1 ? "cook" : "cooks"} of two dishes and one shop. Some portions go in the
            freezer.
          </p>
          <ActionButton
            action={planWeek.bind(null, v.start, "batch")}
            className="mt-auto btn-life w-full"
            done="Planned a batch week."
          >
            Plan a batch week
          </ActionButton>
        </div>
        <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-white/5 p-3">
          <p className="font-medium">Fresh week</p>
          <p className="text-sm text-muted">
            {fresh.cooks.length} short {fresh.cooks.length === 1 ? "cook" : "cooks"} of one dish and{" "}
            {fresh.trips.length} small {fresh.trips.length === 1 ? "shop" : "shops"}. Nothing goes in the freezer.
          </p>
          <ActionButton
            action={planWeek.bind(null, v.start, "fresh")}
            className="mt-auto btn-soft w-full"
            done="Planned a fresh week."
          >
            Plan a fresh week
          </ActionButton>
        </div>
      </div>
      <p className="text-xs text-faint">
        For {weekRange(v.start, addDays(v.start, 6))}. Change the cook and shop days in{" "}
        <Link href="/life/settings#fresh" className="text-mint underline">
          Settings
        </Link>
        .
      </p>
      {menu.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">Top of your menu</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {menu.map((m) => (
              <li key={m.key} className="min-w-0 rounded-xl bg-white/5 p-3">
                <Link href={`/life/recipes/${m.key}`} className="block font-medium hover:underline">
                  {m.name}
                </Link>
                <p className="text-xs text-muted">
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

/**
 * What the week costs as planned, in two lines: the food and what there is to buy,
 * then what is likely to go off and the price per 1,000 kcal (food only: the cupboard
 * lasts for weeks). Shown until the week's food is bought.
 */
function costView(plan: WeekPlan): WeekCostView | null {
  const c = plan.cost;
  if (!c || plan.shop?.deliveredOn || plan.trips?.some((t) => t.doneOn)) return null;
  const food = c.pence - c.cupboard;
  const shops = plan.mode === "fresh" ? ` over ${c.trips} ${c.trips === 1 ? "shop" : "shops"}` : "";
  const saves = c.cheaper !== undefined ? c.pence + c.waste - c.cheaper : 0;
  return {
    food: `Food about ${money(food)}${c.cupboard ? ` + ${money(c.cupboard)} cupboard` : ""} · ${c.items} ${c.items === 1 ? "thing" : "things"} to buy${shops}`,
    detail: `${c.waste >= 50 ? `About ${money(c.waste)} likely to go off` : "Next to nothing left to go off"}${c.kcal ? ` · ${money(Math.round((food * 1000) / c.kcal))} per 1,000 kcal` : ""}`,
    saves: saves >= 50 ? saves : null,
  };
}

/** A fresh week's shopping in a line: the next shop, and the week against the budget. */
function freshShops(s: LifeState, v: MealWeek): { title: string; detail: string } {
  const { open, done } = tripLists(s, v);
  const next = open.find((t) => t.lines.some((l) => l.packs > 0));
  const spent = done.reduce((t, x) => t + (x.pence ?? 0), 0);
  const ahead = open.reduce((t, x) => t + listTotal(x.lines).food, 0);
  const budget = s.profile.shopping.budgetPence;
  const week = `The week's food ${money(spent + ahead)}${budget ? ` of ${money(budget)}` : ""}`;
  if (!next) return { title: "Shopping is in", detail: `Everything for the week is in the kitchen. ${week}.` };
  const t = listTotal(next.lines);
  const later = open.filter((x) => x !== next && x.lines.some((l) => l.packs > 0)).length;
  return {
    title: `Next shop: ${dayLabel(next.trip.date, s.today)} · ${clock(next.trip.start)}`,
    detail: `${t.packs} ${t.packs === 1 ? "pack" : "packs"} · ${t.estimated ? "about " : ""}${money(t.pence)}${later ? ` · then ${later} more ${later === 1 ? "shop" : "shops"}` : ""} · ${week}`,
  };
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
      spareCold: spareStaysCold(plan, c),
      why: c.why?.[0],
    });
  }
  const from = plan.createdOn ?? plan.start;
  const days: DayView[] = weekDays(plan.start)
    .filter((date) => date >= from)
    .map((date) => {
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
        notes: v.reminders
          .filter((r) => r.date === date && (r.kind === "defrost" || r.kind === "freeze"))
          .map((r) => `${clock(r.time)} · ${r.text}`),
      };
    });
  // The week's kitchen, as its lists see it: next week's is what this week leaves.
  const lines = buildList(
    remainingNeeds(s, v),
    kitchenFor(s, v),
    s.products,
    s.profile.food,
    plan.shop?.deliveredOn ?? null,
  );
  const total = listTotal(lines);
  const shops = plan.mode === "fresh" ? freshShops(s, v) : null;
  const missing = v.start === s.weekStart ? unlogged(s, s.today).length : 0;
  const nothing = v.placements.filter(
    (p) => p.source === "none" && p.date >= s.today && (p.slot === "lunch" || p.slot === "dinner"),
  ).length;

  return (
    <div className="space-y-6">
      {missing > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 card-life">
          <p className="text-sm">
            {missing} past {missing === 1 ? "meal is" : "meals are"} not ticked.
          </p>
          <AteThem />
        </section>
      )}
      <Link
        href={v.start === s.weekStart ? "/life/kitchen" : "/life/kitchen?week=next"}
        className="flex flex-wrap items-center justify-between gap-3 card-life transition hover:ring-mint/30"
      >
        {shops ? (
          <span className="min-w-0">
            <span className="block font-semibold">{shops.title}</span>
            <span className="text-sm text-body">{shops.detail}</span>
          </span>
        ) : (
          <span className="min-w-0">
            <span className="block font-semibold">
              {plan.shop?.deliveredOn
                ? total.packs
                  ? "Top-ups"
                  : "Shopping is in"
                : plan.shop?.orderedOn
                  ? "Order placed"
                  : "Shopping list"}
            </span>
            <span className="text-sm text-body">
              {plan.shop?.deliveredOn && !total.packs
                ? "Everything for the week is in the kitchen."
                : plan.shop?.deliveredOn
                  ? `${total.packs} ${total.packs === 1 ? "thing" : "things"} short since the delivery · ${money(total.pence)}`
                  : `${total.packs} ${total.packs === 1 ? "pack" : "packs"} · food ${total.estimated ? "about " : ""}${money(total.food)}${s.profile.shopping.budgetPence ? ` of ${money(s.profile.shopping.budgetPence)}` : ""}${total.cupboard ? ` + ${money(total.cupboard)} cupboard` : ""}`}
            </span>
          </span>
        )}
        <span className="text-sm text-mint">Open the list →</span>
      </Link>
      <WeekView
        start={plan.start}
        today={s.today}
        groups={groups}
        days={days}
        nothing={nothing}
        daily={{ breakfast: plan.breakfast, shake: plan.shake, shakes: plan.shakes ?? [] }}
        options={{
          main: alts(s, "main"),
          breakfast: alts(s, "breakfast"),
          shake: alts(s, "shake"),
          fresh: alts(s, "main", true),
        }}
        canReplan={!s.batches.some((b) => b.planStart === plan.start)}
        mode={plan.mode ?? "batch"}
        shops={plan.trips?.length ?? 0}
        cost={costView(plan)}
      />
      <p className="text-sm text-muted">
        Your meals, cooking and gym are on the{" "}
        <Link
          href="/schedule"
          className="text-bright underline decoration-white/30 underline-offset-2 hover:text-white"
        >
          Schedule
        </Link>{" "}
        and in Google Calendar. They follow this plan, and move around study when they clash.
      </p>
    </div>
  );
}
