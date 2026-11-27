import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";
import { RECIPES } from "../src/lib/life/recipes.ts";

// "Still fine until": the owner can say a fridge batch is fine a day or two past its
// Food Standards Agency eat-by, after a confirmation that shows the FSA advice. The
// meals up to that day then plan from it, on the Meals page and in get_life_day, at
// once and after a reload, and "Back to its eat-by" undoes it. Claude can do the same
// with set_still_fine, and put a meal cooked fresh back on the batch plan.
//
// The batch is a main the week doesn't cook, cooked yesterday and put in the fridge
// through the database (no page cooks on a past day), and taken back with Undo cook.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day, Monday 16 November 2026, in the meal week from Sunday the 15th. */
const TODAY = "2026-11-16";
const COOKED = "2026-11-15";
/** Two days in the fridge, by the FSA, so its eat-by is tomorrow. */
const RULE_EAT_BY = "2026-11-17";
const KEPT_UNTIL = "2026-11-18";
/** The dish the test cooks: set by `aDishOffTheWeek`. */
let NAME = "";
let RECIPE = "";

type Claude = Awaited<ReturnType<typeof connectClaude>>;
type LifeDay = {
  routine: { kind: string; slot?: string; detail: string; cooked_fresh?: boolean }[];
  kitchen: {
    batch: string;
    recipe: string;
    where: string;
    eat_by: string | null;
    owner_says_fine?: boolean;
    fsa_eat_by?: string;
  }[];
};

async function lifeDay(claude: Claude, date: string): Promise<LifeDay> {
  const answer = await claude.call("get_life_day", { date });
  expect(answer.isError, answer.text).toBe(false);
  return JSON.parse(answer.text) as LifeDay;
}

async function connected(page: Page, request: APIRequestContext, run: (claude: Claude) => Promise<void>) {
  const claude = await connectClaude(page, request);
  try {
    await run(claude);
  } finally {
    await claude.disconnect();
  }
}

/** This meal week planned, as the other save tests do when nothing is planned today. */
async function aPlannedWeek(claude: Claude) {
  const breakfast = (await lifeDay(claude, TODAY)).routine.find((r) => r.kind === "meal" && r.slot === "breakfast");
  if (breakfast && breakfast.detail !== "Nothing planned") return;
  const planned = await claude.call("plan_meal_week", {});
  expect(planned.isError, planned.text).toBe(false);
}

/**
 * A main with two days in the fridge that no meal this week is planned as, so only
 * the test's batch puts it on a day. Fridge-only dishes first: the week eats those soonest.
 */
async function aDishOffTheWeek(claude: Claude) {
  const planned = new Set<string>();
  for (const date of ["2026-11-15", TODAY, "2026-11-17", KEPT_UNTIL, "2026-11-19", "2026-11-20", "2026-11-21"])
    for (const r of (await lifeDay(claude, date)).routine) if (r.kind === "meal") planned.add(r.detail);
  const dish = RECIPES.filter((r) => r.meal === "main" && r.keeps.fridgeDays === 2 && !planned.has(r.name)).sort(
    (a, b) => Number(a.keeps.freezes) - Number(b.keeps.freezes),
  )[0];
  expect(dish, "a main the week doesn't cook").toBeTruthy();
  RECIPE = dish!.key;
  NAME = dish!.name;
}

/** Lunches and dinners on a day planned from the test's dish. */
const fromBatch = (day: LifeDay) =>
  day.routine.filter((r) => r.kind === "meal" && (r.slot === "lunch" || r.slot === "dinner") && r.detail === NAME);

/** The dish in the fridge, cooked yesterday, with portions for more meals than its two days hold. */
async function cookedYesterday(claude: Claude): Promise<string> {
  const db = await ownerDatabase();
  await db.call("life_cook", {
    p_recipe: RECIPE,
    p_day: COOKED,
    p_portions: 8,
    p_scale: 1,
    p_freeze: 0,
    p_used: [],
  });
  const batch = (await lifeDay(claude, TODAY)).kitchen.find((b) => b.recipe === NAME && b.where === "fridge");
  expect(batch, "the dish is in the fridge").toBeTruthy();
  expect(batch!.eat_by).toBe(RULE_EAT_BY);
  return batch!.batch;
}

/** Takes the cook back in the Kitchen. */
async function undoCook(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/life/kitchen?tab=fridge");
  const undo = page.getByRole("listitem").filter({ hasText: NAME }).getByRole("button", { name: "Undo cook" });
  await undo.first().click();
  await expect(undo).toHaveCount(0);
}

const cookedFood = (page: Page) =>
  page.getByRole("region", { name: "Cooked food" }).getByRole("listitem").filter({ hasText: NAME });

/** Wednesday's card on the Meals page. */
const wednesday = (page: Page) =>
  page
    .getByRole("region", { name: "Days" })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: /^Wed/ }) });

