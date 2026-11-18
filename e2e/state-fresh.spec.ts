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

  test("Undo after Done shopping puts the cupboard staples back as they were, at once and after a reload", async ({
    page,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    // Next week, so this week (and the Meals screenshot) is left as it is.
    await page.goto("/life?week=next");
    const plan = page.getByRole("button", { name: "Plan a fresh week" });
    const make = page.getByRole("button", { name: "Make it a fresh week" });
    if (await plan.isVisible()) await plan.click();
    else if (await make.isVisible()) await make.click();
    await expect(freshWeek(page)).toBeVisible();

    await page.goto("/life/kitchen?week=next");
    const sunday = page.getByRole("region", { name: "Sunday's shop" });
    // Staples nobody has marked yet: Done marks them "have", and Undo must unmark them.
    const staples = sunday.getByRole("region", { name: "Already have any of these?" }).locator("button[aria-pressed]");
    await expect(staples.first()).toBeVisible();
    const unmarked = await staples.count();
    await sunday.getByRole("button", { name: "Done shopping" }).click();
    await page.getByRole("button", { name: /^Put \d+ items? away$/ }).click();
    const done = page.getByRole("region", { name: "Shops done" });
    await done.getByRole("button", { name: "Undo" }).click();

    await expect(staples).toHaveCount(unmarked);
    await page.reload();
    await expect(staples).toHaveCount(unmarked);
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

  test("payments come in with the connection and the scheduled sync, and a statement fills a day the feed missed, once", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const feed = (list: object[]) => request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: list });
    await feed([
      { id: "t1", date: "2026-11-13", pence: -1234, text: "EXAMPLE GROCER" },
      { id: "t2", date: "2026-11-15", pence: -500, text: "EXAMPLE BAKERY", pending: true },
    ]);
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await page.getByRole("button", { name: "Connect this account" }).click();
    const payments = page.getByRole("region", { name: "Payments" });
    await expect(payments.getByText("EXAMPLE GROCER")).toBeVisible();
    await expect(payments.getByText("EXAMPLE BAKERY")).toBeVisible();
    await expect(payments.getByText("Pending", { exact: true }).first()).toBeVisible();

    // The scheduled sync: register its key, then the cron call brings what the bank booked since.
    const connection = page.getByRole("region", { name: "Bank connection" });
    await connection.getByRole("button", { name: "Register" }).click();
    await expect(connection.getByText("On. It runs at the next scheduled time.")).toBeVisible();
    await feed([
      { id: "t1", date: "2026-11-13", pence: -1234, text: "EXAMPLE GROCER" },
      { id: "t3", date: "2026-11-15", pence: -500, text: "EXAMPLE BAKERY" },
    ]);
    const cron = (secret: string) =>
      request.get("/api/money/sync", { headers: { authorization: `Bearer ${secret}` }, maxRedirects: 0 });
    expect((await cron("not-the-secret")).status()).toBe(401);
    const ran = await cron(process.env.CRON_SECRET ?? "");
    expect(await ran.json()).toEqual({ ran: true, outcome: "ok" });
    await page.reload();
    await expect(payments.getByText("Pending", { exact: true })).toHaveCount(0);
    await expect(payments.getByText("EXAMPLE BAKERY")).toHaveCount(1);
    await expect(connection.getByText(/^On\. Last ran /)).toBeVisible();

    // A statement: the grocer is already in (same day and amount), the shop on the 10th is new.
    const file = [
      '"Account Name:","Example ****1234"',
      "",
      '"Date","Transaction type","Description","Paid out","Paid in","Balance"',
      '"10 Nov 2026","Visa purchase","EXAMPLE SHOP","£20.00","","£980.00"',
      '"13 Nov 2026","Visa purchase","EXAMPLE GROCER LONDON","£12.34","","£967.66"',
    ].join("\n");
    const upload = async () => {
      await page.goto("/life/money/upload");
      await page
        .getByLabel("CSV file")
        .setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
      await page.getByRole("button", { name: "Add the statement" }).click();
    };
    await upload();
    await expect(
      page.getByRole("status").filter({ hasText: "Added 1 payment; 1 the portal already had was left out." }),
    ).toBeVisible();
    await page.goto("/life/money");
    await expect(payments.getByText("EXAMPLE SHOP")).toBeVisible();
    await expect(payments.getByText("From a statement")).toBeVisible();
    await page.reload();
    await expect(payments.getByText("EXAMPLE SHOP")).toBeVisible();
    await upload();
    await expect(page.getByText("That statement is in already.")).toBeVisible();

    // Back as it was.
    await feed([]);
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });

  test("sorting a payment shows at once, 'always' sorts the merchant's others, and Claude's access is set here", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const merchant = unique("Example Grocer").toUpperCase();
    const feed = (list: object[]) => request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: list });
    await feed([
      { id: "s1", date: "2026-11-13", pence: -1234, text: merchant },
      { id: "s2", date: "2026-11-14", pence: -2345, text: merchant },
    ]);
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await page.getByRole("button", { name: "Connect this account" }).click();
    const payments = page.getByRole("region", { name: "Payments" });
    const rows = payments.getByRole("button", { name: new RegExp(merchant) });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Not sorted");

    await rows.first().click();
    const sheet = page.getByRole("dialog", { name: "What was this for?" });
    await expect(sheet.getByRole("checkbox", { name: "Always for this merchant" })).toBeChecked();
    await sheet.getByRole("button", { name: "Groceries" }).click();
    await expect(rows.first()).toContainText("Groceries");
    await expect(rows.nth(1)).toContainText("Groceries");
    await page.reload();
    await expect(rows.nth(0)).toContainText("Groceries");
    await expect(rows.nth(1)).toContainText("Groceries");

    // What Claude may do with Money: set here, and it stays.
    const claude = page.getByRole("region", { name: "What Claude can do with Money" });
    await expect(claude.getByRole("button", { name: "Setup (current)" })).toBeVisible();
    await claude.getByRole("button", { name: "Summary" }).click();
    await expect(claude.getByRole("button", { name: "Summary (current)" })).toBeVisible();
    await page.reload();
    await expect(claude.getByRole("button", { name: "Summary (current)" })).toBeVisible();

    // Back as it was.
    await claude.getByRole("button", { name: "Setup" }).click();
    await expect(claude.getByRole("button", { name: "Setup (current)" })).toBeVisible();
    await feed([]);
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });

  test("the weekly amount shows what's left this week at once and after a reload, on Money and on Today", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    // The suite's clock is Monday 16 November: one unsorted payment this week.
    await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=123456`);
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, {
      data: [{ id: "w1", date: "2026-11-16", pence: -1234, text: "EXAMPLE MARKET" }],
    });
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await page.getByRole("button", { name: "Connect this account" }).click();
    const week = page.getByRole("region", { name: "This week" });
    await expect(week.getByText("Set the amount you live on each week")).toBeVisible();

    const plan = page.getByRole("region", { name: "Your plan" });
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("£137.66 left")).toBeVisible();
    await expect(week.getByText(/until payday on Mon 30 Nov/)).toBeVisible();
    await page.reload();
    await expect(week.getByText("£137.66 left")).toBeVisible();
    await expect(plan.getByLabel("To live on each week (£)")).toHaveValue("150");

    await page.goto("/");
    await expect(page.getByRole("link", { name: /£137\.66 left this week/ })).toBeVisible();

    // Back as it was.
    await page.goto("/life/money");
    await plan.getByLabel("To live on each week (£)").fill("");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });

  test("a planned purchase counts against this week at once and after a reload, and cancelling gives it back", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=123456`);
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await page.getByRole("button", { name: "Connect this account" }).click();
    const week = page.getByRole("region", { name: "This week" });
    const plan = page.getByRole("region", { name: "Your plan" });
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("£150.00 left")).toBeVisible();

    // £60 spread over 3 weeks: £20 off this week (the suite's clock is Monday 16 November).
    const planned = page.getByRole("region", { name: "Planned purchases" });
    await planned.getByRole("button", { name: "Plan a purchase" }).click();
    await planned.getByLabel("What for").fill("Bike repair");
    await planned.getByLabel("Cost (£)").fill("60");
    await planned.getByLabel("When you'll pay").fill("2026-11-16");
    await planned.getByLabel("Paid for").selectOption("spread");
    // A label around a select takes in its options' text, so match the label's start.
    await planned.getByRole("combobox", { name: /^Weeks/ }).selectOption("3");
    await planned.getByRole("button", { name: "Plan it" }).click();
    await expect(planned.getByText("Bike repair", { exact: true })).toBeVisible();
    await expect(planned.getByText(/^£60\.00 · /)).toBeVisible();
    await expect(week.getByText("£130.00 left")).toBeVisible();
    await page.reload();
    await expect(week.getByText("£130.00 left")).toBeVisible();

    await planned.getByRole("button", { name: "Cancel Bike repair" }).click();
    await expect(week.getByText("£150.00 left")).toBeVisible();
    await expect(planned.getByText("Nothing planned.")).toBeVisible();

    // Back as it was.
    await plan.getByLabel("To live on each week (£)").fill("");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });

  test("Money finds a bill in the payments by itself, and one ignored stays ignored after a reload", async ({
    page,
    request,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const feed = (list: object[]) => request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: list });
    // Three monthly payments to a made-up streaming service: a bill nobody had to set up.
    await feed([
      { id: "b1", date: "2026-09-10", pence: -1299, text: "EXAMPLE STREAMING" },
      { id: "b2", date: "2026-10-10", pence: -1299, text: "EXAMPLE STREAMING" },
      { id: "b3", date: "2026-11-10", pence: -1299, text: "EXAMPLE STREAMING" },
    ]);
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
    await page.getByRole("button", { name: "Connect this account" }).click();

    const bills = page.getByRole("region", { name: "Bills" });
    await expect(bills.getByText("£12.99 a month · next 10 Dec")).toBeVisible();
    await page.reload();
    await expect(bills.getByText("£12.99 a month · next 10 Dec")).toBeVisible();

    await bills.getByRole("button", { name: "Ignore EXAMPLE STREAMING" }).click();
    await expect(bills.getByText(/^None found yet/)).toBeVisible();
    await expect(bills.getByText("Ignored (1)")).toBeVisible();
    await page.reload();
    await expect(bills.getByText(/^None found yet/)).toBeVisible();

    // The next sync finds it again, and leaves it ignored.
    await page.getByRole("region", { name: "Balance" }).getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Up to date.")).toBeVisible();
    await page.reload();
    await expect(bills.getByText("Ignored (1)")).toBeVisible();
    await expect(bills.getByText(/^None found yet/)).toBeVisible();

    // Back as it was.
    await feed([]);
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  });
});
