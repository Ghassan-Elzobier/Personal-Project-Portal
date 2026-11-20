import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// Spare food counted honestly, as the owner sees it: food past its date says so in
// the Cupboard and stops counting, at once and after a reload, and every spare on
// the shopping list says what happens to it. Food with a date is set up through the
// database (no page sets a date: a delivery does) and put back after.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

/** A week to shop for. An earlier save test may have planned one; alone on a fresh database, none has. */
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

test("food past its date says so in the Cupboard and no longer counts, at once and after a reload", async ({
  page,
}) => {
  const db = await ownerDatabase();
  const set = (qty: number, goodUntil: string) =>
    db.call("life_stock", {
      p_changes: [{ item: "chicken-thigh", qty, good_until: goodUntil }],
      p_mode: "set",
    });
  await set(300, "2026-11-14");
  try {
    await page.goto("/life/kitchen?tab=cupboard");
    const row = page.getByRole("listitem").filter({ hasText: "Chicken thigh fillets" });
    await expect(row).toContainText("300 g · past its date: no longer counted");
    await expect(row).not.toContainText("use soon");
    await page.reload();
    await expect(row).toContainText("past its date: no longer counted");

    // Still good until tomorrow, it is "use soon" again.
    await set(300, "2026-11-17");
    await page.reload();
    await expect(row).toContainText("good until tomorrow · use soon");
  } finally {
    await set(0, "");
  }
});

test("every spare on the shopping list says when it goes off, or that it keeps for next week", async ({
  page,
  request,
}) => {
  await aPlannedWeek(page, request);
  await page.goto("/life/kitchen?tab=shop");
  const spares = page.getByText(/ spare, (goes off (Mon|Tue|Wed|Thu|Fri|Sat|Sun)|kept for next week)$/);
  await expect(spares.first()).toBeVisible();
  // Nothing on the list says "spare" without saying what happens to it.
  for (const text of await page.getByText(/ spare/).allInnerTexts())
    expect(text).toMatch(/ spare, (goes off \w{3}|kept for next week)/);
});
