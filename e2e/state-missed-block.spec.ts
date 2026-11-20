import { expect, test, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// A planned study block that passed with nothing logged used to look like any other
// past block: the plan quietly broke. Today now says it was missed and offers the
// next free time in one tap, with Undo, and the Schedule marks it. The test makes
// its own task, gives it a time that has already gone, and deletes the task again.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The suite's pinned day and time: Monday 16 November 2026, 09:30. */
const TODAY = "2026-11-16";

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Adds a task and returns its id, from the link the Tasks page gives it. */
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

test("a study block that passed with nothing logged reads Missed, moves to the next free time in one tap, and Undo puts it back", async ({
  page,
  request,
}) => {
  const name = unique("Recap chapter");
  const gid = await addTask(page, name);
  try {
    // An hour from 07:00, which the suite's clock has already passed.
    const claude = await connectClaude(page, request);
    try {
      const planned = await claude.call("schedule_task", { task_gid: gid, date: TODAY, start: "07:00", minutes: 60 });
      expect(planned.isError, planned.text).toBe(false);
    } finally {
      await claude.disconnect();
    }

    await page.goto("/");
    const row = page.getByRole("region", { name: "Your day" }).getByRole("listitem").filter({ hasText: name });
    const missed = row.getByText("Missed", { exact: true });
    const move = row.getByRole("button", { name: /^Move to \d\d:\d\d$/ });
    await expect(row.getByText("07:00", { exact: true })).toBeVisible();
    await expect(missed).toBeVisible();
    // Logging is still one tap away, for a block that was studied and not logged.
    await expect(row.getByRole("link", { name: "Log it if you did study" })).toHaveAttribute(
      "href",
      `/log?task=${gid}`,
    );
    const time = ((await move.textContent()) ?? "").slice(-5);
    expect(time >= "09:30", `the offer (${time}) is not in time already gone`).toBe(true);

    // One tap: the block is at the new time at once, and no longer missed.
    await move.click();
    await expect(row.getByText(time, { exact: true })).toBeVisible();
    await expect(missed).toHaveCount(0);

    // Undo puts it back where it was.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row.getByText("07:00", { exact: true })).toBeVisible();
    await expect(missed).toBeVisible();

    // The Schedule marks the same block.
    await page.goto("/schedule");
    await expect(page.getByRole("button", { name: new RegExp(name) }).first()).toContainText(
      "Missed: no session was logged",
    );

    // Moved again, it stays moved after a reload, on Today and on the Schedule.
    await page.goto("/");
    await move.click();
    await expect(row.getByText(time, { exact: true })).toBeVisible();
    await page.reload();
    await expect(row.getByText(time, { exact: true })).toBeVisible();
    await expect(missed).toHaveCount(0);
    await page.goto("/schedule");
    const block = page.getByRole("button", { name: new RegExp(name) }).first();
    await expect(block).toContainText(time);
    await expect(block).not.toContainText("Missed");
  } finally {
    await deleteTask(page, name);
  }
});
