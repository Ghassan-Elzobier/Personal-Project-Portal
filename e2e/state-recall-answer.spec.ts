import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { findUnit } from "../src/lib/study/plans.ts";
import { PHASES } from "../src/lib/study/roadmap.ts";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// A recall card that has an answer keeps it, and the ratings, behind "Show answer":
// recall first, then check against the tutor's words, then rate. Before, the card
// showed only the question, and the answer the tutor had written was thrown away.
//
// The cards are made the way real ones are, by a lesson through Claude's tools: a
// check the owner gets wrong (its feedback is the answer), a question Claude chooses
// with its answer, and one with none. Two things no page can do are asked of the
// database (e2e/owner-database.ts): one unit of a plan to hold the lesson, and
// bringing the cards to the suite's pinned day, since a new card is due tomorrow at
// the soonest. Everything is checked on the page, at the owner's phone width.
//
// Afterwards the unit goes, and its cards with it. The lesson itself stays on the
// Learn page as a closed, made-up lesson: nothing in the portal deletes a lesson.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** The suite's pinned day. */
const TODAY = "2026-11-16";

type TaskRow = { gid: string; ref: string | null; name: string };
type CardRow = { gid: string; task_gid: string; prompt: string; answer: string | null };
type Database = Awaited<ReturnType<typeof ownerDatabase>>;

// The first unit on the roadmap's main path, under a made-up name.
const first = PHASES.flatMap((phase) => phase.units)
  .map((ref) => findUnit(ref))
  .find((found) => found && !found.unit.optional);
if (!first) throw new Error("The roadmap has no unit on its main path.");
const PROJECT = first.plan.project;
const REF = first.unit.ref;
const UNIT = "Example unit for the recall test";

// Made-up questions and answers: nothing here is from a book.
const CHOSEN = {
  prompt: "Example: why does the made-up cache help?",
  answer: "The made-up value is read once.\nEvery later step reuses it.",
};
const MISSED = {
  question: "Example: what limits the made-up kernel?",
  feedback: "Memory traffic, not arithmetic. That was the made-up point.",
};
const PLAIN = { prompt: "Example: a card with nothing to check against" };

async function unitTasks(db: Database) {
  const tasks = await db.call<TaskRow[]>("tracker_tasks", { p_project: PROJECT });
  return tasks.filter((t) => t.ref === REF && t.name === UNIT);
}

/** Takes the test's unit away, and its cards with it, whether this run added it or one that stopped half-way did. */
async function removeUnit(db: Database) {
  for (const task of await unitTasks(db)) await db.call("tracker_delete_task", { p_gid: task.gid });
}

// Set by the test once it has changed something, and run after it whether it passed or
// not. After, and not in a "finally": a failure here is then reported beside the test's own.
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

/**
 * Taps a rating and waits for its save to come back, so a reload straight after cannot
 * cut the save short. Like tapUntil, it taps again if the page was not listening yet.
 */
async function rate(page: Page, button: Locator) {
  await expect(async () => {
    const saved = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/study",
      { timeout: 3000 },
    );
    // Awaited below; this only keeps a tap that failed first from leaving the wait unhandled.
    saved.catch(() => {});
    await button.click({ timeout: 1000 });
    await saved;
  }).toPass();
}

