import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/access";
import { addDays, shortDate } from "@/lib/dates/week";
import { labelTags, TAG_LABELS } from "@/lib/life/allergens";
import { INGREDIENTS } from "@/lib/life/ingredients";
import { linkDisagrees, packUnits } from "@/lib/life/pack";
import { lifeMinutes, loadLife } from "@/lib/life/load";
import { EARLIEST, LATEST, SHOP_MINUTES } from "@/lib/life/shop-move";
import { loadToday } from "@/lib/money/load";
import { freezeCount } from "@/lib/life/planner";
import { recipe, RECIPES } from "@/lib/life/recipes";
import {
  amount,
  AISLES,
  buildList,
  listTotal,
  money,
  packLabel,
  pastItsDate,
  soonToUse,
  spareUntil,
  type ListLine,
} from "@/lib/life/shopping";
import { cookedIds, kitchenFor, remainingNeeds, tripLists, weekView, type WeekView } from "@/lib/life/state";
import type { AgendaItem } from "@/lib/life/agenda";
import { attempt } from "@/lib/portal/data";
import { loadScheduleWeek, resolveWeek } from "@/lib/portal/schedule";
import Link from "next/link";
import { eligible, sessionDates } from "@/lib/life/suggest";
import { ErrorNote, Tabs } from "@/components/ui";
import { clock, dayLabel, LifeHeader, weekdayShort, weekRange } from "../parts";
import { CupboardView, DoneTrips, FridgeView, ShopView, type ShopLine } from "./views";

export const metadata: Metadata = { title: "Kitchen" };
export const dynamic = "force-dynamic";

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; week?: string }>;
}) {
  const [, loaded, { tab = "shop", week }, money] = await Promise.all([
    requireOwner(),
    loadLife(),
    searchParams,
    loadToday(),
  ]);
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
  const past = pastItsDate(s.stock, s.today);
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
            <Link
              href={`/life/kitchen?tab=${current}${which === "next" ? "" : "&week=next"}`}
              className="text-sm text-mint hover:underline"
            >
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
          { key: "cupboard", label: "Cupboard", href: q("cupboard"), count: soon.length + past.length },
        ]}
      />
      {current === "shop" && (
        <Shop key={v.start} s={s} v={v} weekLeft={which === "this" ? (money?.view.week.left ?? null) : null} />
      )}
      {current === "fridge" && <Fridge s={s} v={v} />}
      {current === "cupboard" && <Cupboard s={s} soon={soon.map((x) => x.item)} past={past.map((x) => x.item)} />}
    </div>
  );
}

type S = NonNullable<Awaited<ReturnType<typeof loadLife>>["state"]>;

/** weekLeft: what's left of this week's amount in Money, so a shop shows what it leaves. */
function Shop({ s, v, weekLeft }: { s: S; v: WeekView; weekLeft: number | null }) {
  const plan = v.plan;
  if (!plan)
    return (
      <p className="card-life text-sm text-body">
        Plan {v.start === s.weekStart ? "this" : "next"} week on{" "}
        <Link href={v.start === s.weekStart ? "/life" : "/life?week=next"} className="text-mint underline">
          Meals
        </Link>{" "}
        first, and the list builds itself.
      </p>
    );
  if (plan.mode === "fresh") return <FreshShops s={s} v={v} weekLeft={weekLeft} />;
  const delivered = plan.shop?.deliveredOn ?? null;
  const deliveryDay =
    delivered ??
    (s.profile.shopping.deliveryWeekday !== null
      ? nextWeekday(s.today, s.profile.shopping.deliveryWeekday, plan.start)
      : s.today);
  const lines = buildList(remainingNeeds(s, v), kitchenFor(s, v), s.products, s.profile.food, deliveryDay);
  const total = listTotal(lines);
  return (
    <ShopView
      start={plan.start}
      lines={lines.map((l) => shopLine(s, l, deliveryDay))}
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
      unchecked={unchecked(s, lines)}
      ordered={plan.shop?.orderedOn ? shortDate(plan.shop.orderedOn) : null}
      orderedTotal={plan.shop?.orderedPence != null ? money(plan.shop.orderedPence) : null}
      delivered={delivered ? shortDate(delivered) : null}
      deliveryDay={dayLabel(deliveryDay, s.today)}
      ticks={{ ticked: plan.shop?.ticked ?? [], missing: plan.shop?.missing ?? [], via: plan.shop?.via }}
      next={null}
      budgetPence={s.profile.shopping.budgetPence}
      weekLeftPence={weekLeft}
    />
  );
}

