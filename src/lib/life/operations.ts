import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cooksToLog, eatenBeforeCooked, takenFromStock, type CookedNote } from "./cooked";
import { INGREDIENTS, isSainsburysProduct, type Unit } from "./ingredients";
import { lifeMinutes, loadLife } from "./load";
import { SPLIT, type Slot } from "./nutrition";
import { otherMeal, type OtherSize } from "./other-meal";
import { packProblem } from "./pack";
import { parseProfile, plannerRoutine, type LifeProfile } from "./profile";
import {
  cookScale,
  sizeCooks,
  freezeCount,
  type Placement,
  type ShopVia,
  type WeekMode,
  type WeekPlan,
} from "./planner";
import { recipe } from "./recipes";
import {
  buildList,
  cookUse,
  frozenOnArrival,
  goodOn,
  landShop,
  undoOf,
  undoShop,
  weekNeeds,
  type Product,
  type StockRow,
} from "./shopping";
import { countDown, countedDelivery, markByHand, putBack, stapleUse, staplesAhead } from "./staples-count";
import {
  cookBatches,
  cookedIds,
  needsAhead,
  stockFor,
  placedMacros,
  remainingNeeds,
  shouldPlanNext,
  tripLists,
  kitchenFor,
  unlogged,
  weekView,
  type LifeState,
  type WeekView,
} from "./state";
import * as store from "./store";
import { dinnersLeft, suggestPlan } from "./suggest";
import { weekCost, type Kitchen } from "./combo";
import type { Tag } from "./allergens";
import { syncLifeMirror, syncLifeMirrorQuietly } from "./calendar-sync";
import { addDays } from "../dates/week";

// Every change Life makes, shared by the pages' actions and the Claude connector.
// Each returns { error } with a message for people instead of throwing.

export type Result<T = object> = ({ error?: undefined } & T) | { error: string };

function refresh() {
  for (const p of [
    "/",
    "/life",
    "/life/gym",
    "/life/kitchen",
    "/life/cook",
    "/life/body",
    "/life/recipes",
    "/life/settings",
    "/schedule",
  ])
    revalidatePath(p);
}

/**
 * Runs a change and refreshes the pages. `calendar` is for changes that move the
 * plan's times or names (the meal week, the routine, a gym session): the Google
 * Calendar copy is brought up to date once the answer has gone back, so the
 * button does not wait on Google.
 */
async function run<T extends object>(fn: () => Promise<T>, calendar = false): Promise<Result<T>> {
  try {
    const out = await fn();
    refresh();
    if (calendar) after(syncLifeMirrorQuietly);
    return out;
  } catch (e) {
    return {
      error:
        e instanceof store.LifeError
          ? e.message
          : e instanceof Error && e.message.startsWith("Life: ")
            ? e.message.slice(6)
            : "That didn't save. Try again.",
    };
  }
}

/** The meal week starting on `start`, this one or the next. */
function viewFor(s: LifeState, start: string): WeekView | null {
  if (start === s.weekStart) return weekView(s, "this");
  if (start === s.next.start) return weekView(s, "next");
  return null;
}

async function state(): Promise<LifeState> {
  const loaded = await loadLife();
  if (loaded.error !== undefined) throw new Error(`Life: ${loaded.error}`);
  return loaded.state;
}

const fail = (message: string): never => {
  throw new Error(`Life: ${message}`);
};

// ---------------------------------------------------------------- profile

export function saveProfile(profile: LifeProfile): Promise<Result> {
  return run(async () => {
    await store.saveProfile(parseProfile(profile));
    return {};
  }, true);
}

export function logWeight(day: string, kg: number | null): Promise<Result> {
  return run(async () => {
    if (kg !== null && !(kg >= 30 && kg <= 250)) fail("Enter a weight in kg.");
    await store.logWeight(day, kg);
    // The first weigh-in starts the clock on the adaptive target.
    const s = await state();
    if (kg !== null && !s.profile.goal.startedOn)
      await store.saveProfile({ ...s.profile, goal: { ...s.profile.goal, startedOn: day } });
    return {};
  });
}

/** Takes the weekly suggestion: the new target is today's plus the change. */
export function applyAdjustment(): Promise<Result<{ kcal: number }>> {
  return run(async () => {
    const s = await state();
    const change = s.adjustment?.change ?? 0;
    if (!change) fail("There is no change to apply this week.");
    const kcal = s.kcal + change;
    await store.saveProfile({ ...s.profile, goal: { ...s.profile.goal, kcalOverride: kcal } });
    return { kcal };
  });
}

