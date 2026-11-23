import { expect, test, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";
import { ownerDatabase } from "./owner-database";

// A fixed cost Money can't find as a bill (paid on uneven days at changing amounts)
// counts at its typical month, and the Money page says where the figure came from: one
// tap saves it as the category's budget, or Change sets another. Like the other Money
// tests it connects the made-up bank, and erases it again so the Money screenshots
// stay as approved. The budget it saves is cleared through the database's own function,
// since once saved the page has no "un-budget".

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

/**
 * Made-up payments sorted as Subscriptions (a bills category) by the default rule, in 4 of
 * the 6 full months before the suite's Monday, 16 November 2026: gaps of 55, 13 and 53
 * days, so no bill is found. The median of £52, £61, £58 and £55 is £56.50.
 */
const PAYMENTS = [
  { id: "t1", date: "2026-06-03", pence: -5200, text: "NETFLIX EXAMPLE" },
  { id: "t2", date: "2026-07-28", pence: -6100, text: "NETFLIX EXAMPLE" },
  { id: "t3", date: "2026-08-10", pence: -5800, text: "NETFLIX EXAMPLE" },
  { id: "t4", date: "2026-10-02", pence: -5500, text: "NETFLIX EXAMPLE" },
];

const LINE = "Subscriptions: £56.50 a month, the median of 4 months paid since June.";

/** The rows of "Where it goes", opened (a save keeps it open). */
async function whereItGoes(page: Page) {
  const week = page.getByRole("region", { name: "This week" });
  const details = week.locator("details", { hasText: "Where it goes" });
  if ((await details.getAttribute("open")) === null) await week.getByText("Where it goes").click();
  return week;
}

test("a fixed cost with no bill counts at its typical month, and one tap saves it as the budget", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  const db = await ownerDatabase();
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=184250`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: PAYMENTS });
  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();

  const bills = page.getByRole("region", { name: "Bills" });
  try {
    // Counted at once, and said where it came from.
    await expect(bills.getByText(LINE)).toBeVisible();
    let week = await whereItGoes(page);
    await expect(week.getByText("Subscriptions, typical month")).toBeVisible();

    // Use it: it becomes the budget, and the line goes away, after a reload too.
    await bills.getByRole("button", { name: "Use £56.50 a month for Subscriptions" }).click();
    await expect(bills.getByText(LINE)).toHaveCount(0);
    week = await whereItGoes(page);
    await expect(week.getByText("Subscriptions, still to pay")).toBeVisible();
    await expect(week.getByText("−£56.50")).toBeVisible();
    await page.reload();
    await expect(bills.getByText(LINE)).toHaveCount(0);
    week = await whereItGoes(page);
    await expect(week.getByText("Subscriptions, still to pay")).toBeVisible();

    // Cleared again, the typical month is back; Change sets another figure.
    await db.call("money_set_category_budget", { p_key: "subscriptions", p_pence: null });
    await page.reload();
    await expect(bills.getByText(LINE)).toBeVisible();
    await bills.getByRole("button", { name: "Change the figure for Subscriptions" }).click();
    await bills.getByLabel("Subscriptions a month (£)").fill("40");
    await bills.getByRole("button", { name: "Save the budget for Subscriptions" }).click();
    await expect(bills.getByText(LINE)).toHaveCount(0);
    await page.reload();
    week = await whereItGoes(page);
    await expect(week.getByText("Subscriptions, still to pay")).toBeVisible();
    await expect(week.getByText("−£40.00")).toBeVisible();
  } finally {
    // Back as it was.
    await db.call("money_set_category_budget", { p_key: "subscriptions", p_pence: null });
    await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
    await page.goto("/life/money");
    await page.getByRole("button", { name: "Erase all bank data" }).click();
    await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
  }
});