test("Still fine until shows the FSA advice first, then plans Wednesday's meals from the batch at once and after a reload, and Back to its eat-by undoes it", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    await aPlannedWeek(claude);
    await aDishOffTheWeek(claude);
    const batch = await cookedYesterday(claude);
    try {
      // Past its eat-by, Wednesday's meals don't come from it.
      expect(fromBatch(await lifeDay(claude, KEPT_UNTIL))).toHaveLength(0);
      await page.goto("/life/kitchen?tab=fridge");
      await expect(cookedFood(page)).toContainText("eat by tomorrow");

      let asked = "";
      page.once("dialog", (dialog) => {
        asked = dialog.message();
        void dialog.accept();
      });
      await cookedFood(page).getByRole("button", { name: "Still fine until Wednesday 18 Nov" }).click();
      await expect(cookedFood(page)).toContainText("your call: fine until wednesday 18 nov");
      expect(asked).toContain("The Food Standards Agency advises eating leftovers within two days");
      await page.reload();
      await expect(cookedFood(page)).toContainText("your call: fine until wednesday 18 nov");
      // Its eat-by is no longer close, so no further day is offered until it is.
      await expect(cookedFood(page).getByRole("button", { name: /^Still fine until/ })).toHaveCount(0);

      const kept = await lifeDay(claude, KEPT_UNTIL);
      expect(kept.kitchen.find((b) => b.batch === batch)).toMatchObject({
        eat_by: KEPT_UNTIL,
        owner_says_fine: true,
        fsa_eat_by: RULE_EAT_BY,
      });
      expect(fromBatch(kept).length, "a meal on Wednesday comes from the batch").toBeGreaterThan(0);
      await page.goto("/life");
      await expect(wednesday(page)).toContainText(NAME);
      await page.reload();
      await expect(wednesday(page)).toContainText(NAME);

      // Back to the rule: Wednesday no longer plans from it.
      await page.goto("/life/kitchen?tab=fridge");
      await cookedFood(page).getByRole("button", { name: "Back to its eat-by" }).click();
      await expect(cookedFood(page)).toContainText("eat by tomorrow");
      await page.reload();
      await expect(cookedFood(page)).toContainText("eat by tomorrow");
      expect(fromBatch(await lifeDay(claude, KEPT_UNTIL))).toHaveLength(0);
      await page.goto("/life");
      await expect(wednesday(page)).not.toContainText(NAME);
    } finally {
      await undoCook(page);
    }
  });
});

test("Claude sets and clears the day a fridge batch is still fine until, within two days past its eat-by", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    await aPlannedWeek(claude);
    await aDishOffTheWeek(claude);
    const batch = await cookedYesterday(claude);
    try {
      const listed = (await claude.tools()).find((t) => t.name === "set_still_fine");
      expect(listed, "set_still_fine is listed").toBeTruthy();

      const neither = await claude.call("set_still_fine", { batch });
      expect(neither.isError).toBe(true);
      const tooLate = await claude.call("set_still_fine", { batch, until: "2026-11-20" });
      expect(tooLate.isError).toBe(true);
      expect(tooLate.text).toContain("two days past its eat-by");

      const set = await claude.call("set_still_fine", { batch, until: KEPT_UNTIL });
      expect(set.isError, set.text).toBe(false);
      expect(JSON.parse(set.text)).toMatchObject({ eat_by: KEPT_UNTIL, owner_says_fine: true });
      expect(fromBatch(await lifeDay(claude, KEPT_UNTIL)).length).toBeGreaterThan(0);
      await page.goto("/life/kitchen?tab=fridge");
      await expect(cookedFood(page)).toContainText("your call: fine until wednesday 18 nov");

      const cleared = await claude.call("set_still_fine", { batch, clear: true });
      expect(cleared.isError, cleared.text).toBe(false);
      expect(JSON.parse(cleared.text)).toMatchObject({ eat_by: RULE_EAT_BY, owner_says_fine: false });
      expect(fromBatch(await lifeDay(claude, KEPT_UNTIL))).toHaveLength(0);
      await page.reload();
      await expect(cookedFood(page)).toContainText("eat by tomorrow");
    } finally {
      await undoCook(page);
    }
  });
});

test("Claude puts a meal cooked fresh back on the batch plan, as the Meals page's button does", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    await aPlannedWeek(claude);
    const notFresh = await claude.call("back_to_batch_plan", { slot: "dinner", date: KEPT_UNTIL });
    expect(notFresh.isError).toBe(true);
    expect(notFresh.text).toContain("isn't cooked fresh");

    // Wednesday's dinner cooked fresh. The Meals page offers only dishes that fit the
    // owner's food rules, and the seeded owner has none set, so the plan is given it
    // through the database, and put back as it was at the end.
    const db = await ownerDatabase();
    const plans = (
      await db.call<{ plans: { start: string; data: { fresh: unknown[] } }[] }>("life_read", {
        p_since: "2026-11-15",
      })
    ).plans;
    const week = plans.find((p) => p.start === "2026-11-15");
    expect(week, "this meal week is planned").toBeTruthy();
    const dish = RECIPES.find((r) => r.meal === "main")!;
    try {
      await db.call("life_save_plan", {
        p_start: "2026-11-15",
        p_data: { ...week!.data, fresh: [...week!.data.fresh, { date: KEPT_UNTIL, slot: "dinner", recipe: dish.key }] },
      });
      await page.goto("/life");
      const dinner = wednesday(page).getByRole("listitem").filter({ hasText: "Dinner" });
      await expect(dinner).toContainText("Cook fresh");
      const fresh = (await lifeDay(claude, KEPT_UNTIL)).routine.find((r) => r.kind === "meal" && r.slot === "dinner");
      expect(fresh?.cooked_fresh, "Wednesday's dinner is cooked fresh").toBe(true);

      const back = await claude.call("back_to_batch_plan", { slot: "dinner", date: KEPT_UNTIL });
      expect(back.isError, back.text).toBe(false);
      const answer = JSON.parse(back.text) as { was: string; now: string };
      expect(answer.was).toBeTruthy();
      const after = (await lifeDay(claude, KEPT_UNTIL)).routine.find((r) => r.kind === "meal" && r.slot === "dinner");
      expect(after?.cooked_fresh).toBeUndefined();
      expect(answer.now.replace(" (from the freezer)", "")).toBe(after?.detail.replace(" · from the freezer", ""));
      await page.reload();
      await expect(dinner).not.toContainText("Cook fresh");
    } finally {
      await db.call("life_save_plan", { p_start: "2026-11-15", p_data: week!.data });
    }
  });
});