// ---------------------------------------------------------------- plans

/**
 * What the planner needs to size and cost a week: the kitchen as that week finds it
 * (food, and cooked portions it can really use), and your targets.
 */
function kitchenOf(s: LifeState, start: string): Kitchen {
  const v = viewFor(s, start) ?? weekView(s, "this");
  return {
    stock: kitchenFor(s, v),
    products: s.products,
    batches: stockFor(s, v),
    kcal: s.kcal,
    routine: plannerRoutine(s.profile),
    rules: s.profile.food,
  };
}

async function savePlan(s: LifeState, plan: WeekPlan) {
  // Cooked portions already in the kitchen are eaten first, so the cooks make fewer.
  const kitchen = kitchenOf(s, plan.start);
  const sized = { ...plan, cooks: sizeCooks(plan, kitchen.routine, kitchen.kcal, kitchen.batches) };
  // What the week costs, worked out again after each change until its food is bought;
  // after that the kitchen holds the week's food, so the figure would mislead and goes.
  const bought = Boolean(plan.shop?.deliveredOn || plan.trips?.some((t) => t.doneOn));
  const cheaper = plan.cost?.cheaper;
  const cost = bought ? undefined : { ...weekCost(sized, kitchen), ...(cheaper ? { cheaper } : {}) };
  const saved = { ...sized, cost };
  await store.savePlan(plan.start, saved);
  return saved;
}

/**
 * Fills the week from the menu in one go. Replaces any plan not yet cooked from.
 * `mode` picks a batch week or a fresh one; left out, a re-plan keeps the week's mode.
 * `cheaper` picks the cheapest good week rather than the best value. With two days or
 * fewer left, the week gets just those days, lean, whatever the mode (`suggestPlan`).
 * `auto` marks a week that planned itself (`planNextWhenDone`), so the pages say so.
 */
export function planWeek(
  start?: string,
  mode?: WeekMode,
  cheaper = false,
  auto = false,
): Promise<Result<{ start: string }>> {
  return run(async () => {
    const s = await state();
    const week = start ?? s.weekStart;
    const existing = s.plans.find((p) => p.start === week)?.data;
    if (existing && s.batches.some((b) => b.planStart === week))
      fail("You've cooked from this week already. Swap recipes one at a time instead.");
    // What the week can use up: what it finds in the kitchen, still good when it starts.
    const kitchen = kitchenOf(s, week);
    const spare = Object.fromEntries(
      kitchen.stock.filter((x) => x.qty > 0 && goodOn(x, week)).map((x) => [x.item, x.qty]),
    );
    const minute = lifeMinutes(s.today);
    const plan = suggestPlan(
      s.profile,
      week,
      s.ratings,
      s.lastHad,
      spare,
      s.today,
      mode ?? existing?.mode ?? "batch",
      { ...kitchen, cheaper },
      minute,
    );
    if (plan.short && !dinnersLeft(s.profile, week, s.today, minute).length)
      fail("This week has no dinners left to plan. Plan next week instead.");
    if (!plan.cooks.length && !plan.fresh.length)
      fail("No recipes fit your food rules and kit yet. Check Food rules in Settings.");
    const m: WeekMode = plan.mode ?? "batch";
    // Shops already done stay done: what they brought is in the kitchen.
    const done = (existing?.trips ?? []).filter((t) => t.doneOn);
    await savePlan(s, {
      ...plan,
      shop: m === "batch" ? existing?.shop : undefined,
      trips:
        m === "fresh"
          ? [...done, ...(plan.trips ?? []).filter((t) => !done.some((d) => d.date === t.date))].sort(
              (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
            )
          : undefined,
      createdOn: existing?.createdOn && existing.createdOn < s.today ? existing.createdOn : s.today,
      ...(auto ? { auto: true } : {}),
    });
    return { start: week };
  }, true);
}

async function editPlan(start: string, edit: (plan: WeekPlan, s: LifeState) => WeekPlan | void): Promise<Result> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    if (!plan) fail("Plan the week first.");
    // The edit works on a copy, and the copy is what is saved.
    const draft = structuredClone(plan!);
    const next = edit(draft, s) ?? draft;
    await savePlan(s, next);
    return {};
  }, true);
}

