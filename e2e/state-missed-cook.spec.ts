import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { connectClaude } from "./connector";
import { ownerDatabase } from "./owner-database";

// A cook session whose time went by with nothing cooked used to sit on Today as if
// nothing went wrong. Today now says it was missed and offers the next free time in
// one tap, with Undo. The test moves a session to 06:00 today in the Kitchen, so its
// time has gone by the suite's 09:30, moves it from Today, and puts it back after.
// Today shows the Life plan only once the profile is set up, which the seed leaves
// empty: the test gives it a made-up body through the database and puts it back.

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

/** The suite's pinned day and time: Monday 16 November 2026, 09:30. */
const TODAY = "2026-11-16";
const SIX = 6 * 60;

/** This meal week planned, as the other save tests do when nothing is planned today. */
async function aPlannedWeek(page: Page, request: APIRequestContext) {
  const claude = await connectClaude(page, request);
  try {
    const day = JSON.parse((await claude.call("get_life_day", { date: TODAY })).text) as {
      routine: { kind: string; slot?: string; detail: string }[];
    };
    const breakfast = day.routine.find((r) => r.kind === "meal" && r.slot === "breakfast");
    if (breakfast && breakfast.detail !== "Nothing planned") return;
    const planned = await claude.call("plan_meal_week", {});
    expect(planned.isError, planned.text).toBe(false);
  } finally {
    await claude.disconnect();
  }
}

/** Moves the Kitchen's session that opens at `href` to a day and time, with its own Move. */
async function moveInKitchen(page: Page, href: string, date: string, time: string) {
  await page.goto("/life/kitchen?tab=fridge");
  const card = page.locator(".card-life").filter({ has: page.locator(`a[href="${href}"]`) });
  await card.getByRole("button", { name: "Move", exact: true }).click();
  await card.getByLabel("Day").selectOption(date);
  await card.getByLabel("Time").fill(time);
  await card.locator("form").getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Moved. The Schedule and your calendar follow.")).toBeVisible();
}

test("a cook whose time went by reads Missed on Today, moves in one tap at once and after a reload, and Undo puts it back", async ({
  page,
  request,
}) => {
  const db = await ownerDatabase();
  const read = await db.call<{ profile: Record<string, unknown> | null }>("life_read", { p_since: "2026-10-19" });
  const before = read.profile ?? {};
  await db.call("life_save_profile", {
    p_data: { ...before, body: { sex: "male", birthYear: 1990, heightCm: 175, ...(before.body ?? {}) } },
  });
  try {
    await aMissedCook(page, request);
  } finally {
    await db.call("life_save_profile", { p_data: before });
  }
});

async function aMissedCook(page: Page, request: APIRequestContext) {
  await aPlannedWeek(page, request);

  // A session still to cook, today or later, so it can be put back where it was.
  await page.goto("/life/kitchen?tab=fridge");
  const links = page
    .getByRole("region", { name: "To cook" })
    .locator(".card-life")
    .filter({ has: page.getByRole("button", { name: "Cooked it" }) })
    .getByRole("link", { name: "Open the cook" });
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const own = hrefs
    .map((h) => /^\/life\/cook\?day=(\d{4}-\d{2}-\d{2})&at=(\d+)$/.exec(h))
    .find((m) => m && m[1] >= TODAY && Number(m[2]) !== SIX);
  expect(own, "a session still to come").toBeTruthy();
  const [href, day, at] = own!;
  const was = `${String(Math.floor(Number(at) / 60)).padStart(2, "0")}:${String(Number(at) % 60).padStart(2, "0")}`;

  const sixHref = `/life/cook?day=${TODAY}&at=${SIX}`;
  // Where the session is now, so it can always be put back.
  let current = href;
  try {
    // To 06:00 today: by 09:30 its time has gone.
    await moveInKitchen(page, href, TODAY, "06:00");
    current = sixHref;

    await page.goto("/");
    const yourDay = page.getByRole("region", { name: "Your day" });
    const row = yourDay.getByRole("listitem").filter({ has: page.locator(`a[href="${sixHref}"]`) });
    await expect(row.getByText("Missed", { exact: true })).toBeVisible();
    const offer = row.getByRole("button", { name: /^(Move to|Tomorrow) \d\d:\d\d$/ });
    const label = (await offer.innerText()).trim();
    const [, when, hh, mm] = /^(Move to|Tomorrow) (\d\d):(\d\d)$/.exec(label)!;
    const date = when === "Tomorrow" ? "2026-11-17" : TODAY;
    const movedHref = `/life/cook?day=${date}&at=${Number(hh) * 60 + Number(mm)}`;
    const moved = page.getByText(/^Cook moved to (tomorrow, )?\d\d:\d\d\.$/);

    // One tap: it leaves 06:00 at once. Undo puts it back, missed again, after a reload too.
    await offer.click();
    await expect(moved).toBeVisible();
    current = movedHref;
    await expect(yourDay.locator(`a[href="${sixHref}"]`)).toHaveCount(0);
    if (date === TODAY) await expect(yourDay.locator(`a[href="${movedHref}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row.getByText("Missed", { exact: true })).toBeVisible();
    current = sixHref;
    await page.reload();
    await expect(row.getByText("Missed", { exact: true })).toBeVisible();

    // Tapped again, it stays at its new time after a reload, in the Kitchen as on Today.
    await row.getByRole("button", { name: label }).click();
    await expect(moved).toBeVisible();
    current = movedHref;
    await page.reload();
    await expect(yourDay.locator(`a[href="${sixHref}"]`)).toHaveCount(0);
    if (date === TODAY) await expect(yourDay.locator(`a[href="${movedHref}"]`)).toBeVisible();
    await page.goto("/life/kitchen?tab=fridge");
    await expect(page.locator(`a[href="${movedHref}"]`)).toBeVisible();
  } finally {
    // Back where it was.
    if (current !== href) await moveInKitchen(page, current, day, was);
  }
}
