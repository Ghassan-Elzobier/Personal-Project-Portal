import { expect, test, type Page } from "@playwright/test";

// A role in progress with no dated next step used to drop out of sight: Today said
// nothing and the Applications tab showed it only in its stage column. Now it is
// asked for its next step, and giving it one clears the reminder at once and after
// a reload. The role is made up and added by hand; it can't be deleted, so the
// test ends by passing on it, which takes it out of everything in progress.

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// Today shows what needs attention only once there is work in the plan, so the test adds a task
// of its own and deletes it again, as the other save tests do.
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

/** How many roles Today says have no next step: none when the line is absent. */
async function unplannedOnToday(page: Page): Promise<number> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  const line = page.getByRole("link", { name: /^Job hunt: \d+ roles? ha(s|ve) no next step\.$/ });
  if ((await line.count()) === 0) return 0;
  return Number(/(\d+)/.exec((await line.textContent()) ?? "")?.[1] ?? 0);
}

test("a role in progress with no next step is asked for one on Today and in Applications, and a dated action clears it at once and after a reload", async ({
  page,
}) => {
  const title = unique("Graphics engineer");
  const task = unique("Next-step check");
  await addTask(page, task);
  try {
    const before = await unplannedOnToday(page);
    await run(page, title, before);
  } finally {
    await deleteTask(page, task);
  }
});

async function run(page: Page, title: string, before: number) {
  await page.goto("/jobs?view=sources");
  const byHand = page.getByRole("region", { name: "Add a role by hand" });
  await byHand.getByLabel("Role title").fill(title);
  await byHand.getByLabel("Employer").fill("Example Ltd");
  await byHand.getByRole("button", { name: "Add role" }).click();
  const pane = page.getByLabel(`Role: ${title}`);
  await expect(pane).toBeVisible();

  // A role added by hand is saved, so it is in progress from the start and is asked for a next step.
  const needs = page.getByRole("region", { name: "Needs a next step" });
  const asked = needs.getByRole("listitem").filter({ hasText: title });
  await expect(asked).toContainText("Saved");

  // Applied, still with no next action: the Applications tab says so at once, and after a reload.
  await pane.getByLabel("Stage").selectOption("applied");
  await expect(asked).toContainText("Applied");
  await page.reload();
  await expect(asked).toContainText("Applied");

  // Today says so in one line, which leads back to Applications, and the job-hunt card says it too.
  expect(await unplannedOnToday(page)).toBe(before + 1);
  await expect(page.getByText(/^Nothing due, but \d+ roles? needs? a next step\.$/)).toBeVisible();
  await page.getByRole("link", { name: /^Job hunt: \d+ roles? ha(s|ve) no next step\.$/ }).click();
  await expect(page).toHaveURL(/\/jobs\?view=applications/);
  await needs.getByRole("link", { name: new RegExp(title) }).click();
  await expect(pane).toBeVisible();

  // An action with no date still needs a date.
  await pane.getByLabel("Next action").fill("Send a follow-up");
  await pane.getByLabel("Next action").blur();
  await expect(asked).toContainText("Applied, no date");

  // A dated next action clears it, at once and after a reload, here and on Today.
  await pane.getByLabel("By", { exact: true }).fill("2026-11-20");
  await expect(needs.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
  const actions = page.getByRole("region", { name: "Next actions" });
  await expect(actions.getByRole("link", { name: new RegExp(`Send a follow-up.*${title}`) })).toBeVisible();
  await page.reload();
  await expect(needs.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
  await expect(actions.getByRole("link", { name: new RegExp(`Send a follow-up.*${title}`) })).toBeVisible();
  expect(await unplannedOnToday(page)).toBe(before);

  // Back out of everything in progress: pass on the role.
  await page.goto("/jobs?view=applications");
  await actions.getByRole("link", { name: new RegExp(`Send a follow-up.*${title}`) }).click();
  await expect(pane).toBeVisible();
  await pane.getByLabel("Stage").selectOption("passed");
  await expect(actions.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
}
