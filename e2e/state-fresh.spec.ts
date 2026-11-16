import { expect, test, type Page } from "@playwright/test";

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
    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog", { name: "Add a task" });
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
