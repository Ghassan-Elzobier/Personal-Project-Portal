import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RULES, type FoodRules } from "./allergens.ts";
import { isSainsburysProduct, packFromSlug } from "./ingredients.ts";
import { buildList, carryMissing, cookUse, delivery, listTotal, soonToUse, splitTrips, type Need } from "./shopping.ts";

const rules: FoodRules = {
  ...NO_RULES,
  rules: [
    { tag: "soy", level: "avoid" },
    { tag: "egg", level: "avoid", allowForms: ["baked"] },
  ],
};

test("stock comes off and the rest rounds up to packs", () => {
  const needs: Need[] = [
    { item: "chicken-thigh", qty: 1500, firstUse: "2026-11-15", uses: ["x"] },
    { item: "onion", qty: 4, firstUse: "2026-11-15", uses: ["x"] },
  ];
  const lines = buildList(
    needs,
    [{ item: "chicken-thigh", qty: 600, status: null, goodUntil: null }],
    [],
    NO_RULES,
    "2026-11-14",
  );
  const chicken = lines.find((l) => l.item.key === "chicken-thigh")!;
  assert.equal(chicken.packs, 1);
  assert.equal(chicken.spare, 100);
  assert.equal(lines.find((l) => l.item.key === "onion")!.packs, 1);
});

test("staples are bought only when low or out", () => {
  const needs: Need[] = [{ item: "olive-oil", qty: 30, firstUse: "2026-11-15", uses: ["x"] }];
  assert.equal(
    buildList(needs, [{ item: "olive-oil", qty: 0, status: "have", goodUntil: null }], [], NO_RULES, null)[0].packs,
    0,
  );
  assert.equal(
    buildList(needs, [{ item: "olive-oil", qty: 0, status: "low", goodUntil: null }], [], NO_RULES, null)[0].packs,
    1,
  );
});

test("your product's pack and price replace the typical ones", () => {
  const needs: Need[] = [{ item: "chicken-thigh", qty: 900, firstUse: "2026-11-15", uses: ["x"] }];
  const [line] = buildList(
    needs,
    [],
    [
      {
        item: "chicken-thigh",
        url: "https://www.sainsburys.co.uk/gol-ui/product/x-500g",
        name: "X",
        packQty: 500,
        packUnit: "g",
        pence: 400,
        checked: [],
      },
    ],
    NO_RULES,
    null,
  );
  assert.equal(line.packs, 2);
  assert.equal(line.pence, 800);
  assert.equal(line.priced, "yours");
  assert.equal(listTotal([line]).pence, 800);
});

test("label checks follow the rules and drop once confirmed", () => {
  const needs: Need[] = [{ item: "bagel", qty: 5, firstUse: "2026-11-15", uses: ["x"] }];
  assert.deepEqual(buildList(needs, [], [], rules, null)[0].checks, ["soy"]);
  const confirmed = buildList(
    needs,
    [],
    [
      {
        item: "bagel",
        url: "https://www.sainsburys.co.uk/gol-ui/product/bagels",
        name: "B",
        packQty: 5,
        packUnit: "each",
        pence: 125,
        checked: ["soy"],
      },
    ],
    rules,
    null,
  );
  assert.deepEqual(confirmed[0].checks, []);
});

test("fresh meat for a later cook is frozen on arrival", () => {
  const needs: Need[] = [{ item: "beef-mince", qty: 500, firstUse: "2026-11-18", uses: ["x"] }];
  assert.equal(buildList(needs, [], [], NO_RULES, "2026-11-14")[0].freezeOnArrival, true);
  assert.equal(buildList(needs, [], [], NO_RULES, "2026-11-17")[0].freezeOnArrival, false);
});

test("a delivery adds what arrived, a cook takes it away", () => {
  const needs: Need[] = [{ item: "chicken-thigh", qty: 800, firstUse: "2026-11-15", uses: ["x"] }];
  const lines = buildList(needs, [], [], NO_RULES, "2026-11-14");
  assert.deepEqual(delivery(lines, ["chicken-thigh"], "2026-11-14"), [
    { item: "chicken-thigh", add: 1000, status: null, goodUntil: "2026-11-17" },
  ]);
  assert.deepEqual(delivery(lines, [], "2026-11-14"), []);
});

