import { expect, test, type Locator, type Page } from "@playwright/test";

// The chips you tap to filter or choose on the Work pages share one ToggleChip,
// 44 px tall like the rest of the portal's thumb targets (#202). They were about
// 24 px, close enough together that a thumb hit the one next door.
// Runs at the Pixel 7's 412 px and the 360 px small phone (playwright.config.ts).
// Tasks and Log show their chips only once a task exists, so their checks are in
// e2e/state-chip-targets.spec.ts, which adds one and deletes it again.

const MIN = 43.5;

async function tooSmall(targets: Locator): Promise<string[]> {
  const small: string[] = [];
  const all = await targets.all();
  expect(all.length, "there are chips to measure").toBeGreaterThan(0);
  for (const target of all) {
    const box = await target.boundingBox();
    if (!box || box.height < MIN)
      small.push(`"${(await target.textContent())?.trim()}" is ${Math.round(box?.height ?? 0)} px tall`);
  }
  return small;
}

async function noSidewaysScroll(page: Page) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the page does not scroll sideways").toBe(false);
}

test("the Jobs filters are thumb-sized", async ({ page }) => {
  await page.goto("/jobs");
  const small = [
    ...(await tooSmall(page.getByRole("group", { name: "Where" }).getByRole("link"))),
    ...(await tooSmall(page.getByRole("group", { name: "Field" }).getByRole("link"))),
  ];
  expect(small, `targets under ${MIN} px`).toEqual([]);
  await noSidewaysScroll(page);
});

test("the design page shows a ToggleChip on and off", async ({ page }) => {
  await page.goto("/design");
  const work = page.getByRole("group", { name: "Work toggles" });
  const on = work.locator('button[aria-pressed="true"]');
  const off = work.locator('button[aria-pressed="false"]');
  await expect(on).toHaveCount(1);
  await expect(off).toHaveCount(1);
  expect([...(await tooSmall(on)), ...(await tooSmall(off))]).toEqual([]);
});

test("a Jobs filter chip still changes the address and marks itself current", async ({ page }) => {
  await page.goto("/jobs");
  const where = page.getByRole("group", { name: "Where" });
  const uk = where.getByRole("link", { name: /Elsewhere in the UK/ });
  await expect(uk).not.toHaveAttribute("aria-current", "true");
  await uk.click();
  await expect(page).toHaveURL(/where=uk/);
  await expect(uk).toHaveAttribute("aria-current", "true");
  await expect(where.getByRole("link", { name: /London and remote/ })).not.toHaveAttribute("aria-current", "true");
});
