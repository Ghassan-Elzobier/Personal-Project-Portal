import { expect, test } from "@playwright/test";

// The gym page is used between sets, with tired hands: every control on an
// exercise card has to be easy to hit with a thumb. The shared `tap` size is 44 px,
// and "How" and "+ Add a set" were once bare 12 px text, about a 16 px strip.
// Runs at the Pixel 7's 412 px and the 360 px small phone (playwright.config.ts).

const MIN = 44;

test("every button on an exercise card is a thumb-sized target", async ({ page }) => {
  await page.goto("/life/gym");
  const cards = page.locator("article").filter({ has: page.getByRole("heading", { level: 3 }) });
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  const small: string[] = [];
  for (const card of await cards.all()) {
    const name = (await card.getByRole("heading", { level: 3 }).textContent())?.trim() ?? "";
    for (const label of ["How", "+ Add a set"]) {
      const box = await card.getByRole("button", { name: label, exact: true }).boundingBox();
      if (!box || box.height < MIN - 0.5 || box.width < MIN - 0.5)
        small.push(`${name}: "${label}" is ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)}`);
    }
    for (const button of await card.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (box && box.height < MIN - 0.5)
        small.push(`${name}: "${(await button.textContent())?.trim()}" is ${Math.round(box.height)} px tall`);
    }
  }
  expect(small, `targets under ${MIN} px`).toEqual([]);

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways, "the page does not scroll sideways").toBe(false);
});

test('"How" still opens and closes the tips, and "+ Add a set" still adds a row', async ({ page }) => {
  await page.goto("/life/gym");
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { level: 3 }) })
    .first();

  const how = card.getByRole("button", { name: "How", exact: true });
  await expect(how).toHaveAttribute("aria-expanded", "false");
  await how.click();
  const hide = card.getByRole("button", { name: "Hide tips", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(how).toHaveAttribute("aria-expanded", "false");

  const rows = card.locator("ol > li");
  const before = await rows.count();
  await card.getByRole("button", { name: "+ Add a set", exact: true }).click();
  await expect(rows).toHaveCount(before + 1);
});