export function swapCook(start: string, cookId: string, recipeKey: string): Promise<Result> {
  return editPlan(start, (plan, s) => {
    const c = plan.cooks.find((x) => x.id === cookId);
    const r = recipe(recipeKey);
    if (!c || !r) fail("That recipe or cook is not in the plan.");
    if (cookBatches(s, start, cookId).length) fail("That one is cooked already.");
    if (recipe(c!.recipe)?.meal !== r!.meal) fail("Swap a main for a main and a breakfast for a breakfast.");
    c!.recipe = recipeKey;
    // The planner's reasons and whole-pack portions were for the dish that was there.
    delete c!.round;
    delete c!.why;
    c!.portions = 0;
  });
}

export function removeCook(start: string, cookId: string): Promise<Result> {
  return editPlan(start, (plan, s) => {
    if (cookBatches(s, start, cookId).length) fail("That one is cooked already: undo the cook in the Kitchen first.");
    plan.cooks = plan.cooks.filter((c) => c.id !== cookId);
  });
}

/**
 * Moves a cook session (every recipe in it not cooked yet) to another day or
 * time in the same meal week. Portions are sized again for the days it now feeds.
 */
export function moveCookSession(
  start: string,
  from: { date: string; at: number },
  to: { date: string; at: number },
): Promise<Result> {
  return editPlan(start, (plan, s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to.date) || to.date < start || to.date > addDays(start, 6))
      fail("Pick a day in this meal week.");
    if (to.date < s.today) fail("Pick today or a day still to come.");
    if (!Number.isInteger(to.at) || to.at < 6 * 60 || to.at > 22 * 60) fail("Pick a time between 06:00 and 22:00.");
    const cooked = cookedIds(s, start);
    const moving = plan.cooks.filter((c) => c.date === from.date && c.start === from.at && !cooked.has(c.id));
    if (!moving.length) fail("Nothing left to cook in that session.");
    for (const c of moving) {
      c.date = to.date;
      c.start = to.at;
      c.portions = 0;
    }
  });
}

export function setDaily(start: string, slot: "breakfast" | "shake", recipeKey: string): Promise<Result> {
  return editPlan(start, (plan) => {
    if (!recipe(recipeKey)) fail("Unknown recipe.");
    plan[slot] = recipeKey;
    if (slot === "shake") plan.shakes = undefined;
  });
}

export function setOut(start: string, id: string, out: boolean): Promise<Result> {
  return editPlan(start, (plan) => {
    plan.out = out ? [...new Set([...plan.out, id])] : plan.out.filter((x) => x !== id);
    plan.fresh = plan.fresh.filter((f) => `${f.date}:${f.slot}` !== id);
  });
}

export function setFresh(start: string, date: string, slot: Slot, recipeKey: string | null): Promise<Result> {
  return editPlan(start, (plan) => {
    plan.fresh = plan.fresh.filter((f) => !(f.date === date && f.slot === slot));
    plan.out = plan.out.filter((x) => x !== `${date}:${slot}`);
    if (recipeKey) {
      if (!recipe(recipeKey)) fail("Unknown recipe.");
      plan.fresh.push({ date, slot, recipe: recipeKey });
    }
  });
}

// ---------------------------------------------------------------- eating

/** What was put in the log for a meal eaten in place of the planned one: an estimate. */
export type MealEstimate = { kcal: number; protein: number | null };

/**
 * Logs a meal: eaten as planned (the portion comes out of its batch), skipped, or
 * `swapped`, something else eaten in its place. A swapped meal takes nothing from the
 * fridge, freezer or cupboard, and counts as food eaten: an estimate from the planned
 * meal and `size` (other-meal.ts). Null clears the log.
 */