test("cooking uses the recipe at its size, skipping staples", () => {
  // Recipe import is lazy, so read one through the module.
  return import("./recipes.ts").then(({ recipe }) => {
    const use = cookUse(recipe("bolognese")!, 6, 1);
    assert.ok(use.some((u) => u.item === "beef-mince" && u.qty === 1000));
    assert.ok(!use.some((u) => u.item === "oregano"));
  });
});

test("use-soon lists fresh food within two days", () => {
  const rows = soonToUse(
    [
      { item: "spinach", qty: 100, status: null, goodUntil: "2026-11-16" },
      { item: "milk", qty: 500, status: null, goodUntil: "2026-11-25" },
    ],
    "2026-11-15",
  );
  assert.deepEqual(
    rows.map((r) => r.item),
    ["spinach"],
  );
});

test("Sainsbury's product links only, and pack sizes from their slugs", () => {
  assert.ok(
    isSainsburysProduct("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-1kg-british-chicken-thigh-fillets"),
  );
  assert.ok(!isSainsburysProduct("https://evil.example/gol-ui/product/x"));
  assert.ok(!isSainsburysProduct("http://www.sainsburys.co.uk/gol-ui/product/x"));
  assert.deepEqual(
    packFromSlug("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-1kg-british-chicken-thigh-fillets"),
    { qty: 1000, unit: "g" },
  );
  assert.deepEqual(packFromSlug("https://www.sainsburys.co.uk/gol-ui/product/sainsburys-whole-milk-2-27l"), {
    qty: 27000,
    unit: "ml",
  });
});

// A fresh week: shops on Sunday 15 and Wednesday 18 November.
const TRIPS = [
  { id: "wed", date: "2026-11-18" },
  { id: "sun", date: "2026-11-15" },
];
const need = (item: string, ...at: [string, number][]): Need => ({
  item,
  qty: at.reduce((t, [, q]) => t + q, 0),
  firstUse: at.map(([d]) => d).sort()[0],
  uses: ["x"],
  at: at.map(([date, qty]) => ({ date, qty, use: "x" })),
});
const onTrip = (r: ReturnType<typeof splitTrips>, id: string, item: string) =>
  r.trips.find((t) => t.id === id)!.needs.find((n) => n.item === item);

test("shops come in date order, and each item is bought on the last shop before it is used", () => {
  const r = splitTrips([need("chicken-thigh", ["2026-11-20", 800])], TRIPS, [], []);
  assert.deepEqual(
    r.trips.map((t) => t.id),
    ["sun", "wed"],
  );
  // Friday's chicken keeps 3 days: bought on Wednesday, not Sunday.
  assert.equal(onTrip(r, "sun", "chicken-thigh"), undefined);
  assert.equal(onTrip(r, "wed", "chicken-thigh")?.qty, 800);
});

test("one pack for two cooks goes on the earlier shop when it keeps and saves a pack", () => {
  // Peppers keep a week, and one pack of three covers Monday and Friday.
  const r = splitTrips([need("pepper", ["2026-11-16", 1], ["2026-11-20", 1])], TRIPS, [], []);
  assert.equal(onTrip(r, "sun", "pepper")?.qty, 2);
  assert.equal(onTrip(r, "wed", "pepper"), undefined);
});

test("food that keeps for weeks is bought once, on the first shop", () => {
  const r = splitTrips(
    [need("onion", ["2026-11-16", 2], ["2026-11-20", 2]), need("pasta", ["2026-11-19", 300])],
    TRIPS,
    [],
    [],
  );
  assert.equal(onTrip(r, "sun", "onion")?.qty, 4);
  assert.equal(onTrip(r, "sun", "pasta")?.qty, 300);
  assert.equal(r.trips.find((t) => t.id === "wed")!.needs.length, 0);
});

test("short-lived food for two cooks far apart is bought on both shops", () => {
  // Spinach keeps 4 days: Sunday's bag would be gone by Friday.
  const r = splitTrips([need("spinach", ["2026-11-16", 100], ["2026-11-20", 100])], TRIPS, [], []);
  assert.equal(onTrip(r, "sun", "spinach")?.qty, 100);
  assert.equal(onTrip(r, "wed", "spinach")?.qty, 100);
});

