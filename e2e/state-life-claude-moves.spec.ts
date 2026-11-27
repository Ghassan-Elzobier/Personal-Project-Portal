import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// Telling Claude "I'll cook that tomorrow", "I've got leftovers, skip tonight's cook"
// or "I'll shop on Monday instead" has to change the week the way the Kitchen's and
// the Meals page's buttons do. Each test changes the plan through Claude's tools,
// sees it on the pages at once and after a reload, and puts the plan back as it was.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day: Monday 16 November 2026. Its meal week runs Sunday 15th to Saturday 21st. */
const TODAY = "2026-11-16";

type Item = { kind: string; title: string; time: string; done: boolean; cook_id?: string; shop_id?: string };
type Claude = Awaited<ReturnType<typeof connectClaude>>;
type Plans = { plans: { start: string; data: unknown }[] | null };

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function routine(claude: Claude, date: string): Promise<Item[]> {
  const answer = await claude.call("get_life_day", { date });
  expect(answer.isError, answer.text).toBe(false);
  return (JSON.parse(answer.text) as { routine: Item[] }).routine;
}

async function connected(page: Page, request: APIRequestContext, run: (claude: Claude) => Promise<void>) {
  const claude = await connectClaude(page, request);
  try {
    await run(claude);
  } finally {
    await claude.disconnect();
  }
}

/** This meal week's first cook still to come, today or later; the week is planned first if nothing is. */
async function aCookToCome(claude: Claude) {
  const find = async () => {
    for (let i = 0; i < 6; i++) {
      const date = dayAfter(TODAY, i);
      const cook = (await routine(claude, date)).find((r) => r.kind === "cook" && r.cook_id && !r.done);
      if (cook) return { date, id: cook.cook_id!, name: cook.title.replace(/^Cook /, ""), time: cook.time };
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
  return cook!;
}

/** The saved plan of the meal week starting `start`, or null, read as the owner. */
async function savedPlan(start: string) {
  const db = await ownerDatabase();
  const read = await db.call<Plans>("life_read", { p_since: "2026-10-19" });
  const plan = (read.plans ?? []).find((p) => p.start === start)?.data ?? null;
  // Saving null takes the week's plan away again, as no page can.
  return { plan, putBack: () => db.call("life_save_plan", { p_start: start, p_data: plan }) };
}

test("a cook session moved through Claude shows at its new time at once and after a reload, and moves back", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    const cook = await aCookToCome(claude);
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const to = cook.time === "21:00" ? "20:00" : "21:00";
    const session = (time: string) =>
      page
        .getByRole("region", { name: "To cook" })
        .locator(`a[href="/life/cook?day=${cook.date}&at=${minutes(time)}"]`)
        .first();

    // Past the week's end, or a cook that isn't there: refused, saying what to do instead.
    const late = await claude.call("move_cook", {
      cook_id: cook.id,
      date: cook.date,
      to_date: "2026-11-30",
      to_time: to,
    });
    expect(late.isError).toBe(true);
    expect(late.text).toBe("Pick a day in this meal week.");
    const none = await claude.call("move_cook", {
      cook_id: "2026-11-16-no-such-recipe",
      date: cook.date,
      to_date: cook.date,
      to_time: to,
    });
    expect(none.isError).toBe(true);
    expect(none.text).toMatch(/^No such cook in the meal week of /);

    let moved = false;
    try {
      const move = await claude.call("move_cook", {
        cook_id: cook.id,
        date: cook.date,
        to_date: cook.date,
        to_time: to,
      });
      expect(move.isError, move.text).toBe(false);
      moved = true;
      const answer = JSON.parse(move.text) as { moved: { cook_id: string }[]; to: { day: string; at: string } };
      expect(answer.moved.map((d) => d.cook_id)).toContain(cook.id);
      expect(answer.to).toEqual({ day: cook.date, at: to });
      expect((await routine(claude, cook.date)).find((r) => r.cook_id === cook.id)?.time).toBe(to);

      await page.goto("/life/kitchen?tab=fridge");
      await expect(session(to)).toBeVisible();
      await expect(session(cook.time)).toHaveCount(0);
      await page.reload();
      await expect(session(to)).toBeVisible();
    } finally {
      if (moved) {
        const back = await claude.call("move_cook", {
          cook_id: cook.id,
          date: cook.date,
          to_date: cook.date,
          to_time: cook.time,
        });
        expect(back.isError, back.text).toBe(false);
      }
    }
    expect((await routine(claude, cook.date)).find((r) => r.cook_id === cook.id)?.time).toBe(cook.time);
    await page.goto("/life/kitchen?tab=fridge");
    await expect(session(cook.time)).toBeVisible();
  });
});

