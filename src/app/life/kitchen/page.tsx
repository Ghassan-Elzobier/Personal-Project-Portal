import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { addDays, shortDate } from "@/lib/dates/week";
import { TAG_LABELS } from "@/lib/life/allergens";
import { INGREDIENTS, packFromSlug } from "@/lib/life/ingredients";
import { loadLife } from "@/lib/life/load";
import { recipe, RECIPES } from "@/lib/life/recipes";
import { amount, AISLES, buildList, listTotal, money, packLabel, soonToUse } from "@/lib/life/shopping";
import { remainingNeeds, weekView, type WeekView } from "@/lib/life/state";
import type { AgendaItem } from "@/lib/life/agenda";
import { attempt } from "@/lib/portal/data";
import { loadScheduleWeek, resolveWeek } from "@/lib/portal/schedule";
import Link from "next/link";
import { eligible, sessionDates } from "@/lib/life/suggest";
import { ErrorNote } from "@/components/ui";
import { dayLabel, LifeHeader, Tabs, weekRange } from "../parts";
import { CupboardView, FridgeView, ShopView, type ShopLine } from "./views";

export const metadata: Metadata = { title: "Kitchen" };
export const dynamic = "force-dynamic";

export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string }> }) {
  const [, loaded, { tab = "shop", week }] = await Promise.all([requireOwner(), loadLife(), searchParams]);
  if (loaded.error !== undefined) {
    return (
      <div className="space-y-6">
        <LifeHeader title="Kitchen" />
        <ErrorNote message={loaded.error} />
      </div>
    );
  }
  const s = loaded.state;
  const which = week === "next" ? "next" : "this";
  const v = weekView(s, which);
  const soon = soonToUse(s.stock, s.today);
  const current = ["shop", "fridge", "cupboard"].includes(tab) ? tab : "shop";
  const portions = s.open.reduce((n, b) => n + b.remaining, 0);
  const q = (t: string) => `/life/kitchen?tab=${t}${which === "next" ? "&week=next" : ""}`;

  return (
    <div className="space-y-4">
      <LifeHeader
        eyebrow={`${which === "next" ? "Next week · " : ""}${weekRange(v.start, addDays(v.start, 6))}`}
        title="Kitchen"
        action={
          current !== "cupboard" && (
            <Link href={`/life/kitchen?tab=${current}${which === "next" ? "" : "&week=next"}`} className="text-sm text-mint hover:underline">
              {which === "next" ? "← This week" : "Next week →"}
            </Link>
          )
        }
      />
      <Tabs
        current={current}
        tabs={[
          { key: "shop", label: "Shop", href: q("shop") },
          { key: "fridge", label: "Fridge", href: q("fridge"), count: portions },
          { key: "cupboard", label: "Cupboard", href: q("cupboard"), count: soon.length },
        ]}
      />
      {current === "shop" && <Shop key={v.start} s={s} v={v} />}
      {current === "fridge" && <Fridge s={s} v={v} />}
      {current === "cupboard" && <Cupboard s={s} soon={soon.map((x) => x.item)} />}
    </div>
  );
}

type S = NonNullable<Awaited<ReturnType<typeof loadLife>>["state"]>;

function Shop({ s, v }: { s: S; v: WeekView }) {
  const plan = v.plan;
  if (!plan)
    return (
      <p className="card-life text-sm text-neutral-300">
        Plan {v.start === s.weekStart ? "this" : "next"} week on{" "}
        <Link href={v.start === s.weekStart ? "/life" : "/life?week=next"} className="text-mint underline">
          Meals
        </Link>{" "}
        first, and the list builds itself.
      </p>
    );
  const delivered = plan.shop?.deliveredOn ?? null;
  const deliveryDay = delivered ?? (s.profile.shopping.deliveryWeekday !== null ? nextWeekday(s.today, s.profile.shopping.deliveryWeekday, plan.start) : s.today);
  const lines = buildList(remainingNeeds(s, v), s.stock, s.products, s.profile.food, deliveryDay);
  const total = listTotal(lines);
  const view: ShopLine[] = lines.map((l) => ({
    item: l.item.key,
    name: l.item.name,
    aisle: l.item.aisle,
    need: amount(l.item, l.need),
    have: l.have > 0 ? amount(l.item, l.have) : null,
    packs: l.packs,
    pack: packLabel(l.packQty, l.packUnit),
    pence: l.pence,
    price: money(l.pence),
    estimate: l.priced === "estimate",
    spare: l.spare > 0 && !l.item.staple ? amount(l.item, l.spare) : null,
    link: l.link,
    product: l.product ? { name: l.product.name, url: l.product.url, packQty: l.product.packQty, packUnit: l.product.packUnit, pence: l.product.pence, checked: l.product.checked } : null,
    checks: l.checks.map((t) => ({ tag: t, label: TAG_LABELS[t] })),
    allChecks: (l.item.watch ?? []).map((w) => w.split(":")[0]).filter((t, i, a) => a.indexOf(t) === i && t in TAG_LABELS).map((t) => ({ tag: t, label: TAG_LABELS[t as keyof typeof TAG_LABELS] })),
    freeze: l.freezeOnArrival,
    firstUse: dayLabel(l.firstUse, s.today),
    uses: l.uses,
    staple: Boolean(l.item.staple),
    defaultPack: { qty: l.item.pack.qty, unit: l.item.pack.unit },
    slugPack: l.product ? packFromSlug(l.product.url) : null,
  }));
  return (
    <ShopView
      start={plan.start}
      lines={view}
      aisles={AISLES}
      total={{
        price: money(total.pence),
        food: money(total.food),
        cupboard: total.cupboard ? money(total.cupboard) : null,
        estimated: total.estimated,
        packs: total.packs,
        budget: s.profile.shopping.budgetPence ? money(s.profile.shopping.budgetPence) : null,
        over: s.profile.shopping.budgetPence !== null && total.food > s.profile.shopping.budgetPence,
      }}
      unchecked={lines.filter((l) => l.item.staple && l.packs > 0 && !s.stock.some((x) => x.item === l.item.key && x.status)).map((l) => ({ item: l.item.key, name: l.item.name }))}
      ordered={plan.shop?.orderedOn ? shortDate(plan.shop.orderedOn) : null}
      delivered={delivered ? shortDate(delivered) : null}
      deliveryDay={dayLabel(deliveryDay, s.today)}
    />
  );
}

