import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Telling Claude "done at the gym" or "I cooked it" has to close the same loop a
// button closes: the programme moves on to the next workout, and the cook fills
// the fridge. Each test logs through Claude's tools, looks at the pages, reloads,
// and puts things back.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** The suite's pinned day: a Monday, and a gym day. */
const TODAY = "2026-11-16";

type LifeDay = {
  routine: { kind: string; title: string; done: boolean; cook_id?: string }[];
  gym?: { workout: string; exercises: { exercise: string }[] };
};
type Claude = Awaited<ReturnType<typeof connectClaude>>;

async function lifeDay(claude: Claude, date: string): Promise<LifeDay> {
  const answer = await claude.call("get_life_day", { date });
  expect(answer.isError, answer.text).toBe(false);
  return JSON.parse(answer.text) as LifeDay;
}

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The next day after `date` with a gym session on it. */
async function nextGymDay(claude: Claude, date: string): Promise<{ date: string; day: LifeDay }> {
  for (let i = 1; i <= 7; i++) {
    const day = await lifeDay(claude, dayAfter(date, i));
    if (day.gym) return { date: dayAfter(date, i), day };
  }
  throw new Error("no gym day in the week after the suite's Monday");
}

async function connected(page: Page, request: APIRequestContext, run: (claude: Claude) => Promise<void>) {
  const claude = await connectClaude(page, request);
  try {
    await run(claude);
  } finally {
    await claude.disconnect();
  }
}

test("finishing the gym session through Claude moves the programme on at once and after a reload, and reopening puts it back", async ({
  page,
  request,
}) => {
  await connected(page, request, async (claude) => {
    // From a known start: a run that stopped half-way (CI tries a failed test again) may have left today finished.
    await claude.call("finish_gym_session", { date: TODAY, reopen: true });
    const before = await lifeDay(claude, TODAY);
    expect(before.gym, "the suite's Monday is a gym day").toBeTruthy();
    const workout = before.gym!.workout;
    const exercise = before.gym!.exercises[0].exercise;
    const later = await nextGymDay(claude, TODAY);
    expect(later.day.gym!.workout, "before anything is finished, the next gym day offers the same workout").toBe(
      workout,
    );

    // A day with nothing logged has nothing to finish.
    const empty = await claude.call("finish_gym_session", { date: later.date });
    expect(empty.isError).toBe(true);
    expect(empty.text).toBe(
      `Nothing is logged on ${later.date} yet. Log the sets with log_gym_set first, then finish the session.`,
    );

    const set = await claude.call("log_gym_set", { exercise, position: 1, reps: 3, date: TODAY });
    expect(set.isError, set.text).toBe(false);
    const finish = await claude.call("finish_gym_session", { date: TODAY, feel: 4 });
    expect(finish.isError, finish.text).toBe(false);
    const finished = JSON.parse(finish.text) as { finished: string; sets_logged: number; next_workout: string };
    expect(finished.finished).toBe(workout);
    expect(finished.sets_logged).toBe(1);
    expect(finished.next_workout).not.toBe(workout);

    // The loop is closed: the next gym day is the next workout, and today's is done.
    expect((await lifeDay(claude, later.date)).gym!.workout).toBe(finished.next_workout);
    expect((await lifeDay(claude, TODAY)).routine.find((r) => r.kind === "gym")?.done).toBe(true);

    // (Today lists the gym only once the Life profile is set up, which the seed leaves empty.)
    await page.goto("/life/gym");
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

    // Finishing twice changes nothing more.
    const again = await claude.call("finish_gym_session", { date: TODAY });
    expect(again.isError, again.text).toBe(false);
    expect((await lifeDay(claude, later.date)).gym!.workout).toBe(finished.next_workout);

    // Reopened, the programme is back where it was.
    const reopen = await claude.call("finish_gym_session", { date: TODAY, reopen: true });
    expect(reopen.isError, reopen.text).toBe(false);
    expect((await lifeDay(claude, later.date)).gym!.workout).toBe(workout);
    const nothing = await claude.call("finish_gym_session", { date: TODAY, reopen: true });
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toBe(`No finished session on ${TODAY} to reopen.`);

    // Back as it was: the set is taken off on the gym page.
    await page.goto("/life/gym");
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo set 1" }).click();
    await expect(page.getByRole("button", { name: "Undo set 1" })).toHaveCount(0);
  });
});

test("a cook logged through Claude fills the fridge at once and after a reload, and can't be logged twice", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await connected(page, request, async (claude) => {
    // A cook from this meal week's plan. An earlier save test may have planned the week; if none has, plan it now.
    const findCook = async () => {
      for (let i = 0; i < 7; i++) {
        const date = dayAfter(TODAY, i);
        const cook = (await lifeDay(claude, date)).routine.find((r) => r.kind === "cook" && r.cook_id && !r.done);
        if (cook) return { date, id: cook.cook_id!, name: cook.title.replace(/^Cook /, "") };
      }
      return null;
    };
    let cook = await findCook();
    if (!cook) {
      const planned = await claude.call("plan_meal_week", {});
      expect(planned.isError, planned.text).toBe(false);
      cook = await findCook();
    }
    expect(cook, "the planned week has something to cook").toBeTruthy();
    const { date, id, name } = cook!;

    const wrong = await claude.call("log_cook", { cook_id: "2026-11-16-no-such-recipe", date });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/^No such cook in the meal week of /);

    const log = await claude.call("log_cook", { cook_id: id, date });
    expect(log.isError, log.text).toBe(false);
    const logged = JSON.parse(log.text) as {
      cooked: string;
      portions: number;
      to_the_fridge: number;
      to_the_freezer: number;
    };
    expect(logged.cooked).toBe(name);
    expect(logged.portions).toBeGreaterThan(0);
    expect(logged.to_the_fridge + logged.to_the_freezer).toBe(logged.portions);

    // The plan has moved on, and the Kitchen holds the batch.
    const item = (await lifeDay(claude, date)).routine.find((r) => r.cook_id === id);
    expect(item?.done).toBe(true);
    const batches = page.getByRole("listitem").filter({ hasText: name });
    const undo = batches.getByRole("button", { name: "Undo cook" });
    await page.goto("/life/kitchen?tab=fridge");
    await expect(undo.first()).toBeVisible();
    await page.reload();
    await expect(undo.first()).toBeVisible();

    const twice = await claude.call("log_cook", { cook_id: id, date });
    expect(twice.isError).toBe(true);
    expect(twice.text).toBe(`${name} is already logged as cooked. To undo it, use Undo cook in the Kitchen.`);

    // Back as it was: the cook is undone in the Kitchen, and is there to log again.
    // A cook split between fridge and freezer shows a batch for each; one Undo cook takes them all.
    await undo.first().click();
    await expect(undo).toHaveCount(0);
    await page.reload();
    await expect(undo).toHaveCount(0);
    expect((await lifeDay(claude, date)).routine.find((r) => r.cook_id === id)?.done).toBe(false);
  });
});