test("a cook skipped through Claude leaves the week at once and after a reload, says what its meals are now, and the plan goes back", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    const cook = await aCookToCome(claude);
    const start = dayAfter(TODAY, -1);
    const saved = await savedPlan(start);
    expect(saved.plan, "the week's plan is saved").toBeTruthy();
    const remove = page
      .getByRole("region", { name: "The week's cooking" })
      .getByRole("button", { name: `Remove ${cook.name}` });
    await page.goto("/life");
    await expect(remove).toBeVisible();

    try {
      const skip = await claude.call("skip_cook", { cook_id: cook.id, date: cook.date });
      expect(skip.isError, skip.text).toBe(false);
      const answer = JSON.parse(skip.text) as {
        skipped: string;
        meals_it_fed: { day: string; meal: string; now: string }[];
        shops: unknown[];
      };
      expect(answer.skipped).toBe(cook.name);
      expect(answer.meals_it_fed.length).toBeGreaterThan(0);
      for (const m of answer.meals_it_fed) expect(m.now).not.toBe(cook.name);
      expect((await routine(claude, cook.date)).some((r) => r.cook_id === cook.id)).toBe(false);

      await page.goto("/life");
      await expect(remove).toHaveCount(0);
      await page.reload();
      await expect(remove).toHaveCount(0);

      // It is gone: a second skip finds nothing to take off.
      const again = await claude.call("skip_cook", { cook_id: cook.id, date: cook.date });
      expect(again.isError).toBe(true);
      expect(again.text).toMatch(/^No such cook in the meal week of /);
    } finally {
      await saved.putBack();
    }
    expect((await routine(claude, cook.date)).some((r) => r.cook_id === cook.id)).toBe(true);
    await page.goto("/life");
    await expect(remove).toBeVisible();
  });
});

test("a shop moved through Claude takes its week along at once and after a reload, and undo puts the week back", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  // Next week, so this week is left as it is: a fresh week straight from the routine,
  // with a shop on Sunday 22nd. Whatever next week had before is put back at the end.
  const SUNDAY = "2026-11-22";
  const MONDAY = "2026-11-23";
  const saved = await savedPlan(SUNDAY);
  try {
    await page.goto("/life?week=next");
    const plan = page.getByRole("button", { name: "Plan a fresh week" });
    const make = page.getByRole("button", { name: "Make it a fresh week" });
    if (await plan.isVisible()) await plan.click();
    else if (await make.isVisible()) await make.click();
    else {
      await page.getByRole("button", { name: "Pick again" }).click();
      await expect(page.getByText("Re-planned.")).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "The week's cooking" }).getByText("Fresh week", { exact: true }),
    ).toBeVisible();

    await connected(page, request, async (claude) => {
      const shop = (await routine(claude, SUNDAY)).find((r) => r.kind === "shop" && r.shop_id && !r.done);
      expect(shop, "next week's Sunday has a shop to do").toBeTruthy();
      const id = shop!.shop_id!;

      const unknown = await claude.call("move_shop", {
        shop_id: "trip-2026-11-30",
        date: SUNDAY,
        to_date: MONDAY,
        to_time: "11:00",
      });
      expect(unknown.isError).toBe(true);
      expect(unknown.text).toMatch(/^No such shop in the meal week of /);
      const nothing = await claude.call("move_shop", {});
      expect(nothing.isError).toBe(true);

      const move = await claude.call("move_shop", { shop_id: id, date: SUNDAY, to_date: MONDAY, to_time: "11:00" });
      expect(move.isError, move.text).toBe(false);
      expect((JSON.parse(move.text) as { moved: string }).moved).toMatch(/^Shop moved to Monday 11:00\./);
      expect((await routine(claude, SUNDAY)).some((r) => r.shop_id === id)).toBe(false);
      expect((await routine(claude, MONDAY)).find((r) => r.shop_id === id)?.time).toBe("11:00");

      await page.goto("/life/kitchen?week=next");
      const monday = page.getByRole("region", { name: "Monday's shop" });
      await expect(monday.getByText("Monday 23 Nov · 11:00")).toBeVisible();
      await page.reload();
      await expect(monday.getByText("Monday 23 Nov · 11:00")).toBeVisible();

      const undo = await claude.call("move_shop", { undo: true, date: MONDAY });
      expect(undo.isError, undo.text).toBe(false);
      expect((await routine(claude, SUNDAY)).find((r) => r.shop_id === id)?.time).toBe(shop!.time);
      await page.reload();
      await expect(page.getByRole("region", { name: "Sunday's shop" })).toBeVisible();
      await expect(monday).toHaveCount(0);
    });
  } finally {
    await saved.putBack();
  }
});
