import { expect, test, type Page } from "@playwright/test";
import { ownerDatabase } from "./owner-database";

// A week planned on its last day plans just that day, lean: the Meals page says the
// week ends today and offers the rest of it or next week instead. Planning the rest
// gives tonight's dinner cooked fresh and no batch cook, at once and after a reload.
//
// The suite's pinned day is Monday 16 November. A routine whose first cook is on a
// Tuesday makes this week Tuesday 10th to Monday 16th, so today is its last day. The
// routine is set and put back through the database (no page sets one up in one go),
// and the plan it makes is removed again.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

/** The Tuesday that starts the meal week ending today. */
const WEEK = "2026-11-10";

/** Today's card on the Meals page, and its dinner. */
const todayCard = (page: Page) => page.getByRole("region", { name: "Days" }).getByRole("article").first();
const dinner = (page: Page) => todayCard(page).getByRole("listitem").filter({ hasText: "Dinner" });

test("a week with one day left plans tonight's dinner fresh and no cook, at once and after a reload", async ({
  page,
}) => {
  const db = await ownerDatabase();
  const read = await db.call<{ profile: Record<string, unknown> | null }>("life_read", { p_since: "2026-10-19" });
  const before = read.profile ?? {};
  const routine = (before.routine ?? {}) as Record<string, unknown>;
  await db.call("life_save_profile", {
    p_data: { ...before, routine: { ...routine, cooks: [{ weekday: 1, start: 17 * 60 }] } },
  });
  try {
    await page.goto("/life");
    await expect(page.getByRole("heading", { name: "This week ends today" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^(Plan next week instead|See next week)$/ })).toHaveAttribute(
      "href",
      "/life?week=next",
    );
    // The batch and fresh weeks are not offered for one day.
    await expect(page.getByRole("button", { name: "Plan a batch week" })).toHaveCount(0);

    await page.getByRole("button", { name: "Plan the rest of this week" }).click();
    await expect(page.getByText("Rest of the week", { exact: true })).toBeVisible();
    await expect(dinner(page).getByText("Cook fresh")).toBeVisible();
    // Nothing to batch cook, and no switching a day to a batch week.
    await expect(page.getByRole("button", { name: "Swap" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Make it a / })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Rest of the week", { exact: true })).toBeVisible();
    await expect(dinner(page).getByText("Cook fresh")).toBeVisible();
    await expect(page.getByRole("heading", { name: "This week ends today" })).toHaveCount(0);
  } finally {
    await db.call("life_save_plan", { p_start: WEEK, p_data: null });
    await db.call("life_save_profile", { p_data: before });
  }

  // Back as it was: the week starts on its usual day again.
  await page.goto("/life");
  await expect(page.getByRole("heading", { name: "This week ends today" })).toHaveCount(0);
  await expect(page.getByText("Rest of the week", { exact: true })).toHaveCount(0);
});
