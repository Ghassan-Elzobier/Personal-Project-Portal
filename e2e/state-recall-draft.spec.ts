import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { findUnit } from "../src/lib/study/plans.ts";
import { PHASES } from "../src/lib/study/roadmap.ts";
import { ownerDatabase } from "./owner-database";

// Cards with nothing to check against (the book plans' cards and those added by hand)
// get an answer from Claude with one tap: "Draft answers" on the recall queue. A draft
// waits behind "Show answer" as the tutor's words do, so recalling still comes first,
// and it says it is Claude's. A card Claude can't answer from the question alone is
// left as it was, and the offer goes until a reload. Claude is the suite's fake
// (e2e/fake-claude/recall.mjs), which leaves out a question that says it needs the book.
//
// The cards come from the database (e2e/owner-database.ts), which no page can do: a
// unit of a plan to hold them, and two cards due on the suite's pinned day. Afterwards
// the unit goes, and its cards with it.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** The suite's pinned day. */
const TODAY = "2026-11-16";

type TaskRow = { gid: string; ref: string | null; name: string };
type CardRow = { gid: string; task_gid: string; prompt: string; answer: string | null };
type Database = Awaited<ReturnType<typeof ownerDatabase>>;

const first = PHASES.flatMap((phase) => phase.units)
  .map((ref) => findUnit(ref))
  .find((found) => found && !found.unit.optional);
if (!first) throw new Error("The roadmap has no unit on its main path.");
const PROJECT = first.plan.project;
const REF = first.unit.ref;
const UNIT = "Example unit for the draft test";

// Made-up questions: nothing here is from a book.
const DRAFTED = "Example: why does the made-up queue drain?";
const LEFT = "Example: what does the made-up exercise ask? It needs the book.";
const RATINGS = ["Got it", "Shaky", "Missed"];

async function unitTasks(db: Database) {
  const tasks = await db.call<TaskRow[]>("tracker_tasks", { p_project: PROJECT });
  return tasks.filter((t) => t.ref === REF && t.name === UNIT);
}

/** Takes the test's unit away, and its cards with it, whether this run added it or one that stopped half-way did. */
async function removeUnit(db: Database) {
  for (const task of await unitTasks(db)) await db.call("tracker_delete_task", { p_gid: task.gid });
}

let putBack: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  const undo = putBack;
  putBack = null;
  await undo?.();
});

/** The first tap after a page load can land before the page listens: tap until the tap has done its work. */
async function tapUntil(button: Locator, done: () => Promise<void>) {
  await expect(async () => {
    if (await button.isVisible()) await button.click();
    await done();
  }).toPass();
}

test("Draft answers gives the cards with nothing to check against Claude's draft, behind Show answer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 839 });
  const db = await ownerDatabase();
  await removeUnit(db);
  putBack = () => removeUnit(db);
  await db.call("tracker_import_plan", {
    p_project: PROJECT,
    p_plan: [{ name: "To do", tasks: [{ ref: REF, name: UNIT }] }],
  });
  const [unit] = await unitTasks(db);
  expect(unit, "the unit for the cards was added").toBeTruthy();
  for (const prompt of [DRAFTED, LEFT])
    await db.call("tracker_add_review", { p_task: unit.gid, p_prompt: prompt, p_due_on: TODAY });

  await page.goto("/study");
  const queue = page.getByRole("region", { name: /^Recall from memory/ });
  const card = (question: string) => queue.getByRole("listitem").filter({ hasText: question });
  // Neither card has an answer, so each is rated straight away, as before.
  await expect(card(DRAFTED).getByRole("button")).toHaveText(RATINGS);
  await expect(card(LEFT).getByRole("button")).toHaveText(RATINGS);

  // The offer sits above the cards, and holds at the narrowest phone.
  const draft = queue.getByRole("button", { name: "Draft answers" });
  await expect(draft).toBeVisible();
  await expect(queue.getByText(/cards? ha(?:s|ve) no answer to check against/)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 780 });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the queue pushes the page sideways at 360 px").toBe(false);
  await page.setViewportSize({ width: 412, height: 839 });
  const scan = await new AxeBuilder({ page })
    .include('section[aria-labelledby="reviews-title"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = scan.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(serious, "serious accessibility issues in the recall queue").toEqual([]);

  // One tap: the card Claude could answer now keeps its draft behind Show answer, and the
  // one it left is rated straight away, as before.
  await tapUntil(draft, async () => {
    await expect(card(DRAFTED).getByRole("button")).toHaveText(["Show answer"], { timeout: 3000 });
  });
  await expect(page.getByRole("status").filter({ hasText: "Claude left 1 card" })).toBeVisible();
  await expect(card(LEFT).getByRole("button")).toHaveText(RATINGS);
  await expect(page.getByText("A made-up draft.")).toHaveCount(0);
  // Nothing is left to offer in this sitting.
  await expect(draft).toHaveCount(0);

  // Show answer: the draft says it is Claude's, in its own lines, and the ratings appear.
  const drafted = card(DRAFTED);
  await tapUntil(drafted.getByRole("button", { name: "Show answer" }), async () => {
    await expect(drafted.getByText("A made-up draft.")).toBeVisible({ timeout: 1000 });
  });
  await expect(drafted.getByText("Claude's draft, from the question alone: check it against the book")).toBeVisible();
  await expect(drafted.getByText(`It answers: ${DRAFTED}`)).toBeVisible();
  await expect(drafted.getByText("Claude's draft: ")).toHaveCount(0);
  await expect(drafted.getByRole("button")).toHaveText(RATINGS);

  // Saved: after a reload the draft is still behind Show answer, and the card Claude
  // left is offered again.
  await page.reload();
  await expect(card(DRAFTED).getByRole("button")).toHaveText(["Show answer"]);
  await expect(card(LEFT).getByRole("button")).toHaveText(RATINGS);
  await expect(queue.getByRole("button", { name: "Draft answers" })).toBeVisible();
  const snapshot = await db.call<{ reviews: CardRow[] }>("tracker_study_snapshot");
  const cards = snapshot.reviews.filter((r) => r.task_gid === unit.gid);
  expect(Object.fromEntries(cards.map((c) => [c.prompt, c.answer]))).toEqual({
    [DRAFTED]: `Claude's draft: A made-up draft.\nIt answers: ${DRAFTED}`,
    [LEFT]: null,
  });

  // Back as it was found: the unit is gone, and its cards with it.
  await putBack();
  putBack = null;
  await page.goto("/study");
  await expect(page.getByText(UNIT)).toHaveCount(0);
  await expect(page.getByText(DRAFTED)).toHaveCount(0);
});
