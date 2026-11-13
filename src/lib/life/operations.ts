import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { INGREDIENTS, isSainsburysProduct, type Unit } from "./ingredients";
import { loadLife } from "./load";
import type { Slot } from "./nutrition";
import { parseProfile, plannerRoutine, type LifeProfile } from "./profile";
import { cookScale, sizeCooks, type WeekPlan } from "./planner";
import { recipe } from "./recipes";
import { buildList, cookUse, delivery, weekNeeds, type Product } from "./shopping";
import { placedMacros, remainingNeeds, unlogged, weekView, type LifeState, type WeekView } from "./state";
import * as store from "./store";
import { suggestWeek } from "./suggest";
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

async function savePlan(s: LifeState, plan: WeekPlan) {
  const sized = { ...plan, cooks: sizeCooks(plan, plannerRoutine(s.profile), s.kcal) };
  await store.savePlan(plan.start, sized);
  return sized;
}

/** Fills the week from the menu in one go. Replaces any plan not yet cooked from. */
export function planWeek(start?: string): Promise<Result<{ start: string }>> {
  return run(async () => {
    const s = await state();
    const week = start ?? s.weekStart;
    const existing = s.plans.find((p) => p.start === week)?.data;
    if (existing && s.batches.some((b) => b.planStart === week))
      fail("You've cooked from this week already. Swap recipes one at a time instead.");
    const spare = Object.fromEntries(s.stock.filter((x) => x.qty > 0).map((x) => [x.item, x.qty]));
    const plan = suggestWeek(s.profile, week, s.ratings, s.lastHad, spare, s.today);
    if (!plan.cooks.length) fail("No recipes fit your food rules and kit yet. Check Food rules in Settings.");
    await savePlan(s, {
      ...plan,
      shop: existing?.shop,
      createdOn: existing?.createdOn && existing.createdOn < s.today ? existing.createdOn : s.today,
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
    if (s.batches.some((b) => b.planStart === start && b.cookId === cookId)) fail("That one is cooked already.");
    if (recipe(c!.recipe)?.meal !== r!.meal) fail("Swap a main for a main and a breakfast for a breakfast.");
    c!.recipe = recipeKey;
    c!.portions = 0;
  });
}

export function addCook(start: string, recipeKey: string, date: string, minutes: number): Promise<Result> {
  return editPlan(start, (plan) => {
    const r = recipe(recipeKey);
    if (!r) fail("Unknown recipe.");
    plan.cooks.push({
      id: `${date}-${recipeKey}-${Date.now() % 100000}`,
      recipe: recipeKey,
      date,
      start: minutes,
      portions: 0,
      scale: 1,
    });
  });
}

export function removeCook(start: string, cookId: string): Promise<Result> {
  return editPlan(start, (plan, s) => {
    if (s.batches.some((b) => b.planStart === start && b.cookId === cookId))
      fail("That one is cooked already: undo the cook in the Kitchen first.");
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
    const cooked = new Set(s.batches.filter((b) => b.planStart === start && b.cookId).map((b) => b.cookId!));
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

/** Logs a planned meal as eaten or skipped, taking the portion from its batch. */
export function logMeal(day: string, slot: Slot, status: "eaten" | "skipped" | null): Promise<Result> {
  return run(async () => {
    const s = await state();
    const p = s.placements.find((x) => x.date === day && x.slot === slot);
    const m = p ? placedMacros(p) : null;
    // Meals made on the spot (breakfasts, shakes, fresh dinners) use the cupboard as they are eaten.
    const before = s.meals.find((x) => x.day === day && x.slot === slot)?.status;
    const r = p?.recipe ? recipe(p.recipe) : undefined;
    if (r && p && (p.source === "daily" || p.source === "fresh")) {
      const was = before === "eaten";
      const now = status === "eaten";
      if (was !== now)
        await store.changeStock(
          cookUse(r, 1, p.scale).map((u) => ({ item: u.item, qty: now ? -u.qty : u.qty })),
          "add",
        );
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
    return {};
  });
}

/** Every planned meal before today with nothing logged, as eaten. */
export function logPastAsEaten(): Promise<Result<{ count: number }>> {
  return run(async () => {
    const s = await state();
    const todo = unlogged(s, s.today);
    for (const p of todo) {
      const m = placedMacros(p);
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
    return { count: todo.length };
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

/** Logs a planned cook: portions into the fridge (the later ones into the freezer), ingredients out of stock. */
export function cookPlanned(start: string, cookId: string): Promise<Result> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    const c = plan?.cooks.find((x) => x.id === cookId);
    const r = c ? recipe(c.recipe) : undefined;
    if (!plan || !c || !r) fail("That cook is not in the plan.");
    const placed = viewFor(s, start)?.placements.filter((p) => p.cookId === cookId) ?? [];
    const frozen = placed.filter((p) => p.storage === "freezer").length;
    // Portions nobody is down to eat this week go in the freezer if they can.
    const spare = Math.max(0, c!.portions - placed.length);
    const freeze = frozen + (r!.keeps.freezes ? spare : 0);
    await store.cook({
      recipe: r!.key,
      day: s.today < c!.date ? s.today : c!.date,
      portions: c!.portions,
      scale: c!.scale,
      freeze,
      used: cookUse(r!, c!.portions, c!.scale),
      planStart: start,
      cookId,
    });
    return {};
  });
}

/** Cooks something off-plan, for food made on a whim. */
export function cookExtra(recipeKey: string, portions: number): Promise<Result> {
  return run(async () => {
    const s = await state();
    const r = recipe(recipeKey);
    if (!r) fail("Unknown recipe.");
    if (!(portions >= 1 && portions <= 20)) fail("Between 1 and 20 portions.");
    const scale = cookScale(r!, s.kcal);
    await store.cook({ recipe: r!.key, day: s.today, portions, scale, freeze: 0, used: cookUse(r!, portions, scale) });
    return {};
  });
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

export function markOrdered(start: string, ordered: boolean): Promise<Result> {
  return editPlan(start, (plan, s) => {
    plan.shop = { ...plan.shop, orderedOn: ordered ? s.today : undefined };
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
    const lines = buildList(needs, s.stock, s.products, s.profile.food, s.today);
    const changes = delivery(lines, got, s.today);
    if (changes.length)
      await store.changeStock(
        changes.map((c) => ({
          item: c.item,
          qty: c.add,
          ...(c.status ? { status: c.status } : {}),
          ...(c.goodUntil ? { good_until: c.goodUntil } : {}),
        })),
        "add",
      );
    const added = changes.filter((c) => c.add > 0).map((c) => ({ item: c.item, qty: c.add }));
    await store.savePlan(start, { ...plan!, shop: { ...plan!.shop, deliveredOn: s.today, got, added } });
    return { added: changes.length };
  });
}

export function undoDelivery(start: string): Promise<Result> {
  return run(async () => {
    const s = await state();
    const plan = s.plans.find((p) => p.start === start)?.data;
    if (!plan?.shop?.deliveredOn) fail("No delivery to undo.");
    const back = plan!.shop!.added ?? [];
    if (back.length)
      await store.changeStock(
        back.map((c) => ({ item: c.item, qty: -c.qty })),
        "add",
      );
    await store.savePlan(start, {
      ...plan!,
      shop: { ...plan!.shop, deliveredOn: undefined, got: undefined, added: undefined },
    });
    return {};
  });
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
    if (!INGREDIENTS.has(input.item)) fail("Unknown ingredient.");
    const url = input.url.trim().split("?")[0];
    if (!isSainsburysProduct(url)) fail("Paste a Sainsbury's product link (sainsburys.co.uk/gol-ui/product/…).");
    if (!(input.packQty > 0)) fail("Give the pack size.");
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