/** The next given weekday on or after today, but not after the plan starts. */
function nextWeekday(today: string, weekday: number, start: string): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const w = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (w === weekday) return d <= addDays(start, 6) ? d : today;
  }
  return today;
}

/**
 * What is left to cook, by session, at the time the Schedule gives it: the same
 * time, and the same clash, as on the Schedule and in Google Calendar.
 */
async function Fridge({ s, v }: { s: S; v: WeekView }) {
  const plan = v.plan;
  const cooked = new Set(s.batches.filter((b) => plan && b.planStart === plan.start && b.cookId).map((b) => b.cookId!));
  const left = (plan?.cooks ?? []).filter((c) => !cooked.has(c.id));
  // The Schedule's weeks these cooks fall in, arranged around study and events.
  const weeks = [...new Set(left.map((c) => resolveWeek(c.date).start))];
  const arranged = new Map<string, AgendaItem>();
  for (const w of await Promise.all(weeks.map((start) => attempt(() => loadScheduleWeek(resolveWeek(start), { life: { state: s } }))))) {
    if (w.ok) for (const i of w.value.life) if (i.kind === "cook") arranged.set(i.key, i);
  }
  // The sessions the routine has this week; one that isn't is a catch-up for days planned too late.
  const routineSessions = plan ? sessionDates(plan.start, s.profile.routine.cooks).map((x) => `${x.date}:${x.start}`) : [];
  const groups = new Map<string, typeof left>();
  for (const c of [...left].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    const key = `${c.date}:${c.start}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const lastDay = plan ? addDays(plan.start, 6) : s.today;
  const days: { date: string; label: string }[] = [];
  for (let d = s.today > (plan?.start ?? s.today) ? s.today : (plan?.start ?? s.today); d <= lastDay; d = addDays(d, 1)) days.push({ date: d, label: dayLabel(d, s.today) });
  const sessions = [...groups.entries()].map(([key, cooks]) => {
    const { date, start } = cooks[0];
    const a = arranged.get(`${date}:cook:${start}`);
    return {
      key,
      date,
      start,
      when: dayLabel(date, s.today),
      time: a?.start ?? start,
      due: date <= s.today,
      note: a?.moved ?? a?.clash,
      clash: Boolean(a?.clash),
      catchUp: !routineSessions.includes(key) && date === plan?.createdOn,
      cooks: cooks.map((c) => {
        const placed = v.placements.filter((p) => p.cookId === c.id);
        const freeze = placed.filter((p) => p.storage === "freezer").length;
        return {
          id: c.id,
          name: recipe(c.recipe)?.name ?? c.recipe,
          recipe: c.recipe,
          portions: c.portions,
          freeze: freeze + Math.max(0, c.portions - placed.length) * (recipe(c.recipe)?.keeps.freezes ? 1 : 0),
        };
      }),
    };
  });
  const batches = s.open
    .map((b) => {
      const r = recipe(b.recipe);
      const fridgeDays = r?.keeps.fridgeDays ?? 2;
      const eatBy = b.location === "fridge" ? addDays(b.cookedOn, fridgeDays) : addDays(b.cookedOn, 90);
      return {
        gid: b.gid,
        name: r?.name ?? b.recipe,
        recipe: b.recipe,
        cooked: dayLabel(b.cookedOn, s.today),
        remaining: b.remaining,
        portions: b.portions,
        location: b.location,
        eatBy: dayLabel(eatBy, s.today),
        late: b.location === "fridge" && eatBy < s.today,
        soon: b.location === "fridge" && eatBy <= addDays(s.today, 1),
        canFreeze: Boolean(r?.keeps.freezes),
        rice: Boolean(r?.keeps.rice),
      };
    })
    .sort((a, b) => (a.location === b.location ? 0 : a.location === "fridge" ? -1 : 1));
  const recipes = eligible(s.profile, "main")
    .concat(eligible(s.profile, "breakfast").filter((r) => !r.daily))
    .map((r) => ({ key: r.key, name: r.name }));
  return <FridgeView start={plan?.start ?? null} sessions={sessions} days={days} batches={batches} recipes={recipes.length ? recipes : RECIPES.map((r) => ({ key: r.key, name: r.name }))} />;
}

function Cupboard({ s, soon }: { s: S; soon: string[] }) {
  const rows = [...INGREDIENTS.values()]
    .map((i) => {
      const st = s.stock.find((x) => x.item === i.key);
      return {
        item: i.key,
        name: i.name,
        aisle: i.aisle,
        unit: i.unit,
        staple: Boolean(i.staple),
        qty: st?.qty ?? 0,
        amount: st && st.qty > 0 ? amount(i, st.qty) : null,
        status: st?.status ?? null,
        goodUntil: st?.goodUntil ? dayLabel(st.goodUntil, s.today) : null,
        soon: soon.includes(i.key),
        known: Boolean(st),
      };
    })
    .sort((a, b) => Number(b.soon) - Number(a.soon) || AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
  return <CupboardView rows={rows} />;
}
