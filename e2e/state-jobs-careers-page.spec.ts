import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FAKE_CLAUDE } from "./env";

// A careers page on the "Check by hand" list is read at the next check: Claude (the made-up
// one in e2e/fake-claude/careers.mjs) lists the roles on it, the tracker keeps those in
// the owner's fields, and the page moves to "Read automatically", at once and after a
// reload. Sources and roles can't be deleted, so the test passes on the role it brought
// in and pauses the page.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("a careers page is read at the next check: its graphics role arrives, the rest is left out, and the page is no longer checked by hand", async ({
  page,
}) => {
  const name = `t${randomUUID().slice(0, 8)}`;
  const employer = `Example Studio ${name}`;
  await page.goto("/jobs?view=sources");
  const follow = page.getByRole("region", { name: "Follow an employer" });
  await follow.getByLabel("Job link or careers page").fill(`${FAKE_CLAUDE}/careers/${name}`);
  await follow.getByLabel("Employer").fill(employer);
  await follow.getByRole("button", { name: "Follow" }).click();
  const byHand = page.getByRole("region", { name: "Check by hand" });
  await expect(byHand.getByRole("link", { name: employer })).toBeVisible();

  await page.getByRole("button", { name: "Check for new roles" }).click();
  const auto = page.getByRole("region", { name: "Read automatically" });
  const row = auto.getByRole("listitem").filter({ hasText: employer });
  await expect(row).toContainText("Careers page", { timeout: 30_000 });
  await expect(byHand.getByRole("link", { name: employer })).toHaveCount(0);
  await page.reload();
  // Both roles on the page were seen; only the one in the owner's fields is kept.
  await expect(row).toContainText("2 listed");
  await expect(byHand.getByRole("link", { name: employer })).toHaveCount(0);

  // The graphics role is on the board, with the page's own link; the office role is not.
  // With no advert text yet it is too little to judge, a section that starts closed.
  await page.goto("/jobs");
  await page.locator("summary").filter({ hasText: "Too little to judge" }).click();
  const role = page.getByRole("link", { name: `Graphics Engineer ${name}`, exact: true });
  await expect(role).toBeVisible();
  await expect(page.getByText(`Office Manager ${name}`)).toHaveCount(0);
  await role.click();
  const pane = page.getByLabel(`Role: Graphics Engineer ${name}`, { exact: true });
  await expect(pane.getByRole("link", { name: "Open the advert" })).toHaveAttribute(
    "href",
    `${FAKE_CLAUDE}/careers/${name}/jobs/1`,
  );

  // Put things back: pass on the role, and pause the page.
  await pane.getByLabel("Stage").selectOption("passed");
  await page.reload();
  await expect(pane.getByLabel("Stage")).toHaveValue("passed");
  await page.goto("/jobs?view=sources");
  await row.getByRole("button", { name: "Pause" }).click();
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible();
});
