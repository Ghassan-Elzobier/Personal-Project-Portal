import { expect, test, type Page } from "@playwright/test";
import { ownerDatabase } from "./owner-database";

// A counted cupboard staple, as the owner sees it: the Cupboard says about how much
// is left, and marking it out by hand stops the count, at once and after a reload.
// The count is set up through the database (only a shop counts a staple in) and the
// row put back as it was after.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const ITEM = "fish-sauce";
const NAME = "Fish sauce";

type Row = { item: string; qty: number; status: "have" | "low" | "out" | null };

/** The Cupboard's staples, and the row for this one. */
async function staples(page: Page) {
  const filter = page.getByRole("button", { name: "Staples", exact: true });
  // The filter only works once the page has hydrated, so tap it until it is on.
  await expect(async () => {
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();
  return page.getByRole("listitem").filter({ has: page.getByText(NAME, { exact: true }) });
}

test("a counted staple shows about how much is left, and marking it out stops the count, at once and after a reload", async ({
  page,
}) => {
  const db = await ownerDatabase();
  const read = await db.call<{ stock: Row[] }>("life_read", { p_since: "2026-11-16" });
  const before = read.stock.find((r) => r.item === ITEM) ?? { item: ITEM, qty: 0, status: null };
  const set = (qty: number, status: Row["status"]) =>
    db.call("life_stock", { p_changes: [{ item: ITEM, qty, status }], p_mode: "set" });
  await set(120, "have");
  try {
    await page.goto("/life/kitchen?tab=cupboard");
    const row = await staples(page);
    const out = row.getByRole("button", { name: "Out", exact: true });
    await expect(row).toContainText("Have it · about 120 ml left");

    await out.click();
    await expect(out).toHaveAttribute("aria-pressed", "true");
    await expect(row).not.toContainText("left");

    await page.reload();
    await staples(page);
    await expect(out).toHaveAttribute("aria-pressed", "true");
    await expect(row).not.toContainText("left");
  } finally {
    await set(Number(before.qty), before.status);
  }
});
