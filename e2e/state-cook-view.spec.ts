import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// The Cook view: a cook session opens from the Kitchen on one page (get ready, each
// dish with its method and done check, box up), its box-up numbers match the
// Kitchen's, it holds at 412 and 360 px, and Cooked it there logs the cook at once
// and after a reload. The test undoes the cook in the Kitchen after.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

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

test("a cook session opens from the Kitchen as one page, and Cooked it there logs the cook", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await aPlannedWeek(page, request);
  await page.goto("/life/kitchen?tab=fridge");
  // A session card with a dish still to cook, and that dish as the Kitchen counts it:
  // "4 portions, 1 to freeze". Earlier save tests may leave a session cooked.
  const cookedIt = page.getByRole("button", { name: "Cooked it" });
  const card = page
    .locator(".card-life")
    .filter({ has: page.getByRole("link", { name: "Open the cook" }) })
    .filter({ has: cookedIt })
    .first();
  const open = card.getByRole("link", { name: "Open the cook" });
  await expect(open).toBeVisible();
  const row = card.getByRole("listitem").filter({ has: cookedIt }).first();
  const name = await row.getByRole("link").first().innerText();
  const [, portions, freeze] = /(\d+) portions(?:, (\d+) to freeze)?/.exec(await row.innerText())!;
  const href = await open.getAttribute("href");
  await open.click();

  await expect(page).toHaveURL(href!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  for (const title of ["Get ready", "Box up"]) await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const dish = page.getByRole("region", { name });
  await expect(dish.getByRole("listitem").first()).toBeVisible();
  const boxUp = page.getByRole("region", { name: "Box up" });
  await expect(boxUp.getByText(new RegExp(`^${name}: ${portions} boxes`))).toBeVisible();
  if (freeze) await expect(boxUp.getByText(new RegExp(`^${name}: .* ${freeze} in the freezer\\.$`))).toBeVisible();
  await expect(boxUp.getByText(/within 2 hours/)).toBeVisible();

  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }

  // Cooked it, from the Cook view: at once and after a reload.
  await dish.getByRole("button", { name: "Cooked it" }).click();
  await expect(dish.getByText("Cooked", { exact: true })).toBeVisible();
  await page.reload();
  await expect(dish.getByText("Cooked", { exact: true })).toBeVisible();

  // Back as it was: the cook undone in the Kitchen.
  await page.goto("/life/kitchen?tab=fridge");
  const undo = page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Undo cook" });
  await undo.first().click();
  await expect(undo).toHaveCount(0);
});

test("a time with nothing to cook says so and points back to the Kitchen", async ({ page }) => {
  await page.goto("/life/cook?day=2026-11-16&at=1");
  await expect(page.getByRole("heading", { name: "Cook", level: 1 })).toBeVisible();
  await expect(page.getByText(/^Nothing to cook then\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "← Kitchen" })).toBeVisible();
});
