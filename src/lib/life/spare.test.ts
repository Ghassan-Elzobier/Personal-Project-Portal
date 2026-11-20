import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES } from "./allergens.ts";
import { weekCost, type Kitchen } from "./combo.ts";
import { INGREDIENTS } from "./ingredients.ts";
import { plannerRoutine, DEFAULT_PROFILE, type LifeProfile } from "./profile.ts";
import { sizeCooks } from "./planner.ts";
import { recipe } from "./recipes.ts";
import {
  buildList,
  cookUse,
  delivery,
  kitchenAfter,
  pastItsDate,
  soonToUse,
  spareUntil,
  splitTrips,
  weekNeeds,
  type Need,
  type StockRow,
} from "./shopping.ts";
import { suggestWeek } from "./suggest.ts";

// Spare food counted honestly: the kitchen counts toward a need only while it is
// still good on the day of each use, next week starts from what this week leaves,
// and what the list says is spare is what the cupboard holds after the week.

const row = (item: string, qty: number, goodUntil: string | null = null): StockRow => ({
  item,
  qty,
  status: null,
  goodUntil,
});
const need = (item: string, ...at: [string, number][]): Need => ({
  item,
  qty: at.reduce((t, [, q]) => t + q, 0),
  firstUse: at.map(([d]) => d).sort()[0],
  uses: ["x"],
  at: at.map(([date, qty]) => ({ date, qty, use: "x" })),
});

test("a batch week's list counts the kitchen only while it is good on the day it is used", () => {
  const chicken = [row("chicken-thigh", 300, "2026-11-17")];
  const late = buildList([need("chicken-thigh", ["2026-11-19", 1200])], chicken, [], NO_RULES, null)[0];
  assert.equal(late.have, 0);
  assert.equal(late.packs, 2);
  const soon = buildList([need("chicken-thigh", ["2026-11-16", 1200])], chicken, [], NO_RULES, null)[0];
  assert.equal(soon.have, 300);
  assert.equal(soon.packs, 1);
});

test("the batch list and a one-shop fresh split agree on what the kitchen covers", () => {
  const needs = [need("chicken-thigh", ["2026-11-16", 400], ["2026-11-19", 800]), need("onion", ["2026-11-16", 3])];
  const stock = [row("chicken-thigh", 500, "2026-11-17"), row("onion", 1)];
  const batch = buildList(needs, stock, [], NO_RULES, null);
  const split = splitTrips(needs, [{ id: "sun", date: "2026-11-15" }], stock, []);
  const fresh = buildList(split.trips[0].needs, [], [], NO_RULES, null);
  for (const line of batch) {
    const other = fresh.find((l) => l.item.key === line.item.key);
    assert.equal(other?.packs ?? 0, line.packs, `'${line.item.key}'`);
  }
});

test("spare counts what is left of the kitchen only while it is still good after the last use", () => {
  // In date all week: 1.5 kg in, 400 g used, 1.1 kg spare and nothing bought.
  const kept = buildList([need("basmati", ["2026-11-16", 400])], [row("basmati", 1500)], [], NO_RULES, null)[0];
  assert.equal(kept.packs, 0);
  assert.equal(kept.spare, 1100);
  // Gone off before the use: none of it counts, a pack is bought, and only the pack's rest is spare.
  const gone = buildList(
    [need("chicken-thigh", ["2026-11-19", 400])],
    [row("chicken-thigh", 1500, "2026-11-17")],
    [],
    NO_RULES,
    null,
  )[0];
  assert.equal(gone.have, 0);
  assert.equal(gone.packs, 1);
  assert.equal(gone.spare, 600);
});

test("each spare says when it goes off, or that it keeps for next week", () => {
  const bought = buildList([need("chicken-thigh", ["2026-11-17", 700])], [], [], NO_RULES, "2026-11-16")[0];
  assert.equal(spareUntil(bought, undefined, "2026-11-16"), "2026-11-19");
  const pasta = buildList([need("basmati", ["2026-11-17", 300])], [], [], NO_RULES, "2026-11-16")[0];
  assert.equal(spareUntil(pasta, undefined, "2026-11-16"), null);
  const kept = row("chicken-thigh", 900, "2026-11-18");
  const fromKitchen = buildList([need("chicken-thigh", ["2026-11-17", 400])], [kept], [], NO_RULES, "2026-11-16")[0];
  assert.equal(fromKitchen.packs, 0);
  assert.equal(spareUntil(fromKitchen, kept, "2026-11-16"), "2026-11-18");
});

