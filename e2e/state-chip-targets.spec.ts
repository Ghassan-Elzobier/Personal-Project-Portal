import { expect, test, type Locator, type Page } from "@playwright/test";

// The Tasks filters and Log's quick hours are ToggleChips, 44 px tall (#202).
// Both show only once a task exists, so each test adds its own task and deletes
// it again: other suites' screenshots show an empty plan.
// Runs at the Pixel 7's 412 px and the 360 px small phone (playwright.config.ts).

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const MIN = 43.5;
let created: string[] = [];

test.beforeEach(() => {
  created = [];
});
test.afterEach(async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  for (const name of created) {
    await page.goto("/tasks");
    const link = page.getByRole("link", { name });
    if ((await link.count()) === 0) continue;
    await link.click();
    await page.getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
});

async function addTask(page: Page) {
  const name = `Chip task ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  created.push(name);
  await page.goto("/tasks");
  await page.getByLabel("New task name").first().fill(name);
  await page.getByLabel("New task name").first().press("Enter");
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function tooSmall(targets: Locator): Promise<string[]> {
  const all = await targets.all();
  expect(all.length, "there are chips to measure").toBeGreaterThan(0);
  const small: string[] = [];
  for (const target of all) {
    const box = await target.boundingBox();
    if (!box || box.height < MIN)
      small.push(`"${(await target.textContent())?.trim()}" is ${Math.round(box?.height ?? 0)} px tall`);
  }
  return small;
}

async function noSidewaysScroll(page: Page) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the page does not scroll sideways").toBe(false);
}

test("the Tasks filters are thumb-sized, and tapping one moves the choice", async ({ page }) => {
  await addTask(page);
  const filters = page.getByRole("group", { name: "Filter" });
  expect(await tooSmall(filters.getByRole("button")), `targets under ${MIN} px`).toEqual([]);
  await noSidewaysScroll(page);

  const all = filters.getByRole("button", { name: "All", exact: true });
  const overdue = filters.getByRole("button", { name: "Overdue", exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await overdue.click();
  await expect(overdue).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
});

test("the quick hours on Log are thumb-sized", async ({ page }) => {
  await addTask(page);
  await page.goto("/log");
  const hours = page.getByRole("group", { name: /Hours this session/ }).getByRole("button");
  expect(await tooSmall(hours), `targets under ${MIN} px`).toEqual([]);
  await noSidewaysScroll(page);
});
