import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// "I ate something else": a meal eaten in place of the planned one is logged in one
// tap, shows as eaten at once and after a reload, and takes nothing out of the
// kitchen. Each test logs through the page (or through Claude's tool), looks,
// reloads, and clears what it logged.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

type Claude = Awaited<ReturnType<typeof connectClaude>>;

async function withClaude(page: Page, request: APIRequestContext, run: (claude: Claude) => Promise<void>) {
  const claude = await connectClaude(page, request);
  try {
    await run(claude);
  } finally {
    await claude.disconnect();
  }
}

/** A week of meals to log against. An earlier save test may have planned one; alone on a fresh database, none has. */
async function aPlannedWeek(page: Page, request: APIRequestContext) {
  await withClaude(page, request, async (claude) => {
    const day = JSON.parse((await claude.call("get_life_day", { date: TODAY })).text) as {
      routine: { kind: string; slot?: string; detail: string }[];
    };
    const breakfast = day.routine.find((r) => r.kind === "meal" && r.slot === "breakfast");
    if (breakfast && breakfast.detail !== "Nothing planned") return;
    const planned = await claude.call("plan_meal_week", {});
    expect(planned.isError, planned.text).toBe(false);
  });
}

/** Today's card on the Meals page, and one of its meals. */
const todayCard = (page: Page) => page.getByRole("region", { name: "Days" }).getByRole("article").first();
const mealRow = (page: Page, slot: string) => todayCard(page).getByRole("listitem").filter({ hasText: slot });
const sheet = (page: Page, slot: string) => page.getByRole("dialog", { name: `Today: ${slot}` });

/** Everything the Kitchen holds, as the owner reads it: the fridge and freezer, and the cupboard. */
async function kitchen(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (const tab of ["fridge", "cupboard"]) {
    await page.goto(`/life/kitchen?tab=${tab}`);
    await expect(page.getByRole("heading", { name: "Kitchen", level: 1 })).toBeVisible();
    seen.push(await page.locator("main").innerText());
  }
  return seen;
}

test("a planned meal logged as something else shows as eaten at once and after a reload, and the kitchen keeps its food", async ({
  page,
  request,
}) => {
  await aPlannedWeek(page, request);
  const before = await kitchen(page);

  await page.goto("/life");
  const row = mealRow(page, "Breakfast");
  await expect(row.getByRole("button", { name: "Ate Breakfast" })).toBeVisible();
  // The meal itself opens its sheet; the sheet asks how it compared.
  await row.getByRole("button").nth(1).click();
  await sheet(page, "Breakfast").getByRole("button", { name: "I ate something else" }).click();
  for (const size of ["Lighter", "About the plan", "Bigger"])
    await expect(sheet(page, "Breakfast").getByRole("button", { name: size, exact: true })).toBeVisible();
  await sheet(page, "Breakfast").getByRole("button", { name: "About the plan" }).click();

  const ticked = row.getByRole("button", { name: "Untick Breakfast" });
  await expect(ticked).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByText("Ate something else")).toBeVisible();
  await page.reload();
  await expect(ticked).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByText("Ate something else")).toBeVisible();

  // Nothing left the fridge, the freezer or the cupboard.
  expect(await kitchen(page)).toEqual(before);

  // Back as it was.
  await page.goto("/life");
  await row.getByRole("button").nth(1).click();
  await sheet(page, "Breakfast").getByRole("button", { name: "Clear what I logged" }).click();
  await expect(row.getByRole("button", { name: "Ate Breakfast" })).toHaveAttribute("aria-pressed", "false");
  await expect(row.getByText("Ate something else")).toHaveCount(0);
});

test("a meal out is logged from its tick: it asks how big, and counts as eaten at once and after a reload", async ({
  page,
  request,
}) => {
  await aPlannedWeek(page, request);
  await page.goto("/life");
  const row = mealRow(page, "Dinner");
  await row.getByRole("button").nth(1).click();
  await sheet(page, "Dinner").getByRole("button", { name: "I'm eating out" }).click();
  await expect(row.getByText("Eating out")).toBeVisible();

  // Nothing is planned to tick, so the tick asks what was eaten instead.
  await row.getByRole("button", { name: "Log Dinner" }).click();
  await expect(sheet(page, "Dinner").getByText(/^How did it compare with a usual meal\?/)).toBeVisible();
  await sheet(page, "Dinner").getByRole("button", { name: "Lighter" }).click();
  const ticked = row.getByRole("button", { name: "Untick Dinner" });
  await expect(ticked).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(ticked).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByText("Ate something else")).toBeVisible();

  // Back as it was: the tick comes off, and dinner is the planned one again.
  await ticked.click();
  await expect(row.getByRole("button", { name: "Log Dinner" })).toHaveAttribute("aria-pressed", "false");
  await row.getByRole("button").nth(1).click();
  await sheet(page, "Dinner").getByRole("button", { name: "Not eating out after all" }).click();
  await expect(row.getByText("Eating out")).toHaveCount(0);
});

test("telling Claude logs it the same way, and the reply says it is an estimate", async ({ page, request }) => {
  await aPlannedWeek(page, request);
  await withClaude(page, request, async (claude) => {
    const logged = await claude.call("log_meal", {
      slot: "lunch",
      status: "something_else",
      size: "bigger",
      date: TODAY,
    });
    expect(logged.isError, logged.text).toBe(false);
    const reply = JSON.parse(logged.text) as { status: string; logged_as?: { kcal: number }; note?: string };
    expect(reply.status).toBe("something_else");
    expect(reply.logged_as?.kcal).toBeGreaterThan(0);
    expect(reply.note).toMatch(/^An estimate/);

    const row = mealRow(page, "Lunch");
    await page.goto("/life");
    await expect(row.getByRole("button", { name: "Untick Lunch" })).toHaveAttribute("aria-pressed", "true");
    await expect(row.getByText("Ate something else")).toBeVisible();

    // A size the tool doesn't know is refused before anything is logged.
    const wrong = await claude.call("log_meal", { slot: "lunch", status: "something_else", size: "huge", date: TODAY });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/^size must be one of "lighter", "about", "bigger"/);

    // Back as it was.
    const cleared = await claude.call("log_meal", { slot: "lunch", status: "clear", date: TODAY });
    expect(cleared.isError, cleared.text).toBe(false);
    await page.goto("/life");
    await expect(row.getByText("Ate something else")).toHaveCount(0);
  });
});
