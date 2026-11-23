import { expect, test, type Page } from "@playwright/test";
import { FAKE_LUNCHFLOW } from "./env";

// Pay steps start on a payday: the form offers the coming paydays by your payday rule,
// Your pay and the 13-week pay line show the payday each step starts on, and a step
// past the 13 weeks says so. Like the other Money tests it connects the made-up bank,
// and erases it again so the Money screenshot stays as approved. The suite's clock is
// Monday 16 November 2026, so the chart runs to 14 February 2027.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function connect(page: Page) {
  await page.goto("/life/money");
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await page.getByRole("button", { name: "Connect Lunch Flow" }).click();
  await page.getByRole("button", { name: "Connect this account" }).click();
}

async function eraseBank(page: Page) {
  await page.goto("/life/money");
  const erase = page.getByRole("button", { name: "Erase all bank data" });
  if ((await erase.count()) > 0) await erase.click();
  await expect(page.getByRole("button", { name: "Connect Lunch Flow" })).toBeVisible();
}

test("a pay step is picked from the coming paydays, shows the payday it starts on, and one past the 13 weeks says so, at once and after a reload", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=100000`);
  await connect(page);

  const pay = page.getByRole("region", { name: "Your pay" });
  const ahead = page.getByRole("region", { name: "The next 13 weeks" });
  // A label around a select takes in its options' text, so match the label's start.
  const from = pay.getByRole("combobox", { name: /^From the payday on/ });
  const save = async (day: string, takeHome: string) => {
    await from.selectOption(day);
    await pay.getByLabel("Take-home a month (£)").fill(takeHome);
    await pay.getByRole("button", { name: "Save the pay" }).click();
  };
  try {
    await expect(from).toHaveValue("2026-11-30");
    await expect(from.getByRole("option")).toHaveText([
      "Mon 30 Nov 2026",
      "Thu 31 Dec 2026",
      "Fri 29 Jan 2027",
      "Fri 26 Feb 2027",
      "Wed 31 Mar 2027",
      "Fri 30 Apr 2027",
      "Fri 28 May 2027",
      "Wed 30 Jun 2027",
      "Fri 30 Jul 2027",
      "Tue 31 Aug 2027",
      "Thu 30 Sept 2027",
      "Fri 29 Oct 2027",
    ]);

    await save("2026-11-30", "2000");
    await expect(pay.getByText("£2,000.00 a month from 30 Nov")).toBeVisible();
    await save("2027-01-29", "2500");
    await expect(pay.getByText("£2,500.00 a month from 29 Jan")).toBeVisible();
    await save("2027-02-26", "2600");
    await expect(pay.getByText("£2,600.00 a month from 26 Feb")).toBeVisible();

    const line = "Pay: 30 Nov £2,000.00 · 31 Dec £2,000.00 · 29 Jan £2,500.00";
    const note = pay.getByText("Starts after the 13 weeks, so not in the chart yet");
    await expect(ahead.getByText(line)).toBeVisible();
    await expect(note).toHaveCount(1);
    await expect(pay.getByRole("listitem").filter({ hasText: "from 26 Feb" })).toContainText("after the 13 weeks");
    await page.reload();
    await expect(ahead.getByText(line)).toBeVisible();
    await expect(pay.getByText("£2,500.00 a month from 29 Jan")).toBeVisible();
    await expect(pay.getByRole("listitem").filter({ hasText: "from 26 Feb" })).toContainText("after the 13 weeks");
    await expect(note).toHaveCount(1);
  } finally {
    // Back as it was.
    await page.goto("/life/money");
    for (const day of ["26 Feb", "29 Jan", "30 Nov"]) {
      const remove = pay.getByRole("button", { name: `Remove the pay from ${day}` });
      if ((await remove.count()) === 0) continue;
      await remove.click();
      await expect(remove).toHaveCount(0);
    }
    await eraseBank(page);
  }
});

test("the payday rule is saved with the pay, and the paydays to pick from and the forecast follow it at once and after a reload", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await request.post(`${FAKE_LUNCHFLOW}/__transactions`, { data: [] });
  await request.post(`${FAKE_LUNCHFLOW}/__balance?pence=100000`);
  await connect(page);

  const pay = page.getByRole("region", { name: "Your pay" });
  const ahead = page.getByRole("region", { name: "The next 13 weeks" });
  const rule = pay.getByRole("combobox", { name: /^You're paid on/ });
  const from = pay.getByRole("combobox", { name: /^From the payday on/ });
  try {
    await rule.selectOption("day-15");
    await pay.getByRole("button", { name: "Save when you're paid" }).click();
    await expect(from).toHaveValue("2026-12-15");
    await expect(ahead.getByText(/^Pay: 15 Dec not planned · 15 Jan not planned/)).toBeVisible();
    await page.reload();
    await expect(rule).toHaveValue("day-15");
    await expect(from).toHaveValue("2026-12-15");
    await expect(ahead.getByText(/^Pay: 15 Dec not planned/)).toBeVisible();
  } finally {
    // Back as it was.
    await page.goto("/life/money");
    await rule.selectOption("last-working-day");
    await pay.getByRole("button", { name: "Save when you're paid" }).click();
    await expect(from).toHaveValue("2026-11-30");
    await eraseBank(page);
  }
});
