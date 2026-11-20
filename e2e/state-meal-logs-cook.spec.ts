import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Eating a meal from a planned cook that wasn't logged logs the cook: its portions go
// in and the eaten one comes out, at once and after a reload, with a toast that says
// so. Undo in the toast takes both back, and the cupboard is as it was.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

type Claude = Awaited<ReturnType<typeof connectClaude>>;
type Routine = { kind: string; title: string; detail: string; done: boolean; cook_id?: string }[];

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function withClaude<T>(page: Page, request: APIRequestContext, run: (claude: Claude) => Promise<T>) {
  const claude = await connectClaude(page, request);
  try {
    return await run(claude);
  } finally {
    await claude.disconnect();
  }
}

const routineOn = async (claude: Claude, date: string) =>
  (JSON.parse((await claude.call("get_life_day", { date })).text) as { routine: Routine }).routine;

type Cook = { date: string; id: string; name: string; portions: number };

/** The week's cooks not logged yet, planning the week if no earlier save test has. */
async function cooksNotLogged(page: Page, request: APIRequestContext): Promise<Cook[]> {
  return withClaude(page, request, async (claude) => {
    const find = async () => {
      const found: Cook[] = [];
      for (let i = 0; i < 7; i++) {
        const date = dayAfter(TODAY, i);
        for (const r of await routineOn(claude, date))
          if (r.kind === "cook" && r.cook_id && !r.done)
            found.push({
              date,
              id: r.cook_id,
              name: r.title.replace(/^Cook /, ""),
              portions: Number(/^(\d+) portions/.exec(r.detail)?.[1]),
            });
      }
      return found;
    };
    let cooks = await find();
    if (!cooks.length) {
      const planned = await claude.call("plan_meal_week", {});
      expect(planned.isError, planned.text).toBe(false);
      cooks = await find();
    }
    return cooks;
  });
}

type Meal = { cook: Cook; day: string; slot: string };

/**
 * A lunch or dinner on the Meals page, not ticked yet, from a cook that isn't logged.
 * Not every cook has one: a week's last cook can feed next week, and earlier save
 * tests leave the week as they found it, not as a fresh plan would be.
 */
async function aMealFromAnUnloggedCook(page: Page, request: APIRequestContext): Promise<Meal> {
  const cooks = await cooksNotLogged(page, request);
  await page.goto("/life");
  const ate = page.getByRole("button", { name: /^Ate (Lunch|Dinner)$/ });
  for (const cook of cooks)
    for (const card of await page.getByRole("region", { name: "Days" }).getByRole("article").all()) {
      const row = card.getByRole("listitem").filter({ hasText: cook.name }).filter({ has: ate }).first();
      if (!(await row.count())) continue;
      const label = await row.getByRole("button", { name: /^Ate (Lunch|Dinner)$/ }).getAttribute("aria-label");
      return { cook, day: await card.getByRole("heading").first().innerText(), slot: label!.replace(/^Ate /, "") };
    }
  throw new Error(`No lunch or dinner this week comes from a cook that isn't logged (${cooks.length} cooks)`);
}

/** That meal's row on the Meals page, found by its day and slot, and its tick either way round. */
function mealRow(page: Page, m: Meal) {
  const tickName = new RegExp(`^(Ate|Untick) ${m.slot}$`);
  const row = page
    .getByRole("region", { name: "Days" })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: m.day, exact: true }) })
    .getByRole("listitem")
    .filter({ hasText: m.cook.name })
    .filter({ has: page.getByRole("button", { name: tickName }) })
    .first();
  return { row, tick: row.getByRole("button", { name: tickName }) };
}

const cookDone = (page: Page, request: APIRequestContext, cook: { date: string; id: string }) =>
  withClaude(
    page,
    request,
    async (claude) => (await routineOn(claude, cook.date)).find((r) => r.cook_id === cook.id)?.done,
  );

/** Portions left of the cook's batches in the Kitchen, fridge and freezer together. */
async function portionsLeft(page: Page, name: string): Promise<number> {
  await page.goto("/life/kitchen?tab=fridge");
  const rows = page.getByRole("region", { name: "Cooked food" }).getByRole("listitem").filter({ hasText: name });
  let left = 0;
  for (const text of await rows.allInnerTexts()) left += Number(/(\d+)\s*\/\s*\d+/.exec(text)?.[1] ?? 0);
  return left;
}

async function cupboard(page: Page): Promise<string> {
  await page.goto("/life/kitchen?tab=cupboard");
  await expect(page.getByRole("heading", { name: "Kitchen", level: 1 })).toBeVisible();
  return page.locator("main").innerText();
}

test("a meal ticked from a cook that wasn't logged logs the cook, and the portion comes out of its batch", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const meal = await aMealFromAnUnloggedCook(page, request);
  const { cook } = meal;
  const before = await cupboard(page);

  await page.goto("/life");
  const { row, tick } = mealRow(page, meal);
  await tick.click();
  await expect(page.getByText(`Logged the cook too: ${cook.name}`, { exact: false })).toBeVisible();
  await expect(tick).toHaveAttribute("aria-pressed", "true");
  expect(await cookDone(page, request, cook)).toBe(true);

  // The cook's portions are in, less the one eaten, at once and after a reload.
  expect(await portionsLeft(page, cook.name)).toBe(cook.portions - 1);
  await page.reload();
  expect(await portionsLeft(page, cook.name)).toBe(cook.portions - 1);

  // Back as it was: the meal unticked, the cook undone in the Kitchen.
  await page.goto("/life");
  await tick.click();
  await expect(tick).toHaveAttribute("aria-pressed", "false");
  await expect(row).toBeVisible();
  await page.goto("/life/kitchen?tab=fridge");
  const undo = page.getByRole("listitem").filter({ hasText: cook.name }).getByRole("button", { name: "Undo cook" });
  await undo.first().click();
  await expect(undo).toHaveCount(0);
  expect(await cookDone(page, request, cook)).toBe(false);
  expect(await cupboard(page)).toBe(before);
});

test("Undo in the toast takes back the meal and the cook, and the cupboard is as it was", async ({ page, request }) => {
  const meal = await aMealFromAnUnloggedCook(page, request);
  const { cook } = meal;
  const before = await cupboard(page);

  await page.goto("/life");
  const { tick } = mealRow(page, meal);
  await tick.click();
  await expect(page.getByText(`Logged the cook too: ${cook.name}`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(tick).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(tick).toHaveAttribute("aria-pressed", "false");
  expect(await cookDone(page, request, cook)).toBe(false);
  expect(await portionsLeft(page, cook.name)).toBe(0);
  expect(await cupboard(page)).toBe(before);
});