test("a recall card keeps its answer and its ratings back until Show answer is tapped, and a rated card stays gone", async ({
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

  // A lesson on the unit, through Claude's tools.
  const claude = await connectClaude(page, request);
  try {
    const started = await claude.call("tutor_start", {
      kind: "teach",
      goal: "Example lesson for the recall test",
      task_gid: unit.gid,
    });
    expect(started.isError, started.text).toBe(false);
    const { session } = JSON.parse(started.text) as { session: string };
    const recorded = await claude.call("tutor_record_answer", {
      session,
      kind: "check",
      question: MISSED.question,
      answer: "Arithmetic",
      correct: false,
      confidence: 80,
      feedback: MISSED.feedback,
    });
    expect(recorded.isError, recorded.text).toBe(false);
    const ended = await claude.call("tutor_end", {
      session,
      status: "done",
      summary: "A made-up lesson.",
      review_prompts: [CHOSEN, PLAIN],
    });
    expect(ended.isError, ended.text).toBe(false);
    expect(JSON.parse(ended.text)).toMatchObject({ saved: true, reviews_added: 3 });
  } finally {
    await claude.disconnect();
  }

  // Each card was saved with its answer: Claude's for the question it chose (its lines
  // kept), what Claude said about the mistake for the miss, and none where none was given.
  const snapshot = await db.call<{ reviews: CardRow[] }>("tracker_study_snapshot");
  const cards = snapshot.reviews.filter((r) => r.task_gid === unit.gid);
  expect(Object.fromEntries(cards.map((c) => [c.prompt, c.answer]))).toEqual({
    [CHOSEN.prompt]: CHOSEN.answer,
    [`From memory: ${MISSED.question}`]: MISSED.feedback,
    [PLAIN.prompt]: null,
  });
  // As if the days had passed: the cards are due on the suite's pinned day.
  for (const card of cards)
    await db.call("tracker_rate_review", {
      p_gid: card.gid,
      p_rating: null,
      p_step: 0,
      p_due_on: TODAY,
      p_retire: false,
    });

  await page.goto("/study");
  const queue = page.getByRole("region", { name: /^Recall from memory/ });
  const card = (question: string) => queue.getByRole("listitem").filter({ hasText: question });
  const RATINGS = ["Got it", "Shaky", "Missed"];
  await expect(card(CHOSEN.prompt)).toBeVisible();
  await expect(card(MISSED.question)).toBeVisible();
  await expect(card(PLAIN.prompt)).toBeVisible();

  // A card with an answer: the question and one button. No ratings, and the answer is not on the page.
  const chosen = card(CHOSEN.prompt);
  await expect(chosen.getByRole("button")).toHaveText(["Show answer"]);
  await expect(page.getByText("Every later step reuses it.")).toHaveCount(0);
  await expect(page.getByText(MISSED.feedback)).toHaveCount(0);

  // Show answer: the answer opens under the question, in the tutor's lines, and the ratings appear.
  await tapUntil(chosen.getByRole("button", { name: "Show answer" }), async () => {
    await expect(chosen.getByText("Every later step reuses it.")).toBeVisible({ timeout: 1000 });
  });
  await expect(chosen.getByText("The made-up value is read once.")).toBeVisible();
  await expect(chosen.getByRole("button")).toHaveText(RATINGS);
  // The tapped button is gone, so the answer has the focus: a keyboard or a screen reader goes on from there.
  await expect(chosen.locator("[tabindex='-1']")).toBeFocused();
  // The queue with one answer open and one still closed has no serious accessibility issue
  // (WCAG 2.2 A and AA, as e2e/a11y.spec.ts scans the seeded pages; nothing is excused).
  const scan = await new AxeBuilder({ page })
    .include('section[aria-labelledby="reviews-title"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = scan.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(serious, "serious accessibility issues in the recall queue").toEqual([]);
  // The other card with an answer is still closed.
  await expect(card(MISSED.question).getByRole("button")).toHaveText(["Show answer"]);

  // Rating it takes the card away at once, and it stays away after a reload.
  await rate(page, chosen.getByRole("button", { name: "Got it" }));
  await expect(card(CHOSEN.prompt)).toHaveCount(0);
  await page.reload();
  await expect(card(MISSED.question)).toBeVisible();
  await expect(card(CHOSEN.prompt)).toHaveCount(0);

  // The check that was missed came back by itself, and what Claude said about the mistake is its answer.
  const missed = card(MISSED.question);
  await expect(missed.getByRole("button")).toHaveText(["Show answer"]);
  await tapUntil(missed.getByRole("button", { name: "Show answer" }), async () => {
    await expect(missed.getByText(MISSED.feedback)).toBeVisible({ timeout: 1000 });
  });
  await rate(page, missed.getByRole("button", { name: "Missed" }));
  await expect(card(MISSED.question)).toHaveCount(0);

  // A card with no answer works as it always did: its ratings are there from the start.
  await page.reload();
  const plain = card(PLAIN.prompt);
  await expect(plain.getByRole("button")).toHaveText(RATINGS);
  await rate(page, plain.getByRole("button", { name: "Shaky" }));
  await expect(card(PLAIN.prompt)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(PLAIN.prompt)).toHaveCount(0);
  await expect(page.getByText(MISSED.question)).toHaveCount(0);

  // Back as it was found: the unit is gone, and its cards with it.
  await putBack();
  putBack = null;
  await page.goto("/study");
  await expect(page.getByText(UNIT)).toHaveCount(0);
});