test("the kitchen comes off first while it is in date; staples go on the first shop", () => {
  const r = splitTrips(
    [need("chicken-breast", ["2026-11-16", 300], ["2026-11-20", 300]), need("olive-oil", ["2026-11-19", 30])],
    TRIPS,
    [{ item: "chicken-breast", qty: 400, status: null, goodUntil: "2026-11-17" }],
    [],
  );
  // Monday's comes from the fridge; the 100 g left is past its date by Friday.
  assert.equal(onTrip(r, "sun", "chicken-breast"), undefined);
  assert.equal(onTrip(r, "wed", "chicken-breast")?.qty, 300);
  assert.ok(onTrip(r, "sun", "olive-oil"));
});

test("an item fully in the kitchen is covered, and one needed before the first shop is flagged", () => {
  const r = splitTrips(
    [need("cheddar", ["2026-11-16", 100]), need("beef-mince", ["2026-11-14", 500])],
    TRIPS,
    [{ item: "cheddar", qty: 400, status: null, goodUntil: null }],
    [],
  );
  assert.deepEqual(r.covered, ["cheddar"]);
  assert.equal(onTrip(r, "sun", "beef-mince")?.qty, 500);
  assert.deepEqual(r.trips.find((t) => t.id === "sun")!.early, ["beef-mince"]);
});

test("your product's pack size decides whether one pack covers two cooks", () => {
  const big = {
    item: "spinach",
    url: "https://www.sainsburys.co.uk/gol-ui/product/x-500g",
    name: "X",
    packQty: 500,
    packUnit: "g" as const,
    pence: 200,
    checked: [],
  };
  // Monday and Thursday are within Sunday's pack's 4 days, and one big pack covers both.
  const r = splitTrips([need("spinach", ["2026-11-16", 200], ["2026-11-19", 200])], TRIPS, [], [big]);
  assert.equal(onTrip(r, "sun", "spinach")?.qty, 400);
  // With the typical 240 g bag it takes two packs either way, so each is bought nearer its use.
  const typical = splitTrips([need("spinach", ["2026-11-16", 200], ["2026-11-19", 200])], TRIPS, [], []);
  assert.equal(onTrip(typical, "wed", "spinach")?.qty, 200);
});

test("what a shop didn't have moves to the next shop, merged with what that one buys", () => {
  const split = splitTrips(
    [need("spinach", ["2026-11-16", 100], ["2026-11-20", 100]), need("pepper", ["2026-11-16", 1])],
    TRIPS,
    [],
    [],
  );
  const r = carryMissing(split.trips, { sun: ["spinach"] });
  const sun = r.trips.find((t) => t.id === "sun")!;
  const wed = r.trips.find((t) => t.id === "wed")!;
  assert.equal(
    sun.needs.find((n) => n.item === "spinach"),
    undefined,
  );
  assert.equal(wed.needs.find((n) => n.item === "spinach")?.qty, 200);
  // Monday's share is now wanted before Wednesday's shop.
  assert.deepEqual(wed.early, ["spinach"]);
  assert.deepEqual(
    r.moved.map((m) => [m.from, m.to, m.need.item]),
    [["sun", "wed", "spinach"]],
  );
  // Nothing else moves.
  assert.ok(sun.needs.some((n) => n.item === "pepper"));
});

test("with no shop after, a missing item has nowhere to go; missing twice, it moves twice", () => {
  const split = splitTrips([need("chicken-thigh", ["2026-11-20", 800])], TRIPS, [], []);
  const last = carryMissing(split.trips, { wed: ["chicken-thigh"] });
  assert.deepEqual(
    last.moved.map((m) => [m.from, m.to]),
    [["wed", null]],
  );
  assert.equal(last.trips.find((t) => t.id === "wed")!.needs.length, 0);

  const three = [...TRIPS, { id: "fri", date: "2026-11-20" }];
  const s3 = splitTrips([need("chicken-thigh", ["2026-11-21", 800])], three, [], []);
  // Saturday's chicken is bought on Friday; say Friday had none, then: nowhere.
  assert.equal(s3.trips.find((t) => t.id === "fri")!.needs[0]?.item, "chicken-thigh");
  const early = splitTrips([need("onion", ["2026-11-16", 2])], three, [], []);
  const twice = carryMissing(early.trips, { sun: ["onion"], wed: ["onion"] });
  assert.deepEqual(
    twice.moved.map((m) => [m.from, m.to]),
    [
      ["sun", "wed"],
      ["wed", "fri"],
    ],
  );
  assert.equal(twice.trips.find((t) => t.id === "fri")!.needs[0]?.qty, 2);
});
