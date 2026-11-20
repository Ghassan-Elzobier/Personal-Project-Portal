// A cook session from one page: what to get ready and in what order, each dish's
// method with a check that it is done, and how to box it up. Built from the
// recipes at their planned amounts, with food safety at the step it matters
// (Food Standards Agency: the 4 Cs; cool and chill within 2 hours, rice within 1).
// Pure, so it is tested.

import { addDays } from "../dates/week.ts";
import { INGREDIENTS, type Aisle, type Raw } from "./ingredients.ts";
import type { Recipe } from "./recipes.ts";
import { amount, linesFor } from "./shopping.ts";
import { scaledSteps } from "./steps.ts";

/** One planned cook in the session, at its planned size. */
export type PrepCook = {
  id: string;
  recipe: Recipe;
  portions: number;
  scale: number;
  /** Portions that go in the freezer. */
  freeze: number;
  date: string;
  cooked: boolean;
};

export type CookPlan = {
  /** Get ready, in order: marinades, preheating, weighing, chopping, raw meat last. */
  ready: string[];
  /** Notes about the session as a whole: kit two dishes both need. */
  warnings: string[];
  /** The dishes in the order to start them: the one with the longest wait first. */
  dishes: { id: string; key: string; name: string; steps: string[]; done: string | null; cooked: boolean }[];
  /** Box up: each dish's boxes and where they go, then labelling and chilling. */
  boxUp: string[];
  /** A line for each piece of kit that needs care. */
  kit: string[];
};

const FRESH: Aisle[] = ["Fruit & veg"];
const RAW: Aisle[] = ["Meat & fish"];

/** How to tell each kind of raw meat or fish is done (FSA, "Cooking your food"), to follow "Done when". */
const DONE: Record<Raw, string> = {
  poultry: "the thickest piece has no pink in the middle and its juices run clear, or reads 75°C",
  pork: "the thickest piece has no pink in the middle and its juices run clear, or reads 75°C",
  mince: "there's no pink left in the meat and it's piping hot all through, or 75°C in the middle",
  "whole-cut": "the beef is browned all over (the inside can stay pink)",
  fish: "the fish is opaque all the way through and flakes easily",
};

const weekday = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** "Bolognese" from "Spaghetti bolognese": short enough to split a total by dish. */
const short = (r: Recipe) => r.name;

/** The temperature each piece of kit is heated to in a recipe's method, if it says. */
export function preheats(r: Recipe): { kit: "oven" | "air fryer"; c: number }[] {
  const out: { kit: "oven" | "air fryer"; c: number }[] = [];
  for (const step of r.steps) {
    const air = /air fr[a-z]*[^.]*?(\d{3})°C/i.exec(step);
    if (air && !out.some((x) => x.kit === "air fryer")) out.push({ kit: "air fryer", c: Number(air[1]) });
    const oven = /(?:oven|bake|roast)[^.]*?(\d{3})°C/i.exec(step);
    if (oven && !/air fr/i.test(oven[0]) && !out.some((x) => x.kit === "oven"))
      out.push({ kit: "oven", c: Number(oven[1]) });
  }
  return out;
}

