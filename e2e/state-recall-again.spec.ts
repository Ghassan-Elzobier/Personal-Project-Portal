import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { findUnit } from "../src/lib/study/plans.ts";
import { PHASES } from "../src/lib/study/roadmap.ts";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// A card rated Missed leaves the due list, booked for tomorrow as before, and comes
// back once more in its own "Once more" section, its answer hidden again, so the
// sitting ends on a correct recall rather than a peek at the answer. That second try
// saves nothing: "Got it now" lets it go, "Not yet" sends it to the back, and a reload
// clears the section.
//
// The cards are made by a lesson through Claude's tools, as in
// e2e/state-recall-answer.spec.ts; the database (e2e/owner-database.ts) gives the
// lesson a unit and brings its cards to the suite's pinned day. Afterwards the unit
// goes, and its cards with it.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** The suite's pinned day, and the day after it. */
const TODAY = "2026-11-16";
const TOMORROW = "2026-11-17";

type TaskRow = { gid: string; ref: string | null; name: string };
type CardRow = { gid: string; task_gid: string; prompt: string; due_on: string | null };
type Database = Awaited<ReturnType<typeof ownerDatabase>>;

const first = PHASES.flatMap((phase) => phase.units)
  .map((ref) => findUnit(ref))
  .find((found) => found && !found.unit.optional);
if (!first) throw new Error("The roadmap has no unit on its main path.");
const PROJECT = first.plan.project;
const REF = first.unit.ref;
const UNIT = "Example unit for the once-more test";

// Made-up questions and answers: nothing here is from a book.
const MISSED = { prompt: "Example: what does the made-up buffer hold?", answer: "The made-up partial sums." };
const OTHER = { prompt: "Example: when does the made-up loop stop?", answer: "When the made-up counter wraps." };

async function unitTasks(db: Database) {
  const tasks = await db.call<TaskRow[]>("tracker_tasks", { p_project: PROJECT });
  return tasks.filter((t) => t.ref === REF && t.name === UNIT);
}

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

/** Taps a rating and waits for its save to come back, so a reload straight after cannot cut it short. */
async function rate(page: Page, button: Locator) {
  await expect(async () => {
    const saved = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/study",
      { timeout: 3000 },
    );
    saved.catch(() => {});
    await button.click({ timeout: 1000 });
    await saved;
  }).toPass();
}

/** The section fits the width, and every button in it is a full thumb's height. */
async function checkFits(page: Page, section: Locator, width: number) {
  await page.setViewportSize({ width, height: 839 });
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll, `no sideways scroll at ${width} px`).toBeLessThanOrEqual(0);
  for (const button of await section.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0, `"${await button.textContent()}" at ${width} px`).toBeGreaterThanOrEqual(48);
  }
}

test("a missed card comes back once more, answer hidden, and leaves only on a correct recall without changing its schedule", async ({
  page,
  request,
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
  expect(unit, "the unit for the lesson was added").toBeTruthy();

  const claude = await connectClaude(page, request);
  try {
    const started = await claude.call("tutor_start", {
      kind: "teach",
      goal: "Example lesson for the once-more test",
      task_gid: unit.gid,
    });
    expect(started.isError, started.text).toBe(false);
    const { session } = JSON.parse(started.text) as { session: string };
    const ended = await claude.call("tutor_end", {
      session,
      status: "done",
      summary: "A made-up lesson.",
      review_prompts: [MISSED, OTHER],
    });
    expect(ended.isError, ended.text).toBe(false);
  } finally {
    await claude.disconnect();
  }

  const cards = async () =>
    (await db.call<{ reviews: CardRow[] }>("tracker_study_snapshot")).reviews.filter((r) => r.task_gid === unit.gid);
  for (const card of await cards())
    await db.call("tracker_rate_review", {
      p_gid: card.gid,
      p_rating: null,
      p_step: 0,
      p_due_on: TODAY,
      p_retire: false,
    });

  await page.goto("/study");
  const queue = page.getByRole("region", { name: /^Recall from memory/ });
  const onceMore = page.getByRole("region", { name: /^Once more/ });
  const due = (question: string) => queue.getByRole("listitem").filter({ hasText: question });
  const again = onceMore.getByRole("listitem").filter({ hasText: MISSED.prompt });
  await expect(due(MISSED.prompt)).toBeVisible();
  await expect(onceMore).toHaveCount(0);

  // Show answer, then Missed: the card leaves the due list and comes back under it, answer hidden.
  const missed = due(MISSED.prompt);
  await tapUntil(missed.getByRole("button", { name: "Show answer" }), async () => {
    await expect(missed.getByText(MISSED.answer)).toBeVisible({ timeout: 1000 });
  });
  await rate(page, missed.getByRole("button", { name: "Missed" }));
  await expect(due(MISSED.prompt)).toHaveCount(0);
  await expect(again).toBeVisible();
  await expect(again.getByRole("button")).toHaveText(["Show answer"]);
  await expect(page.getByText(MISSED.answer)).toHaveCount(0);
  // The other card is still due, above it.
  await expect(due(OTHER.prompt)).toBeVisible();

  // Fits the owner's phone and the narrowest one, with thumb-sized buttons, both closed and open.
  await checkFits(page, onceMore, 360);
  await checkFits(page, onceMore, 412);
  await again.getByRole("button", { name: "Show answer" }).click();
  await expect(again.getByText(MISSED.answer)).toBeVisible();
  await expect(again.getByRole("button")).toHaveText(["Got it now", "Not yet"]);
  await checkFits(page, onceMore, 360);
  await checkFits(page, onceMore, 412);
  const scan = await new AxeBuilder({ page })
    .include('section[aria-labelledby="again-title"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = scan.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(serious, "serious accessibility issues in Once more").toEqual([]);

  // Not yet: it stays, its answer hidden again for the next try.
  await again.getByRole("button", { name: "Not yet" }).click();
  await expect(again.getByRole("button")).toHaveText(["Show answer"]);
  await expect(page.getByText(MISSED.answer)).toHaveCount(0);

  // Got it now: it leaves, and nothing about it was saved: it is due tomorrow, as Missed booked it.
  await again.getByRole("button", { name: "Show answer" }).click();
  await again.getByRole("button", { name: "Got it now" }).click();
  await expect(onceMore).toHaveCount(0);
  await page.reload();
  await expect(due(OTHER.prompt)).toBeVisible();
  await expect(page.getByText(MISSED.prompt)).toHaveCount(0);
  const saved = (await cards()).find((c) => c.prompt === MISSED.prompt);
  expect(saved?.due_on, "the missed card is due tomorrow, not today").toBe(TOMORROW);

  await putBack();
  putBack = null;
  await page.goto("/study");
  await expect(page.getByText(UNIT)).toHaveCount(0);
});
