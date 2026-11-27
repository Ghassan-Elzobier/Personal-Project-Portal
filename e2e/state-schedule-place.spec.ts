import { expect, test, type Page } from "@playwright/test";
import { ownerDatabase } from "./owner-database";

// The Schedule said how many study hours the week was still short of its target, and
// left the owner to hunt for a gap day by day. Find times now offers free times on the
// days to come, and Plan puts a task there in one tap. The seeded database has no
// target, so the test sets a pace through the database (the Study page only sets one
// with a plan loaded), makes its own task through the pages, and puts both back.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

type PaceRow = {
  hours_per_week: number;
  starts_on: string;
  changes_on: string | null;
  then_hours_per_week: number | null;
} | null;

/** The suite's pinned day is Monday 16 November 2026. */
const PACE = { hours_per_week: 37, starts_on: "2026-11-16", changes_on: null, then_hours_per_week: null };

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function addTask(page: Page, name: string) {
  await page.goto("/tasks");
  await page.getByLabel("New task name").first().fill(name);
  await page.getByLabel("New task name").first().press("Enter");
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function deleteTask(page: Page, name: string) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/tasks");
  const link = page.getByRole("link", { name });
  if ((await link.count()) === 0) return;
  await link.click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
}

const studyLine = (page: Page) => page.getByText(/^Study: /);

/** The hours the study line says are still to place, such as 35.5 from "35.5 h still to place". */
async function shortOnLine(page: Page): Promise<number> {
  const text = (await studyLine(page).textContent()) ?? "";
  const match = /([\d.]+) h still to place/.exec(text);
  expect(match, `the study line (${text}) gives the hours still to place`).not.toBeNull();
  return Number(match![1]);
}

const planButtons = (page: Page) => page.getByRole("button", { name: /^Plan (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d/ });

let putBack: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  const undo = putBack;
  putBack = null;
  await undo?.();
});

test.use({ viewport: { width: 412, height: 915 } });

test("Find times offers free times for the study still short, and Plan puts a task there in one tap", async ({
  page,
}) => {
  const db = await ownerDatabase();
  const paceBefore = await db.call<PaceRow>("get_study_pace");
  const name = unique("Place chapter");
  putBack = async () => {
    await deleteTask(page, name);
    await db.call("set_study_pace", { p_pace: paceBefore });
  };
  await db.call("set_study_pace", { p_pace: PACE });
  await addTask(page, name);

  await page.goto("/schedule");
  const before = await shortOnLine(page);
  expect(before, "a 37 h target leaves the seeded week short").toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Find times" }).click();
  const plan = planButtons(page).first();
  await expect(plan).toBeVisible();
  const offer = ((await plan.getAttribute("aria-label")) ?? "").replace(/^Plan /, "");
  expect(offer, "the first offer is an hour").toMatch(/^\w{3} \d\d:\d\d, 1 h$/);
  const [weekday, time] = offer.split(/[ ,]+/);
  expect(time >= "09:30" || weekday !== "Mon", `the offer (${offer}) is not in time already gone`).toBe(true);

  // At both phone widths, nothing scrolls sideways and every Plan button is big enough to tap.
  for (const width of [360, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `the page does not scroll sideways at ${width} px`).toBeLessThanOrEqual(0);
    for (const button of await planButtons(page).all())
      expect((await button.boundingBox())!.height, "a Plan button is at least 44 px tall").toBeGreaterThanOrEqual(44);
  }

  // Plan the test's own task, not whichever seeded task is due soonest.
  await page.getByLabel(`Task for ${offer}`).selectOption({ label: name });
  await plan.click();

  const chip = page
    .getByRole("button")
    .filter({ has: page.getByText(weekday, { exact: true }) })
    .first();
  const block = page.getByRole("button", { name: new RegExp(name) }).first();
  const check = async () => {
    await expect.poll(() => shortOnLine(page)).toBeCloseTo(before - 1, 2);
    await chip.click();
    await expect(block).toBeVisible();
    await expect(block).toContainText(time);
  };
  await check();
  await page.reload();
  await check();
});
