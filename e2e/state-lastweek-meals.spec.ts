import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// A meal from the end of last meal week that was eaten but never ticked used to keep
// its portion in the kitchen, so the new week planned from food that was gone. Meals'
// "not ticked · I ate them" banner now counts it while its batch has portions left,
// and one tap logs it with its batch. The test gives last week a made-up plan with
// one small cook, logged frozen, through the database (no page builds a past week),
// and takes all of it back after.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day, Monday 16 November 2026, in the meal week from Sunday the 15th. */
const TODAY = "2026-11-16";
const LAST_WEEK = "2026-11-08";
const COOK = "e2e-lastweek";

type Read = {
  profile: Record<string, unknown> | null;
  plans: { start: string; data: Record<string, unknown> }[];
  meals: { day: string; slot: string; batch_gid: string | null }[];
  batches: { gid: string; remaining: number; plan_start: string | null; cook_id: string | null }[];
};

/** This meal week planned, as the other save tests do when nothing is planned today. */
async function aPlannedWeek(page: Page, request: APIRequestContext) {
  const claude = await connectClaude(page, request);
  try {
    const day = JSON.parse((await claude.call("get_life_day", { date: TODAY })).text) as {
      routine: { kind: string; slot?: string; detail: string }[];
    };
    const breakfast = day.routine.find((r) => r.kind === "meal" && r.slot === "breakfast");
    if (breakfast && breakfast.detail !== "Nothing planned") return;
    const planned = await claude.call("plan_meal_week", {});
    expect(planned.isError, planned.text).toBe(false);
  } finally {
    await claude.disconnect();
  }
}

const banner = (page: Page) =>
  page.locator("section.card-life").filter({ has: page.getByText(/^\d+ past meals? (is|are) not ticked\.$/) });

test("last week's unticked meal from a batch with portions left is offered on Meals, logs with one tap, and stays logged after a reload", async ({
  page,
  request,
}) => {
  const db = await ownerDatabase();
  const read = () => db.call<Read>("life_read", { p_since: "2026-10-19" });
  const first = await read();
  const before = first.profile ?? {};
  expect(
    first.plans.some((p) => p.start === LAST_WEEK),
    "no other test plans last week",
  ).toBe(false);
  // The made-up body goes last: an earlier save test clears the settings form, which
  // stores the body as nulls, and spread last those would leave Life not set up.
  await db.call("life_save_profile", {
    p_data: { ...before, body: { ...(before.body ?? {}), sex: "male", birthYear: 1990, heightCm: 175 } },
  });
  let batch: string | null = null;
  try {
    await aPlannedWeek(page, request);
    await page.goto("/life");
    await expect(page.getByRole("region", { name: "Days" })).toBeVisible();
    await expect(banner(page), "nothing in this week is unticked yet").toHaveCount(0);

    // Last week: one cook on its Friday, two portions, logged straight into the freezer.
    const thisWeek = (await read()).plans.find((p) => p.start === "2026-11-15")!.data;
    await db.call("life_save_plan", {
      p_start: LAST_WEEK,
      p_data: {
        start: LAST_WEEK,
        cooks: [{ id: COOK, recipe: "bolognese", date: "2026-11-13", start: 990, portions: 2, scale: 1 }],
        breakfast: thisWeek.breakfast,
        shake: thisWeek.shake,
        fresh: [],
        out: [],
        createdOn: LAST_WEEK,
      },
    });
    batch = await db.call<string>("life_cook", {
      p_recipe: "bolognese",
      p_day: "2026-11-13",
      p_portions: 2,
      p_scale: 1,
      p_freeze: 2,
      p_used: [],
      p_plan_start: LAST_WEEK,
      p_cook_id: COOK,
    });

    // Meals offers last week's meals from that batch.
    await page.goto("/life");
    await expect(banner(page)).toBeVisible();
    const text = (await banner(page).locator("p").innerText()).trim();
    const missing = Number(/^(\d+) past/.exec(text)?.[1]);
    expect(missing).toBeGreaterThan(0);
    expect(missing).toBeLessThanOrEqual(2);

    // One tap: the banner goes at once, and after a reload.
    await banner(page).getByRole("button", { name: "I ate them" }).click();
    await expect(page.getByText(/^Logged as eaten\./)).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Days" })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    // The portions left the batch, and the Kitchen counts that many fewer.
    const after = await read();
    const left = after.batches.find((b) => b.gid === batch)?.remaining ?? 0;
    expect(left).toBe(2 - missing);
    expect(after.meals.filter((m) => m.batch_gid === batch && m.day < "2026-11-15")).toHaveLength(missing);
    await page.goto("/life/kitchen?tab=fridge");
    const frozen = page
      .getByRole("region", { name: "Cooked food" })
      .getByRole("listitem")
      .filter({ hasText: "Spaghetti bolognese" })
      .filter({ hasText: "Freezer" });
    if (left > 0) await expect(frozen.first()).toContainText(`${left}/`);
    else await expect(frozen).toHaveCount(0);
  } finally {
    // Everything back: last week's meal logs, its cook and its plan, and the profile.
    const now = await read();
    const cooked = now.batches.find((b) => b.plan_start === LAST_WEEK && b.cook_id === COOK);
    for (const m of now.meals.filter((x) => x.batch_gid !== null && x.batch_gid === (cooked?.gid ?? batch)))
      await db.call("life_log_meal", { p_day: m.day, p_slot: m.slot, p_status: null });
    if (cooked ?? batch) await db.call("life_uncook", { p_batch: cooked?.gid ?? batch });
    await db.call("life_save_plan", { p_start: LAST_WEEK, p_data: null });
    await db.call("life_save_profile", { p_data: before });
  }
});
