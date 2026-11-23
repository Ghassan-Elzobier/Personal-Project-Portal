import { expect, test } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// The forecast at your recent pace: with weeks of made-up spending above the plan, the
// page says what the balance would be at that pace, offers the weekly amount that keeps
// it above £0 to payday, and one tap makes it This week's amount, still there after a
// reload. Like the other Money tests it connects the made-up bank and erases it again,
// so the Money screenshots stay as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/** Six weeks of spending before the suite's Monday, 16 November 2026: a median of £250 a week. */
const WEEKS = [
  ["2026-10-07", 24_000],
  ["2026-10-14", 26_000],
  ["2026-10-21", 25_000],
  ["2026-10-28", 23_000],
  ["2026-11-04", 27_000],
  ["2026-11-11", 25_000],
] as const;
// Each at a different shop, so Money doesn't take them for one weekly bill.
const SHOPS = ["GROCER", "MARKET", "BAKERY", "DELI", "CAFE", "BOOKS"];
const PAYMENTS = WEEKS.map(([date, pence], i) => ({
  id: `pace${i}`,
  date,
  pence: -pence,
  text: `EXAMPLE ${SHOPS[i]}`,
}));

test("the forecast shows your recent pace, and one tap lives on the amount that keeps you above £0 to payday", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 360, height: 780 });
  // £150 in the bank, no pay planned, payday Monday 30 November.
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=15000`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: PAYMENTS });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const week = page.getByRole("region", { name: "This week" });
  const plan = page.getByRole("region", { name: "Your plan" });
  const ahead = page.getByRole("region", { name: "The next 13 weeks" });
  try {
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText(/^of £150\.00:/)).toBeVisible();

    // The plan beside the pace: £250 a week would take the balance under £0 before payday.
    await expect(
      ahead.getByText(/^At your recent pace \(the dashed line: £250\.00 a week, the middle of your past weeks\):/),
    ).toBeVisible();
    // £133 a week: £16 left of this week after last week's £117 over, then £133 next week, £149 of the £150.
    await expect(ahead.getByText("£133.00 a week keeps you above £0 to payday.")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "no sideways scroll at 360 px",
    ).toBeLessThanOrEqual(360);

    await ahead.getByRole("button", { name: "Live on £133.00 a week" }).click();
    await expect(week.getByText(/^of £133\.00:/)).toBeVisible();
    await expect(plan.getByLabel("To live on each week (£)")).toHaveValue("133");
    await page.reload();
    await expect(week.getByText(/^of £133\.00:/)).toBeVisible();
    // At £133 the plan holds to payday, so there's nothing more to suggest.
    await expect(ahead.getByRole("button", { name: /^Live on / })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "no sideways scroll at 360 px",
    ).toBeLessThanOrEqual(360);
  } finally {
    // Back as it was.
    await page.goto("/life/money");
    await plan.getByLabel("To live on each week (£)").fill("");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