export function logMeal(
  day: string,
  slot: Slot,
  status: "eaten" | "skipped" | "swapped" | null,
  size: OtherSize = "about",
): Promise<Result<{ estimate?: MealEstimate; cooked?: CookedNote[]; planningNext?: boolean }>> {
  return run(async () => {
    let s = await state();
    let p = s.placements.find((x) => x.date === day && x.slot === slot);
    // Eaten from a planned cook that wasn't logged: it was cooked, so log it first and
    // the portion comes out of its batch like any other.
    const cooked = status === "eaten" && p ? await logCooks(s, s.weekStart, cooksToLog([p])) : [];
    const planningNext =
      cooked.length > 0 &&
      planNextWhenDone(
        s,
        cooked.map((c) => c.cookId),
      );
    if (cooked.length) {
      s = await state();
      p = s.placements.find((x) => x.date === day && x.slot === slot);
    }
    const m = p ? placedMacros(p) : null;
    const before = s.meals.find((x) => x.day === day && x.slot === slot)?.status;
    await eatFromCupboard(s, p, before === "eaten", status === "eaten");
    if (status === "swapped") {
      // No recipe and no batch: the planned portion stays where it is, to be offered again.
      // With no meal planned for the slot, its share of the day's targets stands in.
      const other = otherMeal(size, m, {
        kcal: s.kcal * SPLIT[slot],
        protein: s.targets ? s.targets.protein * SPLIT[slot] : null,
      });
      await store.logMeal({ day, slot, status, recipe: null, batch: null, ...other });
      return { estimate: { kcal: other.kcal, protein: other.protein } };
    }
    await store.logMeal({
      day,
      slot,
      status,
      recipe: p?.recipe ?? null,
      batch: status === "eaten" ? (p?.batchGid ?? null) : null,
      kcal: status === "eaten" ? (m?.kcal ?? null) : null,
      protein: status === "eaten" ? (m?.protein ?? null) : null,
    });
    return cooked.length ? { cooked, ...(planningNext ? { planningNext } : {}) } : {};
  });
}

/**
 * Meals made on the spot (breakfasts, shakes, fresh dinners) use the cupboard as they
 * are eaten: their food, and their share of each counted staple, which turns low when
 * it won't last the week ahead (staples-count.ts). Unticking puts them back. Returns
 * the kitchen after, for the next meal in a run.
 */
async function eatFromCupboard(
  s: LifeState,
  p: Placement | undefined,
  was: boolean,
  now: boolean,
  stock: StockRow[] = s.stock,
): Promise<StockRow[]> {
  const r = p?.recipe ? recipe(p.recipe) : undefined;
  if (!r || !p || (p.source !== "daily" && p.source !== "fresh") || was === now) return stock;
  const food = cookUse(r, 1, p.scale);
  const staples = stapleUse(r, 1, p.scale);
  if (!now) {
    await store.changeStock([...food, ...putBack(staples, stock)], "add");
    return stock;
  }
  const ahead = staplesAhead(needsAhead(s, { meal: `${p.date}:${p.slot}` }), s.today);
  const counted = countDown(staples, stock, ahead, s.products);
  await store.changeStock(
    [
      ...food.map((u) => ({ item: u.item, qty: -u.qty })),
      ...counted.taken.map((t) => ({
        item: t.item,
        qty: -t.qty,
        ...(counted.low.includes(t.item) ? { status: "low" as const } : {}),
      })),
    ],
    "add",
  );
  return counted.stock;
}

/**
 * Every planned meal before today with nothing logged, as eaten: the cooks they came
 * from are logged first, and meals made on the spot use the cupboard, as one tick does.
 */
export function logPastAsEaten(): Promise<Result<{ count: number; cooked?: CookedNote[]; planningNext?: boolean }>> {
  return run(async () => {
    const first = await state();
    const cooked = await logCooks(first, first.weekStart, cooksToLog(unlogged(first, first.today)));
    const planningNext =
      cooked.length > 0 &&
      planNextWhenDone(
        first,
        cooked.map((c) => c.cookId),
      );
    const s = cooked.length ? await state() : first;
    const todo = unlogged(s, s.today);
    // Each meal's staples come off what the one before it left.
    let stock = s.stock;
    for (const p of todo) {
      const m = placedMacros(p);
      stock = await eatFromCupboard(s, p, false, true, stock);
      await store.logMeal({
        day: p.date,
        slot: p.slot,
        status: "eaten",
        recipe: p.recipe,
        batch: p.batchGid ?? null,
        kcal: m?.kcal ?? null,
        protein: m?.protein ?? null,
      });
    }
    return cooked.length
      ? { count: todo.length, cooked, ...(planningNext ? { planningNext } : {}) }
      : { count: todo.length };
  });
}

