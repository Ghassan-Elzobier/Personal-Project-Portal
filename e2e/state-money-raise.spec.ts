import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW, FIXED_NOW } from "./env";
import { ownerDatabase } from "./owner-database";

// Where a pay rise goes. With a higher pay step later on, Goals asks once what share of
// the extra goes to goals; a tap saves it, the question goes away for good, each goal
// shows when it gets there with that split and if you kept the rise, and Your plan holds
// the choice. Like the other Money tests it connects the made-up bank and puts it all
// back, so the Money screenshots stay as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const GOAL = "Example car";

const parts = (page: Page) => ({
  week: page.getByRole("region", { name: "This week" }),
  goals: page.getByRole("region", { name: "Goals" }),
  pay: page.getByRole("region", { name: "Your pay" }),
  plan: page.getByRole("region", { name: "Your plan" }),
});

/** Takes away everything this test adds, whatever of it is there, and erases the bank data. */
async function putBack(page: Page, request: APIRequestContext) {
  const { week, goals, pay, plan } = parts(page);
  await page.goto("/life/money");
  const remove = goals.getByRole("button", { name: `Remove ${GOAL}` });
  if ((await remove.count()) > 0) {
    await remove.click();
    await expect(goals.getByText(GOAL, { exact: true })).toHaveCount(0);
  }
  const removePay = pay.getByRole("button", { name: /^Remove the pay from / });
  while ((await removePay.count()) > 0) {
    const before = await removePay.count();
    await removePay.first().click();
    await expect(removePay).toHaveCount(before - 1);
  }
  await plan.getByLabel("To live on each week (£)").fill("");
  await plan.getByRole("button", { name: "Save the plan" }).click();
  await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
  // No page clears the choice once made (it can only be changed), so put it back as the owner.
  await (await ownerDatabase()).call("money_save_settings", { p: { raise_goal_share_bp: null, raise_since: null } });
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await page.getByRole("button", { name: "Erase all bank data" }).click();
  await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
}

async function addPay(page: Page, fromOn: string, pounds: string) {
  const { pay } = parts(page);
  await pay.getByLabel("From the payday on").fill(fromOn);
  await pay.getByLabel("Take-home a month (£)").fill(pounds);
  await pay.getByRole("button", { name: "Save the pay" }).click();
}

test("a pay rise ahead asks once where the extra goes, a tap saves it, and the goals show both dates after a reload", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  const { goals, pay, plan } = parts(page);

  await page.goto("/life/money");
  if ((await page.getByRole("button", { name: "Erase all bank data" }).count()) > 0) await putBack(page, request);
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=150000`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();
  try {
    // The suite's clock is Monday 16 November: £2,000 a month since October, £2,400 from 29 January.
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(parts(page).week.getByText("£150.00 left")).toBeVisible();
    await addPay(page, "2026-10-30", "2000");
    await expect(pay.getByText("£2,000.00 a month from 30 Oct")).toBeVisible();
    await addPay(page, "2027-01-29", "2400");
    await expect(pay.getByText("£2,400.00 a month from 29 Jan")).toBeVisible();
    await goals.getByText("Add a goal").click();
    await goals.getByLabel("What it's for").fill(GOAL);
    await goals.getByLabel("Target (£)").fill("30000");
    await goals.getByRole("button", { name: "Add the goal" }).click();
    await expect(goals.getByText(GOAL, { exact: true })).toBeVisible();

    // The question, with half suggested.
    const ask = goals.getByText("Your pay rises on 29 Jan. Where should the extra go?");
    await expect(ask).toBeVisible();
    await expect(goals.getByText(/£400\.00 more a month/)).toBeVisible();
    const half = goals.getByRole("button", { name: "50% to goals (suggested)" });
    await expect(half).toBeVisible();
    await expect(plan.getByText("Of each pay rise, to goals")).toHaveCount(0);

    // A tap saves it: the question goes, and each goal shows both dates.
    await half.click();
    await expect(ask).toHaveCount(0);
    const both = goals.getByText(/there by \w{3} \d{4} with this split · \w{3} \d{4} if you keep it all/);
    await expect(both).toBeVisible();
    await expect(plan.getByRole("button", { name: "50% to goals (current)" })).toBeVisible();

    // And after a reload.
    await page.reload();
    await expect(ask).toHaveCount(0);
    await expect(both).toBeVisible();
    await expect(plan.getByRole("button", { name: "50% to goals (current)" })).toBeVisible();

    // Changed under Your plan, it stands too: keeping the whole rise leaves one date.
    await plan.getByRole("button", { name: "0% to goals", exact: true }).click();
    await expect(plan.getByRole("button", { name: "0% to goals (current)" })).toBeVisible();
    await expect(both).toHaveCount(0);
    await expect(goals.getByText(/there by \w{3} \d{4}/)).toBeVisible();
    await page.reload();
    await expect(plan.getByRole("button", { name: "0% to goals (current)" })).toBeVisible();
    await expect(ask).toHaveCount(0);
  } finally {
    await putBack(page, request);
  }
});