test("food past its date is not 'use soon': it is listed as past its date", () => {
  const stock = [
    row("spinach", 100, "2026-11-14"),
    row("chicken-thigh", 300, "2026-11-16"),
    row("milk", 500, "2026-11-25"),
    row("basmati", 0, "2026-11-01"),
  ];
  assert.deepEqual(
    soonToUse(stock, "2026-11-15").map((r) => r.item),
    ["chicken-thigh"],
  );
  assert.deepEqual(
    pastItsDate(stock, "2026-11-15").map((r) => r.item),
    ["spinach"],
  );
});

test("next week starts from what this week leaves, and staples keep their have, low or out", () => {
  const stock = [
    row("milk", 2272, "2026-11-25"),
    { item: "olive-oil", qty: 0, status: "have" as const, goodUntil: null },
    row("chicken-thigh", 300, "2026-11-17"),
  ];
  const thisWeek = [
    need("milk", ["2026-11-19", 200], ["2026-11-20", 200], ["2026-11-21", 200]),
    need("olive-oil", ["2026-11-19", 30]),
    // Wanted after it goes off: this week can't use it, so it takes none.
    need("chicken-thigh", ["2026-11-20", 500]),
  ];
  const next = kitchenAfter(stock, thisWeek);
  assert.equal(next.find((r) => r.item === "milk")?.qty, 1672);
  assert.deepEqual(
    next.find((r) => r.item === "olive-oil"),
    stock[1],
  );
  assert.equal(next.find((r) => r.item === "chicken-thigh")?.qty, 300);
});

// A made-up owner with the default routine.
const profile: LifeProfile = { ...DEFAULT_PROFILE, body: { sex: "male", birthYear: 1990, heightCm: 175 } };
const START = "2026-11-22";
const kitchen = (stock: StockRow[] = []): Kitchen => ({
  stock,
  products: [],
  batches: [],
  kcal: 2900,
  routine: plannerRoutine(profile),
  rules: profile.food,
});
const plan = suggestWeek(profile, START, [], {}, {}, START, "batch", kitchen());
const sized = { ...plan, cooks: sizeCooks(plan, plannerRoutine(profile), 2900) };
/** A fresh, non-staple ingredient the planned week cooks with. */
const used = sized.cooks
  .flatMap((c) => recipe(c.recipe)!.lines.map((l) => l.item))
  .find((key) => {
    const ing = INGREDIENTS.get(key)!;
    return !ing.staple && ing.storage === "fridge" && (ing.keeps ?? 99) < 14;
  })!;

test("the week's cost counts no food past its date, and still counts food in date", () => {
  const none = weekCost(sized, kitchen());
  assert.deepEqual(weekCost(sized, kitchen([row(used, 5000, "2026-11-20")])), none);
  const inDate = weekCost(sized, kitchen([row(used, 5000, "2026-12-31")]));
  assert.ok(inDate.pence < none.pence, `'${used}' in date makes the week cheaper`);
});

test("the planner never says it uses food you have when it is past its date", () => {
  const gone = suggestWeek(profile, START, [], {}, {}, START, "batch", kitchen([row(used, 5000, "2026-11-20")]));
  for (const c of gone.cooks) assert.ok(!(c.why ?? []).some((w) => / you have$/.test(w)), `'${c.why}'`);
});

test("what the list says is spare is what the cupboard holds after the week's cooks", () => {
  const needs = weekNeeds(sized, []);
  const lines = buildList(needs, [], [], NO_RULES, START);
  const delivered = new Map(
    delivery(
      lines,
      lines.map((l) => l.item.key),
      START,
    ).map((d) => [d.item, d.add]),
  );
  const usedUp = new Map<string, number>();
  for (const c of sized.cooks)
    for (const u of cookUse(recipe(c.recipe)!, c.portions, c.scale))
      usedUp.set(u.item, (usedUp.get(u.item) ?? 0) + u.qty);
  for (const line of lines.filter((l) => !l.item.staple)) {
    const left = (delivered.get(line.item.key) ?? 0) - (usedUp.get(line.item.key) ?? 0);
    assert.ok(Math.abs(left - line.spare) < 1, `'${line.item.key}': ${left} left, list says ${line.spare}`);
  }
});