/**
 * A fresh week's shops: a list for each one still to do, in date order, and the
 * ones done. The week's food is the done shops' plus the lists still to buy.
 */
function FreshShops({ s, v, weekLeft }: { s: S; v: WeekView; weekLeft: number | null }) {
  const { open, done } = tripLists(s, v);
  const budget = s.profile.shopping.budgetPence;
  const spent = done.reduce((t, x) => t + (x.pence ?? 0), 0);
  const food = new Map(open.map((x) => [x.trip.id, listTotal(x.lines).food]));
  const week = spent + [...food.values()].reduce((t, x) => t + x, 0);
  // What a shop may spend: the week's budget less what's been spent and the other shops' lists.
  const share = (id: string) => (budget === null ? null : budget - week + (food.get(id) ?? 0));
  const titleOf = (id: string | null) => {
    const t = id ? v.plan?.trips?.find((x) => x.id === id) : undefined;
    return t ? tripTitle(t.date) : null;
  };
  // A shop moves within its meal week, from today on; one whose time has gone is missed.
  const now = lifeMinutes(s.today);
  const days: { date: string; label: string }[] = [];
  for (let d = s.today > v.start ? s.today : v.start; d <= addDays(v.start, 6); d = addDays(d, 1))
    days.push({ date: d, label: dayLabel(d, s.today) });
  const missed = (t: { date: string; start: number }) =>
    t.date < s.today || (t.date === s.today && t.start + SHOP_MINUTES <= now);
  // Where Move starts for a missed shop: the next quarter hour today, or tomorrow at its own time once today is over.
  const soon = Math.max(EARLIEST, Math.ceil((now + 1) / 15) * 15);
  const fromNow = (t: { start: number }) =>
    soon <= LATEST ? { date: s.today, start: soon } : { date: addDays(s.today, 1), start: t.start };
  return (
    <div className="space-y-8">
      {done.length > 0 && (
        <DoneTrips
          start={v.start}
          trips={done.map((t) => ({
            id: t.id,
            title: tripTitle(t.date),
            when: `Done ${shortDate(t.doneOn!)}`,
            price: t.pence ? money(t.pence) : null,
          }))}
        />
      )}
      {open.map(({ trip, lines, early, notFound }, i) => {
        const total = listTotal(lines);
        return (
          <ShopView
            key={trip.id}
            start={v.start}
            trip={{
              id: trip.id,
              title: tripTitle(trip.date),
              when: `${dayLabel(trip.date, s.today)} · ${clock(trip.start)}`,
              early,
              date: trip.date,
              start: trip.start,
              // Being ticked off in the shop is under way, not missed.
              missed: missed(trip) && !trip.ticked?.length,
              days,
              ...(missed(trip) ? { offer: fromNow(trip) } : {}),
            }}
            lines={lines.map((l) => shopLine(s, l, trip.date))}
            aisles={AISLES}
            total={{
              price: money(total.pence),
              food: money(total.food),
              cupboard: total.cupboard ? money(total.cupboard) : null,
              estimated: total.estimated,
              packs: total.packs,
              week: money(week),
              budget: budget ? money(budget) : null,
              over: budget !== null && week > budget,
            }}
            unchecked={unchecked(s, lines)}
            ordered={null}
            delivered={null}
            deliveryDay={dayLabel(trip.date, s.today)}
            ticks={{ ticked: trip.ticked ?? [], missing: trip.missing ?? [], via: trip.via }}
            notFound={notFound.map((n) => ({ line: shopLine(s, n.line, trip.date), to: titleOf(n.to) }))}
            next={titleOf(open[i + 1]?.trip.id ?? null)}
            budgetPence={share(trip.id)}
            weekLeftPence={weekLeft}
          />
        );
      })}
      {!open.length && <p className="card-life text-sm text-body">Every shop this week is done.</p>}
    </div>
  );
}

/** "Wednesday's shop". */
function tripTitle(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${day}'s shop`;
}

