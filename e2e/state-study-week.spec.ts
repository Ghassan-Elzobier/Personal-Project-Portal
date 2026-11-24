import { expect, test, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// The Schedule used to plan study hours without adding them up, and on the phone it
// showed no hours at all. It now says how the week's logged and planned study stands
// against the target, and each phone day chip carries that day's planned hours. The
// test makes its own task, plans it later today, checks both, and deletes the task.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day and time: Monday 16 November 2026, 09:30. */
const TODAY = "2026-11-16";

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function addTask(page: Page, name: string): Promise<string> {
  await page.goto("/tasks");
  await page.getByLabel("New task name").first().fill(name);
  await page.getByLabel("New task name").first().press("Enter");
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  const gid = /[?&]task=(\d+)/.exec((await link.getAttribute("href")) ?? "")?.[1] ?? "";
  expect(gid, "the task's link carries its id").not.toBe("");
  return gid;
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

/** The planned hours the study line shows, such as 1.5 from "0 h logged + 1.5 h planned". */
async function plannedOnLine(page: Page): Promise<number> {
  const text = (await studyLine(page).textContent()) ?? "";
  const match = / ([\d.]+) h planned/.exec(text);
  expect(match, `the study line (${text}) gives the planned hours`).not.toBeNull();
  return Number(match![1]);
}

/** The phone day chip's planned study hours, for a weekday such as "Mon". */
const chipHours = (page: Page, weekday: string) =>
  page
    .getByRole("button")
    .filter({ has: page.getByText(weekday, { exact: true }) })
    .getByTitle("Planned study time");

test.use({ viewport: { width: 412, height: 915 } });

test("the Schedule adds up the week's study against the target, and the phone day chip shows the day's planned hours", async ({
  page,
  request,
}) => {
  await page.goto("/schedule");
  await expect(studyLine(page)).toBeVisible();
  await expect(studyLine(page)).toContainText("h logged");
  const before = await plannedOnLine(page);

  const name = unique("Plan chapter");
  const gid = await addTask(page, name);
  try {
    // An hour and a half from 14:00, still to come by the suite's clock.
    const claude = await connectClaude(page, request);
    try {
      const planned = await claude.call("schedule_task", { task_gid: gid, date: TODAY, start: "14:00", minutes: 90 });
      expect(planned.isError, planned.text).toBe(false);
    } finally {
      await claude.disconnect();
    }

    await page.goto("/schedule");
    await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toBeVisible();
    expect(await plannedOnLine(page)).toBeCloseTo(before + 1.5, 2);
    // The chip shows the day's planned study, the number the desktop header shows.
    await expect(chipHours(page, "Mon")).toHaveText(/^\d+(\.\d+)? h$/);

    // Still holds at 360 px, with no sideways scroll.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(studyLine(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "the page does not scroll sideways at 360 px").toBeLessThanOrEqual(0);
  } finally {
    await deleteTask(page, name);
  }

  // With the task gone, the line is back where it was, and a day with no study shows no number.
  await page.goto("/schedule");
  expect(await plannedOnLine(page)).toBeCloseTo(before, 2);
  if (before === 0) await expect(chipHours(page, "Mon")).toHaveText("");
});