export function cookPlan(cooks: PrepCook[]): CookPlan {
  const handsOff = (r: Recipe) => r.totalMin - r.activeMin;
  const order = [...cooks].sort((a, b) => handsOff(b.recipe) - handsOff(a.recipe));
  const lines = order.map((c) => ({ c, lines: linesFor(c.recipe, c.portions, c.scale) }));
  const many = order.length > 1;

  // Each ingredient once, with its total and, across two dishes, its split.
  type Merged = { item: string; total: number; by: { name: string; qty: number }[]; note?: string };
  const merged = new Map<string, Merged>();
  for (const { c, lines: ls } of lines)
    ls.forEach((l, i) => {
      const line = c.recipe.lines[i];
      if (line.side) return;
      const m = merged.get(l.item) ?? { item: l.item, total: 0, by: [] };
      m.total += l.qty;
      m.by.push({ name: short(c.recipe), qty: l.qty });
      m.note ??= line.note;
      merged.set(l.item, m);
    });
  const describe = (m: Merged) => {
    const ing = INGREDIENTS.get(m.item)!;
    // Counted things split to the quarter, so the shares add up to the total (1.5 onions: ¾ and ¾).
    const share = (q: number) => (ing.unit === "each" ? `${Math.round(q * 4) / 4}` : amount(ing, q));
    const base = `${ing.name} ${amount(ing, m.total)}`;
    const split = many && m.by.length > 1 ? `: ${m.by.map((b) => `${share(b.qty)} for ${b.name}`).join(", ")}` : "";
    return `${base}${m.note && !split ? `, ${m.note}` : ""}${split}`;
  };
  const of = (pick: (aisle: Aisle) => boolean) =>
    [...merged.values()].filter((m) => pick(INGREDIENTS.get(m.item)!.aisle));

  const ready: string[] = [];
  for (const c of order)
    if (c.recipe.steps.some((s) => /marinat/i.test(s)))
      ready.push(`Start the ${c.recipe.name} marinade first, covered in the fridge.`);
  const heat = order.flatMap((c) => preheats(c.recipe).map((h) => ({ ...h, name: c.recipe.name })));
  for (const kit of ["oven", "air fryer"] as const) {
    const temps = [...new Set(heat.filter((h) => h.kit === kit).map((h) => h.c))];
    if (temps.length) ready.push(`Heat the ${kit} to ${temps[0]}°C.`);
  }
  const dry = of((a) => !FRESH.includes(a) && !RAW.includes(a));
  for (const m of dry) ready.push(`Weigh out ${describe(m)}.`);
  for (const m of of((a) => FRESH.includes(a))) ready.push(`Prep ${describe(m)}.`);
  const raw = of((a) => RAW.includes(a));
  if (raw.length) {
    ready.push(`Raw meat and fish last, on a clean board: ${raw.map((m) => describe(m)).join("; ")}.`);
    if (raw.some((m) => INGREDIENTS.get(m.item)!.raw))
      ready.push("Then wash your hands, the board and the knife in hot soapy water before touching anything else.");
  }

  // Kit two dishes both need, one after the other.
  const warnings: string[] = [];
  const airFryers = order.filter((c) => c.recipe.kit.includes("air fryer"));
  if (airFryers.length > 1)
    warnings.push(
      `${airFryers.map((c) => c.recipe.name).join(" and ")} both use the air fryer: cook one after the other.`,
    );
  const ovenTemps = [...new Set(heat.filter((h) => h.kit === "oven").map((h) => h.c))];
  if (ovenTemps.length > 1)
    warnings.push(
      `The oven is wanted at ${ovenTemps.map((t) => `${t}°C`).join(" and ")}: cook the hotter one first, or one after the other.`,
    );

  const dishes = order.map(({ id, recipe: r, cooked, portions, scale }) => {
    const kinds = [...new Set(r.lines.map((l) => INGREDIENTS.get(l.item)?.raw).filter((k) => k !== undefined))];
    const checks = [...new Set(kinds.map((k) => DONE[k!]))];
    return {
      id,
      key: r.key,
      name: r.name,
      steps: scaledSteps(r, portions, scale),
      done: checks.length ? `Done when ${checks.join(", and ")}.` : null,
      cooked,
    };
  });

  const boxUp: string[] = [];
  for (const c of order) {
    const fridge = c.portions - c.freeze;
    const eatBy = addDays(c.date, c.recipe.keeps.fridgeDays);
    const where = [
      fridge > 0 && `${fridge} in the fridge (eat by ${weekday(eatBy)})`,
      c.freeze > 0 && `${c.freeze} in the freezer`,
    ].filter(Boolean);
    boxUp.push(`${c.recipe.name}: ${c.portions} ${c.portions === 1 ? "box" : "boxes"}, ${where.join(" and ")}.`);
  }
  const rice = order.some((c) => c.recipe.keeps.rice);
  boxUp.push(
    `Spread it out to cool, label each box with the dish and today's date, and get it all into the fridge or freezer within 2 hours${rice ? " (rice within 1 hour)" : ""}.`,
  );
  for (const c of order) if (c.recipe.reheat) boxUp.push(`To reheat ${c.recipe.name}: ${c.recipe.reheat}`);

  const kit: string[] = [];
  if (order.some((c) => c.recipe.kit.includes("blender") && c.recipe.steps.some((s) => /blend/i.test(s))))
    kit.push(
      "Blender with hot food: let it cool for a few minutes, fill it no more than halfway, and hold the lid down with a folded tea towel.",
    );
  if (airFryers.length) kit.push("Air fryer: one layer at a time, so it crisps rather than steams.");

  return { ready, warnings, dishes, boxUp, kit };
}
