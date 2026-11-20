import { expect, test } from "@playwright/test";
import { connectClaude } from "./connector";
import { FAKE_LUNCHFLOW } from "./env";

// "Can I afford it?" on the Money page: the answer comes before you choose how to
// pay, a way to pay fills the form in, asking saves nothing, and Claude's tool gives
// the same answer. Like the other Money tests it connects the made-up bank, and
// erases it again so the Money screenshot stays as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("the page says whether a purchase fits before you choose how to pay, a way to pay fills the form, and asking saves nothing", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=123456`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const week = page.getByRole("region", { name: "This week" });
  const plan = page.getByRole("region", { name: "Your plan" });
  const planned = page.getByRole("region", { name: "Planned purchases" });
  const ask = planned.getByRole("button", { name: "Can I afford it?" });
  const ways = planned.getByRole("list", { name: "Ways to pay for it" });
  const fits = planned.getByText("It fits without changing your weekly amount.");
  try {
    // The suite's clock is Monday 16 November: £150 a week to live on, nothing spent yet.
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("£150.00 left")).toBeVisible();

    await planned.getByRole("button", { name: "Plan a purchase" }).click();
    await expect(ask, "nothing to ask about until there is a cost").toBeDisabled();
    await planned.getByLabel("What for").fill("Bike repair");
    await planned.getByLabel("Cost (£)").fill("60");
    await ask.click();

    // The verdict, what it displaces, and each way to pay with what it does.
    await expect(fits).toBeVisible();
    await expect(planned.getByText("About 3 days of your weekly amount.")).toBeVisible();
    await expect(
      ways.getByRole("button", { name: "From this week's amount: £90.00 left this week after." }),
    ).toBeVisible();
    const spread = ways.getByRole("button", {
      name: "£20.00 a week for 3 weeks: your weekly amount goes from £150.00 to £130.00.",
    });

    // Tapping a way fills the form in.
    await spread.click();
    await expect(spread).toHaveAttribute("aria-pressed", "true");
    await expect(planned.getByLabel("Paid for")).toHaveValue("spread");
    // A label around a select takes in its options' text, so match the label's start.
    await expect(planned.getByRole("combobox", { name: /^Weeks/ })).toHaveValue("3");

    // Asking saved nothing, and the answer belongs to the cost it was asked for.
    await expect(week.getByText("£150.00 left")).toBeVisible();
    await planned.getByLabel("Cost (£)").fill("61");
    await expect(fits).toHaveCount(0);
    await expect(ways).toHaveCount(0);
    await planned.getByLabel("Cost (£)").fill("60");

    // Claude's tool runs the same check, with the same fields as before.
    const claude = await connectClaude(page, request);
    try {
      const answer = await claude.call("money_afford", { pence: 6000 });
      expect(answer.isError, answer.text).toBe(false);
      const told = JSON.parse(answer.text) as Record<string, unknown>;
      expect(Object.keys(told)).toEqual([
        "verdict",
        "reason",
        "options",
        "paysBackWeeks",
        "days_of_weekly_amount",
        "first_goal_later_by_weeks",
        "page",
      ]);
      expect(told).toMatchObject({
        verdict: "fits",
        reason: "It fits without changing your weekly amount.",
        days_of_weekly_amount: 2.8,
      });
    } finally {
      await claude.disconnect();
    }

    // Plan it the way that was picked: it counts at once and after a reload.
    await page.goto("/life/money");
    await planned.getByRole("button", { name: "Plan a purchase" }).click();
    await planned.getByLabel("What for").fill("Bike repair");
    await planned.getByLabel("Cost (£)").fill("60");
    await ask.click();
    await spread.click();
    await planned.getByRole("button", { name: "Plan it" }).click();
    await expect(planned.getByText("Bike repair", { exact: true })).toBeVisible();
    await expect(week.getByText("£130.00 left")).toBeVisible();
    await page.reload();
    await expect(week.getByText("£130.00 left")).toBeVisible();
    await planned.getByRole("button", { name: "Cancel Bike repair" }).click();
    await expect(planned.getByText("Nothing planned.")).toBeVisible();

    // More than is safe before payday: it says by how much, offers no way to pay, and saves nothing.
    await planned.getByRole("button", { name: "Plan a purchase" }).click();
    await planned.getByLabel("Cost (£)").fill("5000");
    await ask.click();
    await expect(
      planned.getByText(/^It would take you £3765\.44 past what's safe to spend before payday on 2026-11-30\./),
    ).toBeVisible();
    await expect(ways).toHaveCount(0);
    await page.reload();
    await expect(planned.getByText("Nothing planned.")).toBeVisible();
    await expect(week.getByText("£150.00 left")).toBeVisible();
  } finally {
    // Back as it was.
    await page.goto("/life/money");
    await plan.getByLabel("To live on each week (£)").fill("");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