/** "Not for me" hides a recipe from every suggestion; a favourite comes round more often. */
export function setRecipePref(recipeKey: string, kind: "hidden" | "favourites", on: boolean): Promise<Result> {
  return run(async () => {
    if (!recipe(recipeKey)) fail("Unknown recipe.");
    const s = await state();
    const other = kind === "hidden" ? "favourites" : "hidden";
    const next = {
      ...s.profile,
      [kind]: [...s.profile[kind].filter((k) => k !== recipeKey), ...(on ? [recipeKey] : [])],
    };
    // A hidden recipe is no favourite, and the other way round.
    if (on) next[other] = s.profile[other].filter((k) => k !== recipeKey);
    await store.saveProfile(next);
    return {};
  });
}

export function rate(recipeKey: string, stars: number | null, note?: string): Promise<Result> {
  return run(async () => {
    if (!recipe(recipeKey)) fail("Unknown recipe.");
    if (stars !== null && !(stars >= 1 && stars <= 5)) fail("Stars go from 1 to 5.");
    await store.rate(recipeKey, stars, note);
    return {};
  });
}

// ---------------------------------------------------------------- kitchen

/**
 * Logs a planned cook: portions into the fridge (the later ones into the freezer),
 * ingredients out of stock. `planningNext`: it was this week's last, so next week is
 * planning itself.
 */
export function cookPlanned(start: string, cookId: string): Promise<Result<{ planningNext: boolean }>> {
  return run(async () => {
    const s = await state();
    await logCook(s, start, cookId);
    return { planningNext: start === s.weekStart && planNextWhenDone(s, [cookId]) };
  });
}

/**
 * Next week plans itself, in this week's mode, once this week's last planned cook is
 * logged and next week has no plan (`shouldPlanNext`, given the state before the cooks
 * were logged). It runs after the answer has gone back, so the tap doesn't wait, and
 * never replaces a plan, even one made in the meantime. Says whether it will.
 */
function planNextWhenDone(s: LifeState, cookedIds: string[]): boolean {
  if (!shouldPlanNext(s, cookedIds)) return false;
  const { start } = s.next;
  const mode = s.plan?.mode ?? "batch";
  after(async () => {
    const now = await loadLife();
    if (now.error !== undefined || now.state.next.start !== start || now.state.next.plan) return;
    const planned = await planWeek(start, mode, false, true);
    if (planned.error !== undefined) console.error("Next week did not plan itself:", planned.error);
  });
  return true;
}

/**
 * Logs a planned cook from the state as loaded, and says where its portions went.
 * Meals from it already logged as eaten (before the cook was) then take their
 * portions, so the fridge holds only what is left.
 */
async function logCook(s: LifeState, start: string, cookId: string): Promise<CookedNote> {
  const plan = s.plans.find((p) => p.start === start)?.data;
  const c = plan?.cooks.find((x) => x.id === cookId);
  const r = c ? recipe(c.recipe) : undefined;
  if (!plan || !c || !r) fail("That cook is not in the plan.");
  const placed = viewFor(s, start)?.placements.filter((p) => p.cookId === cookId) ?? [];
  // The same count the Kitchen and the Cook view show: planned from the freezer, and
  // spare portions if the dish freezes (unless a fresh week keeps them for next week).
  const freeze = freezeCount(plan!, c!, placed);
  const staples = countStaples(s, stapleUse(r!, c!.portions, c!.scale), { start, cook: cookId });
  const batch = await store.cook({
    recipe: r!.key,
    day: s.today < c!.date ? s.today : c!.date,
    portions: c!.portions,
    scale: c!.scale,
    freeze,
    used: [...takenFromStock(cookUse(r!, c!.portions, c!.scale), s.stock), ...staples.taken],
    planStart: start,
    cookId,
  });
  await lowerStaples(staples.low);
  const eatenAlready = s.meals.some(
    (m) =>
      m.status === "eaten" &&
      !m.batchGid &&
      placed.some((p) => p.cookId === cookId && p.date === m.day && p.slot === m.slot),
  );
  if (eatenAlready) {
    const now = await state();
    for (const { placement, meal } of eatenBeforeCooked(viewFor(now, start)?.placements ?? [], now.meals, cookId))
      await store.logMeal({
        day: meal.day,
        slot: meal.slot,
        status: "eaten",
        recipe: meal.recipe,
        batch: placement.batchGid,
        kcal: meal.kcal,
        protein: meal.protein,
        note: meal.note,
      });
  }
  return { cookId, name: r!.name, batch, fridge: c!.portions - freeze, freezer: freeze };
}