/** Staples nobody has said anything about yet, for the "Already have any of these?" card. */
function unchecked(s: S, lines: ListLine[]) {
  return lines
    .filter((l) => l.item.staple && l.packs > 0 && !s.stock.some((x) => x.item === l.item.key && x.status))
    .map((l) => ({ item: l.item.key, name: l.item.name }));
}

/** "75 g spare, goes off Sat" or "1.1 kg spare, kept for next week": what the plan does with a pack's rest. */
function spareNote(s: S, l: ListLine, boughtOn: string): string | null {
  if (l.spare <= 0 || l.item.staple) return null;
  const until = spareUntil(
    l,
    s.stock.find((x) => x.item === l.item.key),
    boughtOn,
  );
  return `${amount(l.item, l.spare)} spare, ${until ? `goes off ${weekdayShort(until)}` : "kept for next week"}`;
}

function shopLine(s: S, l: ListLine, boughtOn: string): ShopLine {
  return {
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
    spare: spareNote(s, l, boughtOn),
    link: l.link,
    product: l.product
      ? {
          name: l.product.name,
          url: l.product.url,
          packQty: l.product.packQty,
          packUnit: l.product.packUnit,
          pence: l.product.pence,
          checked: l.product.checked,
        }
      : null,
    checks: l.checks.map((t) => ({ tag: t, label: TAG_LABELS[t] })),
    allChecks: labelTags(s.profile.food, l.item.watch, l.item.compound).map((t) => ({ tag: t, label: TAG_LABELS[t] })),
    freeze: l.freezeOnArrival,
    firstUse: dayLabel(l.firstUse, s.today),
    uses: l.uses,
    staple: Boolean(l.item.staple),
    defaultPack: { qty: l.item.pack.qty, unit: l.item.pack.unit },
    units: packUnits(l.item),
    packCheck: packCheck(l),
  };
}

/** The link's own pack size, when the saved one disagrees with it. */
function packCheck(l: ListLine): string | null {
  const linked = l.product ? linkDisagrees(l.item, l.product) : null;
  return linked ? packLabel(linked.qty, linked.unit) : null;
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
  const cooked = cookedIds(s, plan?.start);
  const left = (plan?.cooks ?? []).filter((c) => !cooked.has(c.id));
  // The Schedule's weeks these cooks fall in, arranged around study and events.
  const weeks = [...new Set(left.map((c) => resolveWeek(c.date).start))];
  const arranged = new Map<string, AgendaItem>();
  for (const w of await Promise.all(
    weeks.map((start) => attempt(() => loadScheduleWeek(resolveWeek(start), { life: { state: s } }))),
  )) {
    if (w.ok) for (const i of w.value.life) if (i.kind === "cook") arranged.set(i.key, i);
  }
  // The sessions the routine has this week; one that isn't is a catch-up for days planned too late.
  const routineSessions = plan
    ? sessionDates(plan.start, s.profile.routine.cooks).map((x) => `${x.date}:${x.start}`)
    : [];
  const groups = new Map<string, typeof left>();
  for (const c of [...left].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
    const key = `${c.date}:${c.start}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const lastDay = plan ? addDays(plan.start, 6) : s.today;
  const days: { date: string; label: string }[] = [];
  for (let d = s.today > (plan?.start ?? s.today) ? s.today : (plan?.start ?? s.today); d <= lastDay; d = addDays(d, 1))
    days.push({ date: d, label: dayLabel(d, s.today) });
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
      cooks: cooks.map((c) => ({
        id: c.id,
        name: recipe(c.recipe)?.name ?? c.recipe,
        recipe: c.recipe,
        portions: c.portions,
        freeze: freezeCount(plan!, c, v.placements),
      })),
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
  return (
    <FridgeView
      start={plan?.start ?? null}
      sessions={sessions}
      days={days}
      batches={batches}
      recipes={recipes.length ? recipes : RECIPES.map((r) => ({ key: r.key, name: r.name }))}
    />
  );
}

function Cupboard({ s, soon, past }: { s: S; soon: string[]; past: string[] }) {
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
        past: past.includes(i.key),
        known: Boolean(st),
      };
    })
    .sort(
      (a, b) =>
        Number(b.past) - Number(a.past) ||
        Number(b.soon) - Number(a.soon) ||
        AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) ||
        a.name.localeCompare(b.name),
    );
  return <CupboardView rows={rows} />;
}
