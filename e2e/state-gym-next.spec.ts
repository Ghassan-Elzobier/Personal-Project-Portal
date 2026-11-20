import { expect, test, type Locator, type Page } from "@playwright/test";

// Between sets the gym page has to say what comes next and take you there: most
// blocks alternate two exercises, each on its own card, so the next set is a
// screen away. These tests read the session from the page (they name no exercise),
// tick sets as a lifter would, and take every tick off again.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const nextBar = (page: Page) => page.getByRole("button", { name: /^(Next|All sets done)/ });
/** The row the session comes to next, and the card it is on. */
const nextRow = (page: Page) => page.locator('li[aria-current="step"]');
const cardOf = (page: Page, row: Locator) => page.locator("article").filter({ has: row });

/** The next set's row id ("set-<exercise>-<number>") and the name of its exercise, once the bar names that exercise. */
async function upNext(page: Page): Promise<{ id: string; name: string }> {
  const row = nextRow(page);
  await expect(row).toHaveCount(1);
  const id = (await row.getAttribute("id")) ?? "";
  const name = (await cardOf(page, row).getByRole("heading", { level: 3 }).textContent()) ?? "";
  expect(id).toMatch(/^set-[a-z0-9-]+-\d+$/);
  await expect(nextBar(page)).toContainText(`${name} · set ${id.split("-").at(-1)}`);
  return { id, name };
}

/**
 * Whether the tick is wholly on screen and clear of everything that sticks to an
 * edge: the header and the bar under it at the top, the tab bar at the bottom, and
 * the rest timer above that when it is showing.
 */
async function inTheClear(page: Page, tick: Locator): Promise<boolean> {
  const box = await tick.boundingBox();
  const top = await page.getByRole("progressbar", { name: "Sets done" }).boundingBox();
  const tabs = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  if (!box || !top || !tabs) return false;
  const timer = page.getByRole("timer");
  const rest = (await timer.count()) > 0 ? await timer.boundingBox() : null;
  const floor = Math.min(tabs.y, rest?.y ?? Infinity);
  return box.y >= top.y + top.height && box.y + box.height <= floor;
}

test("the bar under the header names the next set, and a tap brings it into view with its tick focused", async ({
  page,
}) => {
  await page.goto("/life/gym");
  const first = await upNext(page);
  expect(first.id.endsWith("-1"), "a session starts at a first set").toBe(true);

  const tick = page.locator(`#${first.id}-button`);
  await expect(tick).not.toBeFocused();
  await nextBar(page).click();
  await expect(tick).toBeFocused();
  await expect(tick).toHaveAccessibleName("Done set 1");
  await expect.poll(() => inTheClear(page, tick), "the tick is on screen, clear of the bars").toBe(true);
});

test("ticking the next set names the one after it at once and after a reload, and the rest timer names it and jumps to it too", async ({
  page,
}) => {
  await page.goto("/life/gym");
  const first = await upNext(page);
  await nextBar(page).click();
  await page.locator(`#${first.id}-button`).click();

  // The bar moves on at once. The first block alternates, so the next set is on another card.
  await expect(page.locator(`#${first.id}-button`)).toHaveAccessibleName("Undo set 1");
  const second = await upNext(page);
  expect(second.id).not.toBe(first.id);
  expect(second.name, "a superset alternates: the next set is the other exercise's").not.toBe(first.name);

  // The rest timer says what comes next as well, and the whole of it is the way there.
  const timer = page.getByRole("timer");
  await expect(timer).toContainText(`${second.name} · set 1`);
  await timer.getByRole("button", { name: /^(Rest, then|Go:) / }).click();
  const tick = page.locator(`#${second.id}-button`);
  await expect(tick).toBeFocused();
  await expect.poll(() => inTheClear(page, tick), "the tick is clear of the rest timer too").toBe(true);

  // Still the same after a reload: what is next comes from what is logged.
  await page.reload();
  expect(await upNext(page)).toEqual(second);

  // Back as it was: the tick comes off, and the first set is next again.
  await page.locator(`#${first.id}-button`).click();
  await expect(page.locator(`#${first.id}-button`)).toHaveAccessibleName("Done set 1");
  expect(await upNext(page)).toEqual(first);
});

test("with every set ticked the bar offers Finish and takes you to it", async ({ page }) => {
  await page.goto("/life/gym");
  const first = await upNext(page);
  const ticked: string[] = [];
  // Tick whatever is next until nothing is: the order the page itself gives.
  for (let i = 0; i < 60 && (await nextRow(page).count()) > 0; i++) {
    const id = (await nextRow(page).getAttribute("id")) ?? "";
    await page.locator(`#${id}-button`).click();
    await expect(page.locator(`#${id}`)).not.toHaveAttribute("aria-current", "step");
    ticked.push(id);
  }
  expect(ticked.length).toBeGreaterThan(10);
  expect(new Set(ticked).size, "no set comes up twice").toBe(ticked.length);

  await expect(nextBar(page)).toContainText("All sets done");
  await expect(nextBar(page)).toContainText("Finish the session");
  // The rest timer covers part of the screen until it is skipped.
  await page.getByRole("timer").getByRole("button", { name: "Skip" }).click();
  await nextBar(page).click();
  const finish = page.getByRole("button", { name: "Finish session" });
  await expect(finish).toBeFocused();
  await expect.poll(() => inTheClear(page, finish)).toBe(true);

  // Back as it was: every tick comes off, last first.
  for (const id of ticked.reverse()) {
    await page.locator(`#${id}-button`).click();
    await expect(page.locator(`#${id}-button`)).toHaveAccessibleName(/^Done set /);
  }
  expect(await upNext(page)).toEqual(first);
});
