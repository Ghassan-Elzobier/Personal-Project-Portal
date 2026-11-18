import { expect, test, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// The portal's rule: a tap that changes data changes the page at once, and the
// change is still there after a reload. Each test taps, checks the screen, then
// reloads and checks again, so a view that goes stale, a switch that does not
// switch and a save that only looks saved all fail here. Tests create their own
// uniquely named data and delete it again. They change shared data, so they run in
// their own project, after everything else (playwright.config.ts).

// One test at a time: they share one server and one database, and each creates and
// deletes data, so under parallel load the slow ones ran out of time.
test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

// Tasks and the like are shared data that other suites look at: the Today screenshot
// shows an empty plan until a task exists. So everything a test creates is deleted again.
let created: string[] = [];
test.beforeEach(() => {
  created = [];
});
test.afterEach(async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  for (const name of created) {
    await page.goto("/tasks");
    for (const group of await page.getByText(/\d+ completed/).all()) await group.click();
    const link = page.getByRole("link", { name });
    if ((await link.count()) === 0) continue;
    await link.click();
    await page.getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
});

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function addTask(page: Page, name: string) {
  created.push(name);
  await page.goto("/tasks");
  await page.getByLabel("New task name").first().fill(name);
  await page.getByLabel("New task name").first().press("Enter");
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test.describe("tasks", () => {
  test("a new task shows at once, in both views, and after a reload", async ({ page }) => {
    const name = unique("Fresh task");
    await addTask(page, name);
    await page.reload();
    await expect(page.getByRole("link", { name })).toBeVisible();
    const view = page.getByRole("group", { name: "View" });
    await view.getByRole("link", { name: "Board" }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();
    await view.getByRole("link", { name: "List" }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();
  });

  test("quick add keeps a name that ends in a word starting like a month", async ({ page }) => {
    // "decomposition" starts with "dec", "marginals" with "mar": neither is a date.
    const name = `${unique("Quick")} 3 decomposition`;
    created.push(name);
    await page.goto("/tasks");
    const dialog = page.getByRole("dialog", { name: "Add a task" });
    // The shortcut only works once the page has hydrated, so press it until the dialog opens.
    await expect(async () => {
      await page.keyboard.press("n");
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dialog.getByLabel("New task").fill(name);
    await expect(dialog.getByText(/^Due /)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("link", { name })).toBeVisible();
  });

  test("ticking a task flips at once and stays ticked after a reload", async ({ page }) => {
    const name = unique("Tick task");
    await addTask(page, name);
    const box = page.getByRole("checkbox", { name: `Mark ${name} done` });
    await box.check();
    await expect(page.getByRole("checkbox", { name: `Mark ${name} not done` })).toBeChecked();
    await page.reload();
    for (const group of await page.getByText(/\d+ completed/).all()) await group.click();
    await expect(page.getByRole("checkbox", { name: `Mark ${name} not done` })).toBeChecked();
  });

  test("opening one task, then another, shows each one's own fields and nothing left over", async ({ page }) => {
    const first = unique("First pane");
    const second = unique("Second pane");
    await addTask(page, first);
    await addTask(page, second);
    await page.getByRole("link", { name: first }).click();
    await expect(page.locator("#task-name")).toHaveValue(first);
    await page.locator("#task-evidence").fill("https://example.test/first");
    // The pane covers the list, so the way to the other task is through Close.
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page.locator("#task-name")).toHaveCount(0);
    await page.getByRole("link", { name: second }).click();
    await expect(page.locator("#task-name")).toHaveValue(second);
    await expect(page.locator("#task-evidence")).toHaveValue("");
    await page.reload();
    await expect(page.locator("#task-name")).toHaveValue(second);
  });

  test("the browser's Back button returns to the view you were on", async ({ page }) => {
    await page.goto("/tasks");
    const view = page.getByRole("group", { name: "View" });
    await view.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/view=board/);
    await view.getByRole("link", { name: "List" }).click();
    await expect(page).not.toHaveURL(/view=board/);
    await page.goBack();
    await expect(page).toHaveURL(/view=board/);
    await expect(view.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "true");
  });

  test("a search narrows the list as you type and clears when emptied", async ({ page }) => {
    const name = unique("Findable task");
    await addTask(page, name);
    const search = page.getByLabel("Search tasks");
    await search.fill(name);
    await expect(page.getByRole("link", { name })).toBeVisible();
    await search.fill("zzz-nothing-matches-this");
    await expect(page.getByRole("link", { name })).toHaveCount(0);
    await search.fill("");
    await expect(page.getByRole("link", { name })).toBeVisible();
  });
});

test.describe("the Work and Life switch", () => {
  test("goes to Life, and back to the Work page you left", async ({ page }) => {
    await page.goto("/tasks?view=board");
    await page.getByRole("link", { name: "Life", exact: true }).first().click();
    await expect(page).toHaveURL(/\/life/);
    await page.getByRole("link", { name: "Work", exact: true }).first().click();
    await expect(page).toHaveURL(/\/tasks/);
  });
});

test.describe("shared pages", () => {
  test("the Schedule keeps the space you came from, and Back keeps it too", async ({ page }) => {
    const life = () => page.getByRole("link", { name: "Life", exact: true }).first();
    const work = () => page.getByRole("link", { name: "Work", exact: true }).first();
    await page.goto("/life");
    // The space is remembered by a cookie the page sets once it has loaded.
    await expect
      .poll(async () => (await page.context().cookies()).some((c) => c.name === "portal-space" && c.value === "life"))
      .toBe(true);
    await page.goto("/schedule");
    await expect(life()).toHaveAttribute("aria-current", "true");
    await page.goto("/tasks");
    await expect
      .poll(async () => (await page.context().cookies()).some((c) => c.name === "portal-space" && c.value === "work"))
      .toBe(true);
    await expect(work()).toHaveAttribute("aria-current", "true");
    await page.goto("/schedule");
    await expect(work()).toHaveAttribute("aria-current", "true");
    await page.goBack();
    await expect(work()).toHaveAttribute("aria-current", "true");
  });
});

// A planned fresh week's chip. The plan card's own "Fresh week" option shows before
// anything is saved, so waiting for that text alone can move on mid-save.
const freshWeek = (page: Page) =>
  page.getByRole("region", { name: "The week's cooking" }).getByText("Fresh week", { exact: true });

test.describe("life", () => {
  test("a weigh-in shows as logged at once and is still logged after a reload", async ({ page }) => {
    await page.goto("/life/body");
    const kg = page.getByLabel("Weight in kg");
    await kg.fill("71.4");
    await page.getByRole("button", { name: /^(Save|Update)$/ }).click();
    await expect(page.getByText("Logged", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Logged", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Weight in kg")).toHaveValue("71.4");
  });

  test("a fresh week's shop shows as done at once and after a reload, and Undo brings its list back", async ({
    page,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    // Next week, so this week (and the Meals screenshot) is left as it is.
    await page.goto("/life?week=next");
    const replan = page.getByRole("button", { name: "Make it a fresh week" });
    if (await replan.isVisible()) await replan.click();
    else await page.getByRole("button", { name: "Plan a fresh week" }).click();
    await expect(freshWeek(page)).toBeVisible();

    await page.goto("/life/kitchen?week=next");
    const sunday = page.getByRole("region", { name: "Sunday's shop" });
    await expect(sunday).toBeVisible();
    await expect(page.getByRole("region", { name: "Wednesday's shop" })).toBeVisible();
    await sunday.getByRole("button", { name: "Done shopping" }).click();
    await page.getByRole("button", { name: /^Put \d+ items? away$/ }).click();

    const done = page.getByRole("region", { name: "Shops done" });
    await expect(done.getByText("Sunday's shop")).toBeVisible();
    await expect(page.getByRole("region", { name: "Sunday's shop" })).toHaveCount(0);
    await page.reload();
    await expect(done.getByText("Sunday's shop")).toBeVisible();
    await expect(page.getByRole("region", { name: "Sunday's shop" })).toHaveCount(0);

    // Back as it was: the shop's list returns and its food leaves the kitchen.
    await done.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("region", { name: "Sunday's shop" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Sunday's shop" })).toBeVisible();
  });

  test("in the shop, a tick adds to the basket at once and stays after a reload; Not found moves an item on", async ({
    page,
  }) => {
    // A fresh week next week, so this week (and the Meals screenshot) is left as it is.
    await page.goto("/life?week=next");
    const plan = page.getByRole("button", { name: "Plan a fresh week" });
    const make = page.getByRole("button", { name: "Make it a fresh week" });
    if (await plan.isVisible()) await plan.click();
    else if (await make.isVisible()) {
      page.once("dialog", (dialog) => void dialog.accept());
      await make.click();
    }
    await expect(freshWeek(page)).toBeVisible();

    await page.goto("/life/kitchen?week=next");
    const sunday = page.getByRole("region", { name: "Sunday's shop" });
    await sunday.getByRole("button", { name: "Shop in store" }).click();
    const basket = sunday.getByLabel("Basket");
    await expect(basket).toContainText("£0.00 in the basket");

    // The phone keeps unsent ticks; wait until it has sent them, then forget them, so a
    // reload can only show what the portal saved.
    const sent = async () => {
      await expect(sunday.getByText("Saved on this phone")).toHaveCount(0);
      await page.evaluate(() => window.localStorage.clear());
    };

    const ticks = sunday.locator("li button[aria-pressed]");
    const first = ticks.first();
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(basket).not.toContainText("£0.00 in the basket");
    await sent();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Sunday's shop" }).locator("li button[aria-pressed]").first(),
    ).toHaveAttribute("aria-pressed", "true");

    // Not found: the item leaves Sunday's list for Wednesday's, and stays there after a reload.
    const line = sunday
      .locator("li")
      .filter({ has: page.locator('button[aria-pressed="false"]') })
      .first();
    const name = (await line.locator("button[aria-pressed] span.block").first().innerText()).split(" × ")[0].trim();
    await line.getByRole("button", { name: `${name} not found` }).click();
    const gone = sunday.getByRole("region", { name: "Not found" });
    await expect(gone.getByText(name)).toBeVisible();
    await expect(gone.getByText("Moved to Wednesday's shop")).toBeVisible();
    await sent();
    await page.reload();
    await expect(page.getByRole("region", { name: "Wednesday's shop" }).getByText(name).first()).toBeVisible();
    await expect(sunday.getByRole("region", { name: "Not found" }).getByText(name)).toBeVisible();

    // Back as it was: found after all, and nothing ticked.
    await sunday.getByRole("button", { name: `Found ${name} after all` }).click();
    await expect(sunday.getByRole("region", { name: "Not found" })).toHaveCount(0);
    const ticked = sunday.locator('li button[aria-pressed="true"]');
    while ((await ticked.count()) > 0) await ticked.first().click();
    await sent();
  });

  test("a fresh week's shop is on the Schedule with its list, and says done at once and after a reload", async ({
    page,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    // The Schedule shows the Life plan once Life can work out targets: made-up details, cleared at the end.
    const body = async (sex: string, born: string, height: string) => {
      await page.goto("/life/settings");
      await page.getByLabel("Sex for the maths").selectOption(sex);
      await page.getByLabel("Born in").fill(born);
      await page.getByLabel("Height cm").fill(height);
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Saved. Plans and portions follow it from now on.").first()).toBeVisible();
    };
    await body("male", "1990", "175");
    try {
      // Next week, so this week (and the Meals screenshot) is left as it is.
      await page.goto("/life?week=next");
      const plan = page.getByRole("button", { name: "Plan a fresh week" });
      const make = page.getByRole("button", { name: "Make it a fresh week" });
      if (await plan.isVisible()) await plan.click();
      else if (await make.isVisible()) await make.click();
      await expect(freshWeek(page)).toBeVisible();

      // Next meal week starts on Sunday the 22nd, the last day of this week's Schedule.
      const sundayShop = async () => {
        await page.getByRole("button", { name: /^Sun\s*22$/ }).click();
        return page.getByRole("button", { name: /Shop: / });
      };
      await page.goto("/schedule");
      await expect(await sundayShop()).toContainText(/Shop: \d+ items?, (about )?£\d+\.\d\d/);

      await page.goto("/life/kitchen?week=next");
      await page.getByRole("region", { name: "Sunday's shop" }).getByRole("button", { name: "Done shopping" }).click();
      await page.getByRole("button", { name: /^Put \d+ items? away$/ }).click();
      const done = page.getByRole("region", { name: "Shops done" });
      await expect(done.getByText("Sunday's shop")).toBeVisible();

      await page.goto("/schedule");
      await expect(await sundayShop()).toContainText("Shop: done");
      await page.reload();
      await expect(await sundayShop()).toContainText("Shop: done");

      // Back as it was: the shop's list returns.
      await page.goto("/life/kitchen?week=next");
      await done.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("region", { name: "Sunday's shop" })).toBeVisible();
    } finally {
      await body("", "", "");
    }
  });
});

test.describe("errors page", () => {
  test("Ignore moves a bug between the lists at once, and Restore brings it back", async ({ page }) => {
    await page.goto("/errors/5eed0000000000000000000000000002");
    await page.getByRole("button", { name: "Ignore" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Ignore" })).toBeVisible();
  });
});

test.describe("money", () => {
  test("connecting the bank shows the balance at once and after a reload, and Refresh brings the new one", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=123456`);
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await expect(page.getByRole("checkbox", { name: "Current account ••1234" })).toBeChecked();
    await page.getByRole("button", { name: "Connect this account" }).click();

    const balance = page.getByRole("region", { name: "Balance" });
    await expect(balance.getByText("£1,234.56")).toBeVisible();
    await page.reload();
    await expect(balance.getByText("£1,234.56")).toBeVisible();

    // The bank moves on: Refresh fetches Lunch Flow's latest copy.
    await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=-4205`);
    await balance.getByRole("button", { name: "Refresh" }).click();
    await expect(balance.getByText("−£42.05")).toBeVisible();
    await page.reload();
    await expect(balance.getByText("−£42.05")).toBeVisible();

    // Erasing leaves nothing behind, so the Money screenshot stays as approved.
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });
});
