import { expect, test, type Page } from "@playwright/test";
import { findUnit } from "../src/lib/study/plans.ts";
import { PHASES } from "../src/lib/study/roadmap.ts";
import { ownerDatabase } from "./owner-database";

// One pace, three places. The hours a week set on the Study page are what its form
// opens on the next time, what Today's "This week" bar counts against, and what the
// Sunday update reports against. Before, the pace was used once for the due dates
// and forgotten, and the other two read a setting of the deployment.
//
// The pace form shows only once a plan is loaded, and a loaded plan cannot be taken
// away again from any page. So the test asks the database for the least that will
// do, one unit from the roadmap's first phase, and takes it away again afterwards
// (e2e/owner-database.ts). Everything it checks, it does through the pages. It puts
// back the pace it found (none, on the seeded database) and the sections it found.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

type PaceRow = {
  hours_per_week: number;
  starts_on: string;
  changes_on: string | null;
  then_hours_per_week: number | null;
} | null;
type TaskRow = { gid: string; ref: string | null; name: string };
type SectionRow = { gid: string; name: string };
type Database = Awaited<ReturnType<typeof ownerDatabase>>;

// The first unit on the roadmap's main path, under a made-up name.
const first = PHASES.flatMap((phase) => phase.units)
  .map((ref) => findUnit(ref))
  .find((found) => found && !found.unit.optional);
if (!first) throw new Error("The roadmap has no unit on its main path.");
const PROJECT = first.plan.project;
const REF = first.unit.ref;
const UNIT = "Example unit for the pace test";

// The suite's pinned day is Monday 16 November 2026, so this Wednesday is in the week Today shows.
const THIS_WEDNESDAY = "2026-11-18";

/** Takes the test's unit away, whether this run added it or one that stopped half-way did. */
async function removeUnit(db: Database) {
  const tasks = await db.call<TaskRow[]>("tracker_tasks", { p_project: PROJECT });
  for (const task of tasks.filter((t) => t.ref === REF && t.name === UNIT))
    await db.call("tracker_delete_task", { p_gid: task.gid });
}

const paceForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: "Set dates across all three" }) });

async function setPace(page: Page, hours: number, change?: { from: string; hours: number }) {
  await page.goto("/study");
  const form = paceForm(page);
  // Open when no unit has a date yet; closed, under "Change the pace", once some have.
  if (!(await form.isVisible())) await page.getByText("Change the pace").click();
  await form.getByLabel("Study", { exact: true }).fill(String(hours));
  await form.getByLabel("My hours change later").setChecked(Boolean(change));
  if (change) {
    await form.getByLabel("From", { exact: true }).fill(change.from);
    await form.getByLabel("study", { exact: true }).fill(String(change.hours));
  }
  await form.getByRole("button", { name: "Set dates across all three" }).click();
  await expect(page.getByRole("status").getByText("Dates set for 1 units.")).toBeVisible();
}

// Set by the test once it has changed something, and run after it whether it passed or
// not. After, and not in a "finally": a failure here is then reported beside the test's own.
let putBack: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  const undo = putBack;
  putBack = null;
  await undo?.();
});

/** The pace form as the Study page shows it after a fresh load. */
async function reopenedForm(page: Page) {
  await page.goto("/study");
  await page.getByText("Change the pace").click();
  const form = paceForm(page);
  await expect(form).toBeVisible();
  return form;
}

test("the pace set on Study is the one its form opens on, and the target Today and the Sunday update count against", async ({
  page,
}) => {
  // Setting a pace again replaces dates, and the page asks first.
  page.on("dialog", (dialog) => void dialog.accept());
  const db = await ownerDatabase();
  const paceBefore = await db.call<PaceRow>("get_study_pace");
  const sectionsBefore = new Set(
    (await db.call<SectionRow[]>("tracker_sections", { p_project: PROJECT })).map((s) => s.gid),
  );
  // Two numbers of hours that are not the pace already saved, so a pass cannot be a coincidence.
  const taken = [paceBefore?.hours_per_week, paceBefore?.then_hours_per_week].map(Number);
  const [hours, later] = [37, 9, 41, 7].filter((n) => !taken.includes(n));

  await removeUnit(db);
  putBack = async () => {
    await removeUnit(db);
    await db.call("set_study_pace", { p_pace: paceBefore });
    for (const section of await db.call<SectionRow[]>("tracker_sections", { p_project: PROJECT }))
      if (!sectionsBefore.has(section.gid)) await db.call("tracker_delete_section", { p_gid: section.gid });
  };
  await db.call("tracker_import_plan", {
    p_project: PROJECT,
    p_plan: [{ name: "To do", tasks: [{ ref: REF, name: UNIT }] }],
  });

  // A steady pace. The form shows it again after a reload.
  await setPace(page, hours);
  let form = await reopenedForm(page);
  await expect(form.getByLabel("Study", { exact: true })).toHaveValue(String(hours));
  await expect(form.getByLabel("My hours change later")).not.toBeChecked();

  // Today counts this week against it, and the weekly log's draft reports against it.
  await page.goto("/");
  const week = page.getByRole("definition").filter({ hasText: ` of ${hours} h` });
  await expect(week).toBeVisible();
  await expect(page.getByRole("img", { name: /% of this week's target$/ })).toBeVisible();
  await page.goto("/week");
  const weeklyLog = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Weekly log" }) });
  await expect(weeklyLog.getByLabel("Update")).toHaveValue(new RegExp(`Hours this week: [\\d.]+ of ${hours} planned`));

  // A pace that changes this Wednesday. The form opens on all of it: the hours, the day and the later hours.
  await setPace(page, hours, { from: THIS_WEDNESDAY, hours: later });
  form = await reopenedForm(page);
  await expect(form.getByLabel("Study", { exact: true })).toHaveValue(String(hours));
  await expect(form.getByLabel("My hours change later")).toBeChecked();
  await expect(form.getByLabel("From", { exact: true })).toHaveValue(THIS_WEDNESDAY);
  await expect(form.getByLabel("study", { exact: true })).toHaveValue(String(later));

  // The week that holds the change counts against the later pace, on Today and in the draft.
  await page.goto("/");
  await expect(page.getByRole("definition").filter({ hasText: ` of ${later} h` })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: ` of ${hours} h` })).toHaveCount(0);
  await page.goto("/week");
  await expect(weeklyLog.getByLabel("Update")).toHaveValue(new RegExp(`Hours this week: [\\d.]+ of ${later} planned`));

  // Back as it was found: on the seeded database, no pace and no plan.
  await putBack();
  putBack = null;
  if (paceBefore === null) expect(await db.call<PaceRow>("get_study_pace")).toBeNull();
  await page.goto("/study");
  await expect(page.getByText(UNIT)).toHaveCount(0);
});
