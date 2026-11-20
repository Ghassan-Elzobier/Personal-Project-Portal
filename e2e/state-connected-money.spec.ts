import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW, FIXED_NOW } from "./env";
import { captureForReview } from "./page-shot";

// Money as the owner uses it, with a bank connected. Seeded, the page is one card,
// "Connect your bank", and that card was all any design check ever saw. This test
// connects the made-up bank, sets a plan, a pay and two goals through the page's
// own forms, and then holds the thirteen sections the owner really sees to the same
// three checks as every other page: the approved look (at both phone sizes and on a
// desktop), the accessibility scan, and a page shot for R&D's reviews.
//
// It runs before the other save tests (its name sorts first), on the database as
// seeded: once a meal week is planned, "This week" gains a line about the shop,
// and the approved image has none. It puts everything back, so the seeded Money
// screenshot and the other Money tests find the page as they expect it.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Hidden in screenshots: the loading bar's animation and toasts.
const HIDE = "e2e/screenshot.css";
const GOALS = ["Example bike", "Example holiday"];

/** Made-up payments around the suite's Monday, 16 November 2026. */
const PAYMENTS = [
  { id: "c1", date: "2026-11-16", pence: -1840, text: "EXAMPLE MARKET" },
  { id: "c2", date: "2026-11-15", pence: -1200, text: "EXAMPLE CAFE", pending: true },
  { id: "c3", date: "2026-11-14", pence: -4275, text: "EXAMPLE GROCER" },
  { id: "c4", date: "2026-11-13", pence: -650, text: "EXAMPLE BAKERY" },
  { id: "c5", date: "2026-11-10", pence: -2999, text: "EXAMPLE GYM" },
];

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
  for (const name of GOALS) {
    const remove = goals.getByRole("button", { name: `Remove ${name}` });
    if ((await remove.count()) === 0) continue;
    await remove.click();
    await expect(goals.getByText(name, { exact: true })).toHaveCount(0);
  }
  const removePay = pay.getByRole("button", { name: /^Remove the pay from / });
  if ((await removePay.count()) > 0) {
    await removePay.click();
    await expect(removePay).toHaveCount(0);
  }
  await plan.getByLabel("To live on each week (£)").fill("");
  await plan.getByRole("button", { name: "Save the plan" }).click();
  await expect(week.getByText("Set the amount you live on each week")).toBeVisible();
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await page.getByRole("button", { name: "Erase all bank data" }).click();
  await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
}

test("Money with a bank connected looks as approved, has no serious accessibility issues, and is captured for review", async ({
  page,
  request,
  browser,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  const { week, goals, pay, plan } = parts(page);

  await page.goto("/life/money");
  // From a known start: a run that stopped half-way may have left the bank connected.
  if ((await page.getByRole("button", { name: "Erase all bank data" }).count()) > 0) await putBack(page, request);

  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=184250`);
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: PAYMENTS });
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();
  try {
    await plan.getByLabel("To live on each week (£)").fill("150");
    await plan.getByRole("button", { name: "Save the plan" }).click();
    await expect(week.getByText("£131.60 left")).toBeVisible();
    await pay.getByLabel("Salary a year (£)").fill("30000");
    await pay.getByRole("button", { name: "Save the pay" }).click();
    await expect(pay.getByText("£2,093.30 a month from 30 Nov")).toBeVisible();
    for (const [name, pounds] of [
      [GOALS[0], "300"],
      [GOALS[1], "600"],
    ]) {
      if (!(await goals.getByLabel("What it's for").isVisible())) await goals.getByText("Add a goal").click();
      await goals.getByLabel("What it's for").fill(name);
      await goals.getByLabel("Target (£)").fill(pounds);
      await goals.getByRole("button", { name: "Add the goal" }).click();
      await expect(goals.getByText(name, { exact: true })).toBeVisible();
    }

    // For R&D's reviews: the page shot and its facts, beside the seeded page's. In a browser
    // that has not been here before, so what the page loads is counted and not found in a cache.
    const firstVisit = await browser.newContext();
    const facts = await captureForReview(await firstVisit.newPage(), "/life/money", {
      name: "connected",
      label: "bank connected",
    });
    await firstVisit.close();
    expect(facts.shot).toBe("life-money-connected.png");
    for (const heading of ["h2: This week", "h2: Goals", "h2: Balance"]) expect(facts.headings).toContain(heading);
    expect(facts.screens, "the page in use is many screens long, not one card").toBeGreaterThan(5);
    expect(facts.jsKb, "its scripts were counted").toBeGreaterThan(50);

    await expect(
      week.getByText(/for the shops before Monday/),
      "The approved image has no meal week planned. This test must run before any save test plans one: keep its file name sorting first.",
    ).toHaveCount(0);

    // The approved look, at the sizes the screenshot suite uses. Opened afresh, as the
    // owner finds it: the forms the setup used are closed again.
    await page.goto("/life/money");
    const phone = page.viewportSize() ?? { width: 412, height: 839 };
    for (const [name, size] of [
      ["phone", phone],
      ["small-phone", { width: 360, height: 780 }],
      ["desktop", { width: 1280, height: 800 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`money-connected-${name}.png`, { fullPage: true, stylePath: HIDE });
    }
    await page.setViewportSize(phone);

    // WCAG 2.2 A and AA, as e2e/a11y.spec.ts scans every seeded page. Nothing is excused in a baseline.
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const serious = scan.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
      );
    expect(serious, "serious accessibility issues on the connected Money page").toEqual([]);
  } finally {
    await putBack(page, request);
  }
});