/**
 * Logs each of these planned cooks, skipping one already logged (two quick ticks).
 * Each cook reads the kitchen as the one before it left it, so what it records as
 * taken from the cupboard, and Undo puts back, is what really came out.
 */
async function logCooks(s: LifeState, start: string, cookIds: string[]): Promise<CookedNote[]> {
  const out: CookedNote[] = [];
  let now = s;
  for (const [i, id] of cookIds.entries()) {
    if (i > 0) now = await state();
    try {
      out.push(await logCook(now, start, id));
    } catch (e) {
      const again = await state();
      if (!cookBatches(again, start, id).length) throw e;
    }
  }
  return out;
}

/** Cooks something off-plan, for food made on a whim. */
export function cookExtra(recipeKey: string, portions: number): Promise<Result> {
  return run(async () => {
    const s = await state();
    const r = recipe(recipeKey);
    if (!r) fail("Unknown recipe.");
    if (!(portions >= 1 && portions <= 20)) fail("Between 1 and 20 portions.");
    const scale = cookScale(r!, s.kcal);
    const staples = countStaples(s, stapleUse(r!, portions, scale));
    await store.cook({
      recipe: r!.key,
      day: s.today,
      portions,
      scale,
      freeze: 0,
      used: [...takenFromStock(cookUse(r!, portions, scale), s.stock), ...staples.taken],
    });
    await lowerStaples(staples.low);
    return {};
  });
}

/**
 * What a cook takes of the counted staples, from the kitchen as loaded. The batch
 * keeps it with the rest of what the cook used, so Undo cook puts it back.
 * `also` leaves the planned cook being logged out of what the week ahead needs.
 */
function countStaples(
  s: LifeState,
  uses: { item: string; qty: number }[],
  also: { start?: string; cook?: string } = {},
) {
  return countDown(uses, s.stock, staplesAhead(needsAhead(s, also), s.today), s.products);
}

/** Staples a cook left short of the week ahead turn low, so the next list buys them. */
async function lowerStaples(items: string[]) {
  if (!items.length) return;
  await store.changeStock(
    items.map((item) => ({ item, status: "low" as const })),
    "set",
  );
}

export function uncook(batch: string): Promise<Result> {
  return run(async () => {
    await store.uncook(batch);
    return {};
  });
}

export function setBatch(
  batch: string,
  remaining: number | null,
  location: "fridge" | "freezer" | null,
): Promise<Result> {
  return run(async () => {
    await store.setBatch(batch, remaining, location);
    return {};
  });
}

export function setStock(
  changes: { item: string; qty?: number; status?: "have" | "low" | "out" | null; good_until?: string | null }[],
  mode: "add" | "set",
): Promise<Result> {
  return run(async () => {
    for (const c of changes) if (!INGREDIENTS.has(c.item)) fail(`Unknown ingredient ${c.item}.`);
    await store.changeStock(changes, mode);
    return {};
  });
}

/**
 * A cupboard staple marked have, low or out by hand. Have or out on a counted one
 * also stops its count, which no longer says what is there (staples-count.ts).
 */
export function markStaple(item: string, status: "have" | "low" | "out"): Promise<Result> {
  return run(async () => {
    if (!INGREDIENTS.get(item)?.staple) fail(`'${item}' is not a cupboard staple.`);
    if (!["have", "low", "out"].includes(status)) fail("Mark it have, low or out.");
    const s = await state();
    const change = markByHand(
      s.stock.find((r) => r.item === item),
      item,
      status,
    );
    await store.changeStock([change], "set");
    return {};
  });
}

/**
 * Ordered on Sainsbury's, with the trolley total from the checkout if you typed it
 * (pence), or not ordered after all, which clears both.
 */
export function markOrdered(start: string, ordered: boolean, pence: number | null = null): Promise<Result> {
  return editPlan(start, (plan, s) => {
    if (ordered && pence !== null && !(Number.isInteger(pence) && pence >= 0 && pence <= 100_000))
      fail("That total doesn't look right. Type it as it shows at the checkout, like 71.40.");
    plan.shop = {
      ...plan.shop,
      orderedOn: ordered ? s.today : undefined,
      orderedPence: ordered && pence !== null ? pence : undefined,
      ...(ordered ? { via: "online" as const } : {}),
    };
  });
}

