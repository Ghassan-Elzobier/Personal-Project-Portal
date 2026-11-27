import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// "I had the leftovers instead": a meal eaten from cooked food in the kitchen, in
// place of the plan, is logged from the meal's sheet (or by telling Claude). The
// portion comes out of that batch, the meal shows that dish, at once and after a
// reload, and clearing it puts the portion back. Each test cooks a planned dish
// through Claude for the leftovers, and undoes the cook at the end.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day, a Monday. */
const TODAY = "2026-11-16";

type Claude = Awaited<ReturnType<typeof connectClaude>>;
type Kitchen = { batch: string; recipe: string; portions_left: number; where: string; eat_by: string | null }[];
type LifeDay = {
  routine: { kind: string; title: string; done: boolean; slot?: string; cook_id?: string; detail: string }[];
  kitchen: Kitchen;
};

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/**
 * Leftovers to eat: this meal week's first cook still to come (the week planned first
 * if nothing is), logged through Claude, so the fridge holds a batch of it.
 */
async function cookedLeftovers(claude: Claude) {
  const find = async () => {
    for (let i = 0; i < 6; i++) {
      const date = dayAfter(TODAY, i);
      const cook = (await lifeDay(claude, date)).routine.find((r) => r.kind === "cook" && r.cook_id && !r.done);
      if (cook) return { date, id: cook.cook_id!, name: cook.title.replace(/^Cook /, "") };
    }
    return null;
  };
  let cook = await find();
  if (!cook) {
    const planned = await claude.call("plan_meal_week", {});
    expect(planned.isError, planned.text).toBe(false);
    cook = await find();
  }
  expect(cook, "the planned week has something to cook").toBeTruthy();
  const logged = await claude.call("log_cook", { cook_id: cook!.id, date: cook!.date });
  expect(logged.isError, logged.text).toBe(false);
  const batch = (await lifeDay(claude, TODAY)).kitchen.find((b) => b.recipe === cook!.name && b.where === "fridge");
  expect(batch, "the cook's portions are in the fridge").toBeTruthy();
  return { name: cook!.name, batch: batch!.batch, left: batch!.portions_left };
}

/** Takes the cook back in the Kitchen: one Undo cook takes its fridge and freezer batches. */
async function undoCook(page: Page, name: string) {
  await page.goto("/life/kitchen?tab=fridge");
  const undo = page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Undo cook" });
  await undo.first().click();
  await expect(undo).toHaveCount(0);
}

const left = async (claude: Claude, batch: string) =>
  (await lifeDay(claude, TODAY)).kitchen.find((b) => b.batch === batch)?.portions_left ?? 0;

/** Today's card on the Meals page, one of its meals, and that meal's sheet. */
const todayCard = (page: Page) => page.getByRole("region", { name: "Days" }).getByRole("article").first();
const mealRow = (page: Page, slot: string) => todayCard(page).getByRole("listitem").filter({ hasText: slot });
const sheet = (page: Page, slot: string) => page.getByRole("dialog", { name: `Today: ${slot}` });

test("leftovers eaten in place of a meal are logged from its sheet at once and after a reload, and clearing puts the portion back", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await connected(page, request, async (claude) => {
    const food = await cookedLeftovers(claude);
    try {
      // A meal today whose planned dish isn't the leftovers', so its sheet offers them.
      const meal = (await lifeDay(claude, TODAY)).routine.find(
        (r) => r.kind === "meal" && (r.slot === "lunch" || r.slot === "dinner") && r.detail !== food.name && !r.done,
      );
      expect(meal, "a lunch or dinner today that isn't the leftovers' dish").toBeTruthy();
      const slot = meal!.slot === "lunch" ? "Lunch" : "Dinner";
      await page.goto("/life");
      await mealRow(page, slot).getByRole("button").nth(1).click();
      await sheet(page, slot)
        .getByRole("region", { name: "Leftovers in the kitchen" })
        .getByRole("button", { name: new RegExp(`^${escape(food.name)}`) })
        .click();
      const row = mealRow(page, slot);
      const ticked = row.getByRole("button", { name: `Untick ${slot}` });
      await expect(ticked).toHaveAttribute("aria-pressed", "true");
      await expect(row).toContainText(food.name);
      await page.reload();
      await expect(ticked).toHaveAttribute("aria-pressed", "true");
      await expect(row).toContainText(food.name);

      // The portion came out of that batch, as the Kitchen shows it.
      expect(await left(claude, food.batch)).toBe(food.left - 1);
      await page.goto("/life/kitchen?tab=fridge");
      const cooked = page
        .getByRole("region", { name: "Cooked food" })
        .getByRole("listitem")
        .filter({ hasText: food.name })
        .filter({ hasText: "Fridge" });
      await expect(cooked.first()).toContainText(`${food.left - 1}/`);

      // Cleared, the meal is unticked and the portion is back.
      await page.goto("/life");
      await row.getByRole("button").nth(1).click();
      await sheet(page, slot).getByRole("button", { name: "Clear what I logged" }).click();
      await expect(ticked).toHaveCount(0);
      await page.reload();
      await expect(row.getByRole("button", { name: `Untick ${slot}` })).toHaveCount(0);
      expect(await left(claude, food.batch)).toBe(food.left);
    } finally {
      await undoCook(page, food.name);
    }
  });
});

test("telling Claude logs leftovers the same way, and refuses them for a meal not eaten", async ({ page, request }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await connected(page, request, async (claude) => {
    const food = await cookedLeftovers(claude);
    try {
      const wrong = await claude.call("log_meal", {
        slot: "lunch",
        status: "skipped",
        from_batch: food.batch,
        date: TODAY,
      });
      expect(wrong.isError).toBe(true);
      expect(wrong.text).toBe("from_batch goes with status eaten.");
      const gone = await claude.call("log_meal", {
        slot: "lunch",
        status: "eaten",
        from_batch: "999999999",
        date: TODAY,
      });
      expect(gone.isError).toBe(true);
      expect(gone.text).toBe("That food isn't in the kitchen any more. Reload to see what is.");

      const logged = await claude.call("log_meal", {
        slot: "lunch",
        status: "eaten",
        from_batch: food.batch,
        date: TODAY,
      });
      expect(logged.isError, logged.text).toBe(false);
      expect(await left(claude, food.batch)).toBe(food.left - 1);
      const lunch = (await lifeDay(claude, TODAY)).routine.find((r) => r.kind === "meal" && r.slot === "lunch");
      expect(lunch?.done).toBe(true);
      expect(lunch?.detail).toBe(food.name);

      const row = mealRow(page, "Lunch");
      await page.goto("/life");
      await expect(row.getByRole("button", { name: "Untick Lunch" })).toHaveAttribute("aria-pressed", "true");
      await expect(row).toContainText(food.name);

      // Cleared through Claude: the portion is back.
      const clear = await claude.call("log_meal", { slot: "lunch", status: "clear", date: TODAY });
      expect(clear.isError, clear.text).toBe(false);
      expect(await left(claude, food.batch)).toBe(food.left);
      await page.reload();
      await expect(row.getByRole("button", { name: "Untick Lunch" })).toHaveCount(0);
    } finally {
      await undoCook(page, food.name);
    }
  });
});
