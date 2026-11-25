import { expect, test, type Page } from "@playwright/test";
import { connectClaude } from "./connector";

// Life's private to-dos: added on the To-dos page, from Life's + button or by
// Claude, they show under their day and on Today at once and after a reload, tick
// off and back, and delete. They are the owner's alone: none ever shows among the
// tasks or the pages mentors read. Each test deletes what it made, because Today's
// screenshot shows no to-dos.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** The suite's pinned day, a Monday (e2e/env.ts). */
const TODAY = "2026-11-16";

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The group on the To-dos page that a to-do sits in: Overdue, Today, Tomorrow, Later, No day or Done. */
const group = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name} \\d+$`) });

/** Deletes a to-do through its row on the To-dos page, if it is there. */
async function deleteOnPage(page: Page, title: string) {
  await page.goto("/life/todos");
  const remove = page.getByRole("button", { name: `Delete ${title}` });
  if ((await remove.count()) === 0) return;
  page.once("dialog", (dialog) => void dialog.accept());
  await remove.click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
}

test("a to-do added on the To-dos page shows under its day and on Today, at once and after a reload, ticks off and back, and deletes", async ({
  page,
}) => {
  const title = unique("Example renewal check");
  try {
    await page.goto("/life/todos");
    const field = page.getByLabel("New to-do");
    await field.fill(`${title} tomorrow`);
    await expect(page.getByText("Due 17 Nov", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(field).toHaveValue("");
    await expect(group(page, "Tomorrow").getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(group(page, "Tomorrow").getByText(title, { exact: true })).toBeVisible();

    // The row holds at 360 px with no sideways scroll.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole("button", { name: `Done: ${title}` })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      "no sideways scroll at 360 px",
    ).toBe(true);
    await page.setViewportSize({ width: 412, height: 915 });

    // Due tomorrow, so Today shows it already.
    await page.goto("/");
    const onToday = page.getByRole("region", { name: "To-dos" });
    await expect(onToday.getByText(title, { exact: true })).toBeVisible();

    // Ticked off on Today: it leaves Today, and the To-dos page has it under Done.
    await onToday.getByRole("button", { name: `Done: ${title}` }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.goto("/life/todos");
    const done = group(page, "Done").getByRole("button", { name: `Done: ${title}` });
    await expect(done).toHaveAttribute("aria-pressed", "true");

    // Put back, it is due tomorrow again, after a reload too.
    await done.click();
    await expect(group(page, "Tomorrow").getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(group(page, "Tomorrow").getByText(title, { exact: true })).toBeVisible();

    // Moved to today in one tap.
    await group(page, "Tomorrow").getByRole("button", { name: "Today", exact: true }).click();
    await expect(group(page, "Today").getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(group(page, "Today").getByText(title, { exact: true })).toBeVisible();

    // Deleted, it is gone after a reload too.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  } finally {
    await deleteOnPage(page, title);
  }
});

test("Life's + adds a to-do from any Life page, while Work's + still adds a task", async ({ page }) => {
  const title = unique("Example errand");
  try {
    await page.goto("/life");
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByRole("button", { name: "Add a to-do" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a to-do" });
    await expect(sheet.getByLabel("New to-do")).toBeFocused();
    await sheet.getByLabel("New to-do").fill(`${title} today`);
    await sheet.getByRole("button", { name: "Add", exact: true }).click();
    await expect(sheet).toHaveCount(0);

    await page.goto("/life/todos");
    await expect(group(page, "Today").getByText(title, { exact: true })).toBeVisible();

    // Work keeps its own +, for tasks.
    await page.goto("/study");
    await expect(nav.getByRole("button", { name: "Add a task" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Add a to-do" })).toHaveCount(0);
  } finally {
    await deleteOnPage(page, title);
  }
});

test("a to-do from Claude shows on Today and in get_today, never among the tasks, and Claude ticks it off and deletes it", async ({
  page,
  request,
}) => {
  const title = unique("Example trial to cancel");
  const claude = await connectClaude(page, request);
  let gid: string | null = null;
  try {
    const tools = await claude.tools();
    const annotations = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(annotations("list_life_todos")).toMatchObject({ readOnlyHint: true });
    expect(annotations("add_life_todo")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations("update_life_todo")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotations("remove_life_todo")).toMatchObject({ destructiveHint: true });

    const added = await claude.call("add_life_todo", { title, due_on: TODAY });
    expect(added.isError, added.text).toBe(false);
    const todo = (JSON.parse(added.text) as { added: { todo_gid: string; title: string; due_on: string } }).added;
    gid = todo.todo_gid;
    expect(todo).toMatchObject({ title, due_on: TODAY });

    const today = await claude.call("get_today");
    expect(today.isError, today.text).toBe(false);
    const soon = (JSON.parse(today.text) as { todos_due_soon: { todo_gid: string }[] }).todos_due_soon;
    expect(soon.map((t) => t.todo_gid)).toContain(gid);

    await page.goto("/");
    await expect(page.getByRole("region", { name: "To-dos" }).getByText(title, { exact: true })).toBeVisible();

    // Never a task, so never on the pages that show tasks to the owner or to mentors.
    for (const path of ["/tasks?project=weekly-log", "/tasks", "/week", "/timeline", "/progress"]) {
      await page.goto(path);
      await expect(page.getByText(title), path).toHaveCount(0);
    }

    const ticked = await claude.call("update_life_todo", { todo_gid: gid, done: true });
    expect(ticked.isError, ticked.text).toBe(false);
    expect((JSON.parse(ticked.text) as { saved: { done: boolean } }).saved.done).toBe(true);
    await page.goto("/");
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);

    const removed = await claude.call("remove_life_todo", { todo_gid: gid });
    expect(removed.isError, removed.text).toBe(false);
    expect((JSON.parse(removed.text) as { deleted: { title: string } }).deleted.title).toBe(title);
    gid = null;
    const list = await claude.call("list_life_todos");
    expect(list.isError, list.text).toBe(false);
    expect(list.text).not.toContain(title);
    const again = await claude.call("remove_life_todo", { todo_gid: todo.todo_gid });
    expect(again.isError).toBe(true);
  } finally {
    if (gid) await claude.call("remove_life_todo", { todo_gid: gid });
    await claude.disconnect();
  }
});
