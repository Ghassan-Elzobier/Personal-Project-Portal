import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW, FIXED_NOW } from "./env";

// The Monday check-in on Today. On the suite's Monday, 16 November 2026, with the
// made-up bank showing £180 spent last week against £150 a week, and a goal holding
// £100 in the account, Today asks what happens to the £30 over. Covering it from the
// goal hides the card and clears the £30 off Money's This week; a reload keeps both.
// Like the other Money tests it erases the bank data after, which forgets the check-in.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const GOAL = "Example rainy-day fund";

/** Made-up payments last week (Monday 9 to Sunday 15 November): £180 in all. */
const LAST_WEEK = [
  { id: "k1", date: "2026-11-10", pence: -9000, text: "EXAMPLE SHOP" },
  { id: "k2", date: "2026-11-12", pence: -9000, text: "EXAMPLE STORE" },
];

/** Takes away everything this test adds, whatever of it is there, and erases the bank data. */
async function putBack(page: Page, request: APIRequestContext) {
  await page.goto("/life/money");
  const goals = page.getByRole("region", { name: "Goals" });
  const remove = goals.getByRole("button", { name: `Remove ${GOAL}` });
  if ((await remove.count()) > 0) {
    await remove.click();
    await expect(goals.getByText(GOAL, { exact: true })).toHaveCount(0);
  }
  const plan = page.getByRole("region", { name: "Your plan" });
  if ((await plan.count()) > 0) {
    await plan.getByLabel("To live on each week (£)").fill("");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(page.getByRole("region", { name: "This week" }).getByText("Set the amount you live on")).toBeVisible();
  }
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) {
    await erase.click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
}

test("after an over week, Today's Monday check-in covers it from a goal in one tap, and stays done after a reload", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  if ((await page.getByRole("button", { name: "Erase all bank data" }).count()) > 0) await putBack(page, request);

  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=150000`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: LAST_WEEK });
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const week = page.getByRole("region", { name: "This week" });
  const plan = page.getByRole("region", { name: "Your plan" });
  const goals = page.getByRole("region", { name: "Goals" });
  const card = page.getByRole("region", { name: "Last week" });
  try {
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    // Last week's £30 over comes off this week.
    await expect(week.getByText("£120.00 left")).toBeVisible();
    await expect(week.getByText(/£30\.00 over last week/)).toBeVisible();

    await goals.getByText("Add a goal").click();
    await goals.getByLabel("What it's for").fill(GOAL);
    await goals.getByLabel("Target (£)").fill("500");
    await goals.getByLabel("Saved so far (£)").fill("100");
    await goals.getByLabel("Kept").selectOption("account");
    await goals.getByRole("button", { name: "Add the goal" }).click();
    await expect(goals.getByText(GOAL, { exact: true })).toBeVisible();

    // Today on the suite's Monday: the line, what it does without a choice, and the ways.
    await page.goto("/");
    await expect(card.getByText("Last week: £180.00 of £150.00, £30.00 over.")).toBeVisible();
    await expect(card.getByText("Keep the plan and it comes off this week.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Keep the plan" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Take it off this week" }), "only on the autopilot").toHaveCount(0);

    // One tap: the card goes at once.
    await card.getByRole("button", { name: `Cover it from ${GOAL}` }).click();
    await expect(card).toHaveCount(0);

    // Money's This week no longer carries last week's £30.
    await page.goto("/life/money");
    await expect(week.getByText("£150.00 left")).toBeVisible();
    await expect(week.getByText(/over last week/)).toHaveCount(0);

    // And after a reload, Today still has no check-in.
    await page.goto("/");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(card).toHaveCount(0);
  } finally {
    await putBack(page, request);
  }
});