/** The delivery came: what arrived goes into stock, fresh food with its use-by. */
export function confirmDelivery(start: string, got: string[]): Promise<Result<{ added: number }>> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    if (!plan) fail("Plan the week first.");
    if (plan!.shop?.deliveredOn) fail("This week's delivery is already in.");
    const v = viewFor(s, start);
    const needs = v ? remainingNeeds(s, v) : weekNeeds(plan!, []);
    const lines = buildList(needs, v ? kitchenFor(s, v) : s.stock, s.products, s.profile.food, s.today);
    const changes = countedDelivery(lines, got, s.today);
    const undo = await landInKitchen(changes, s);
    const frozen = frozenOnArrival(lines, got);
    await store.savePlan(start, {
      ...plan!,
      shop: { ...plan!.shop, deliveredOn: s.today, got, ...undo, ...(frozen.length ? { frozen } : {}) },
    });
    return { added: changes.length };
  });
}

/**
 * Puts a shop into the kitchen (a fresh pack replaces a remainder past its date) and
 * returns what Undo needs to put the kitchen back exactly as it was.
 */
async function landInKitchen(changes: ReturnType<typeof countedDelivery>, s: LifeState) {
  const landed = landShop(changes, s.stock, s.today);
  if (landed.set.length) await store.changeStock(landed.set, "set");
  if (landed.add.length) await store.changeStock(landed.add, "add");
  const { added, restore } = undoOf(changes, s.stock);
  return {
    added,
    ...(restore.length ? { restore } : {}),
    ...(landed.dropped.length ? { dropped: landed.dropped } : {}),
    ...(landed.dates.length ? { dates: landed.dates } : {}),
  };
}

export function undoDelivery(start: string): Promise<Result> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    if (!plan?.shop?.deliveredOn) fail("No delivery to undo.");
    await unshop(plan!.shop!);
    await store.savePlan(start, {
      ...plan!,
      shop: {
        ...plan!.shop,
        deliveredOn: undefined,
        got: undefined,
        added: undefined,
        restore: undefined,
        dropped: undefined,
        dates: undefined,
        frozen: undefined,
      },
    });
    return {};
  });
}

/** Puts the kitchen back as it was before a shop: its food out again, its staples to how they were. */
/** Takes a shop back out of the kitchen, exactly: amounts, staples, dates and the food it replaced. */
async function unshop(record: Parameters<typeof undoShop>[0]) {
  const undo = undoShop(record);
  if (undo.add.length) await store.changeStock(undo.add, "add");
  if (undo.set.length) await store.changeStock(undo.set, "set");
}

/** A fresh week's shop is done: what you got goes into stock, fresh food with its use-by. */
export function confirmTrip(start: string, tripId: string, got: string[]): Promise<Result<{ added: number }>> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    const trip = plan?.trips?.find((t) => t.id === tripId);
    if (!plan || !trip) fail("That shop is not in this week's plan.");
    if (trip!.doneOn) fail("That shop is done already.");
    const v = viewFor(s, start);
    const lines = (v && tripLists(s, v).open.find((t) => t.trip.id === tripId)?.lines) ?? [];
    const changes = countedDelivery(lines, got, s.today);
    const undo = await landInKitchen(changes, s);
    const frozen = frozenOnArrival(lines, got);
    // The week's food, like the list's: cupboard staples last for weeks, so they are left out.
    const pence = lines
      .filter((l) => l.packs > 0 && !l.item.staple && got.includes(l.item.key))
      .reduce((t, l) => t + l.pence, 0);
    await store.savePlan(start, {
      ...plan!,
      trips: plan!.trips!.map((t) =>
        t.id === tripId ? { ...t, doneOn: s.today, got, ...undo, ...(frozen.length ? { frozen } : {}), pence } : t,
      ),
    });
    return { added: changes.length };
  }, true);
}

/**
 * What is in the basket (in person) or the trolley (online), and what the shop
 * didn't have, for a fresh week's shop (`tripId`) or a batch week's one shop (null).
 * The phone sends the whole set each time, in order, so the last tap always wins.
 * `via` says which way the ticks were made, so the list opens that way again.
 */
