import { expect, test, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// Debts from the bills: Money finds two regular repayments, the owner files them under
// Debt repayments, says what's owed on each, and watches them clear. The order the
// extra goes in is one tap, and stays after a reload. Free advice is linked at 360 px.
// Like the other Money tests it connects the made-up bank and erases it again, so the
// Money screenshots stay as approved.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const LOAN = "EXAMPLE LOANS";
const CARD = "EXAMPLE CARD";

/** Three monthly repayments to each made-up lender, before the suite's Monday, 16 November 2026. */
const PAYMENTS = [
  { id: "d1", date: "2026-09-12", pence: -12000, text: LOAN },
  { id: "d2", date: "2026-10-12", pence: -12000, text: LOAN },
  { id: "d3", date: "2026-11-12", pence: -12000, text: LOAN },
  { id: "d4", date: "2026-09-05", pence: -5000, text: CARD },
  { id: "d5", date: "2026-10-05", pence: -5000, text: CARD },
  { id: "d6", date: "2026-11-05", pence: -5000, text: CARD },
];

/** Files one of a lender's payments under Debt repayments, for this payment alone (no rule is left behind). */
async function fileAsDebt(page: Page, name: string) {
  const payments = page.getByRole("region", { name: "Payments" });
  await payments
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "What was this for?" });
  await sheet.getByLabel("Always for this merchant").uncheck();
  await sheet.getByRole("button", { name: "Debt repayments" }).click();
  await expect(sheet).toBeHidden();
}

test("a repayment Money found becomes a debt that says when it clears, and the order of the debts is one tap that stays", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=150000`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: PAYMENTS });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const goals = page.getByRole("region", { name: "Goals" });
  const rows = goals.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Remove / }) });
  try {
    // The repayments are bills; filed under Debt repayments, the next sync makes them debt bills.
    await expect(page.getByRole("region", { name: "Bills" }).getByText(LOAN)).toBeVisible();
    await fileAsDebt(page, LOAN);
    await fileAsDebt(page, CARD);
    await page.getByRole("region", { name: "Balance" }).getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Up to date.")).toBeVisible();
    await page.reload();

    // Each is suggested with its monthly payment; say what's owed and add it.
    await expect(goals.getByText(`${LOAN}: £120.00 a month. What's owed now?`)).toBeVisible();
    await expect(goals.getByText(`${CARD}: £50.00 a month. What's owed now?`)).toBeVisible();
    for (const [name, owed, apr] of [
      [LOAN, "2000", "20"],
      [CARD, "300", "5"],
    ]) {
      const form = goals.getByRole("form", { name: `Watch ${name} clear` });
      await form.getByLabel("Owed now (£)").fill(owed);
      await form.getByLabel("Interest % a year (optional)").fill(apr);
      await form.getByRole("button", { name: `Add ${name}` }).click();
      await expect(form).toHaveCount(0);
    }
    await expect(rows.filter({ hasText: LOAN }).getByText(/^Cleared by \w{3} \d{4} at £120\.00 a month/)).toBeVisible();
    await expect(rows.filter({ hasText: LOAN }).getByText(/^About £[\d,.]+ interest still to pay$/)).toBeVisible();
    await page.reload();
    await expect(rows.filter({ hasText: LOAN }).getByText(/^Cleared by \w{3} \d{4} at £120\.00 a month/)).toBeVisible();
    await expect(rows.filter({ hasText: CARD }).getByText(/^Cleared by \w{3} \d{4} at £50\.00 a month/)).toBeVisible();

    // Added in turn, the dearer loan is first: highest interest first is the order now.
    const highest = goals.getByRole("button", { name: /^Highest interest first/ });
    const smallest = goals.getByRole("button", { name: /^Smallest balance first/ });
    await expect(rows.first()).toContainText(LOAN);
    await expect(highest).toHaveAttribute("aria-pressed", "true");
    await expect(highest).toContainText(/Last one cleared \w{3} \d{4} · about £[\d,.]+ interest/);

    await smallest.click();
    await expect(rows.first()).toContainText(CARD);
    await expect(smallest).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(rows.first()).toContainText(CARD);
    await expect(rows.nth(1)).toContainText(LOAN);
    await expect(smallest).toHaveAttribute("aria-pressed", "true");

    // Free advice, linked, at the small phone size.
    await page.setViewportSize({ width: 360, height: 780 });
    for (const name of ["StepChange", "National Debtline", "MoneyHelper"]) {
      const link = goals.getByRole("link", { name });
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      "nothing pushes the page sideways",
    ).toBeLessThanOrEqual(360);
  } finally {
    // Back as it was: the debts removed, the bank data erased.
    await page.goto("/life/money");
    for (const name of [LOAN, CARD]) {
      const remove = goals.getByRole("button", { name: `Remove ${name}` });
      if ((await remove.count()) === 0) continue;
      await remove.click();
      await expect(remove).toHaveCount(0);
    }
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