export function tickShop(
  start: string,
  tripId: string | null,
  ticked: string[],
  missing: string[],
  via?: unknown,
): Promise<Result> {
  const how: { via?: ShopVia } = via === "store" || via === "online" ? { via } : {};
  return run(async () => {
    const items = (xs: unknown) =>
      Array.isArray(xs)
        ? [...new Set(xs.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,60}$/.test(x)))].slice(
            0,
            200,
          )
        : [];
    const got = items(ticked);
    const gone = items(missing).filter((x) => !got.includes(x));
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    if (!plan) fail("Plan the week first.");
    if (tripId === null) {
      if (plan!.shop?.deliveredOn) fail("This week's shopping is in already.");
      await store.savePlan(start, { ...plan!, shop: { ...plan!.shop, ticked: got, missing: gone, ...how } });
      return {};
    }
    const trip = plan!.trips?.find((t) => t.id === tripId);
    if (!trip) fail("That shop is not in this week's plan.");
    if (trip!.doneOn) fail("That shop is done already.");
    await store.savePlan(start, {
      ...plan!,
      trips: plan!.trips!.map((t) => (t.id === tripId ? { ...t, ticked: got, missing: gone, ...how } : t)),
    });
    return {};
  });
}

export function undoTrip(start: string, tripId: string): Promise<Result> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    const trip = plan?.trips?.find((t) => t.id === tripId);
    if (!plan || !trip?.doneOn) fail("No shop to undo.");
    await unshop(trip!);
    await store.savePlan(start, {
      ...plan!,
      trips: plan!.trips!.map((t) => (t.id === tripId ? { id: t.id, date: t.date, start: t.start } : t)),
    });
    return {};
  }, true);
}

export function saveProduct(input: {
  item: string;
  url: string;
  name: string;
  packQty: number;
  packUnit: Unit;
  pence: number | null;
  checked: Tag[];
}): Promise<Result> {
  return run(async () => {
    const item = INGREDIENTS.get(input.item);
    if (!item) fail("Unknown ingredient.");
    const url = input.url.trim().split("?")[0];
    if (!isSainsburysProduct(url)) fail("Paste a Sainsbury's product link (sainsburys.co.uk/gol-ui/product/…).");
    const problem = packProblem(item!, input.packQty, input.packUnit);
    if (problem) fail(problem);
    const product: Product = {
      item: input.item,
      url,
      name: input.name.trim() || INGREDIENTS.get(input.item)!.name,
      packQty: input.packQty,
      packUnit: input.packUnit,
      pence: input.pence,
      checked: input.checked,
    };
    await store.saveProduct(product);
    return {};
  });
}

export function removeProduct(item: string): Promise<Result> {
  return run(async () => {
    await store.removeProduct(item);
    return {};
  });
}

// ---------------------------------------------------------------- gym

export function logSet(input: {
  day: string;
  workout: string;
  exercise: string;
  position: number;
  kg: number | null;
  reps: number | null;
  rir: number | null;
}): Promise<Result> {
  return run(async () => {
    if (input.reps !== null && !(input.reps >= 0 && input.reps <= 500)) fail("Reps look wrong.");
    if (input.kg !== null && !(input.kg >= 0 && input.kg <= 500)) fail("Weight looks wrong.");
    await store.logSet(input);
    return {};
  });
}

export function gymSession(input: {
  day: string;
  workout: string;
  finished?: boolean;
  feel?: number | null;
  notes?: string | null;
  remove?: boolean;
}): Promise<Result> {
  return run(async () => {
    await store.gymSession(input);
    return {};
  }, true);
}

// ---------------------------------------------------------------- calendar

/**
 * Brings the Google Calendar copy of the plan up to date now. It also happens by
 * itself after every change to the plan; this is for when Google was offline.
 */
export async function syncLifeCalendar(): Promise<Result<{ written: number; removed: number; partial: boolean }>> {
  try {
    const r = await syncLifeMirror();
    if ("error" in r) return { error: `${r.error} Reconnect Google Calendar on the Schedule page.` };
    if ("skipped" in r) return { error: `${r.skipped} Connect it on the Schedule page first.` };
    return r;
  } catch (e) {
    // Google's errors already say "Google Calendar: …".
    return { error: e instanceof Error ? e.message : "Google Calendar could not be updated. Try again." };
  }
}
