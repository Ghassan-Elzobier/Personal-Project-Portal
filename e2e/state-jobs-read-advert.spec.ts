import { expect, test } from "@playwright/test";
import { FAKE_CLAUDE } from "./env";

// A role from a careers page arrives with a title and a link only, so it can't be
// compared. "Read the advert" in its pane reads it from that link; the advert is written
// as prose, which the rules can't separate into requirements, so Claude (the made-up one
// in e2e/fake-claude/requirements.mjs) reads them from its own words. The requirements
// show at once and after a reload. The test passes on the role and pauses the page.

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("a role with only a link has its advert read from its pane, Claude reads requirements the rules can't, and they last a reload", async ({
  page,
}) => {
  const name = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const employer = `Example Studio ${name}`;
  await page.goto("/jobs?view=sources");
  const follow = page.getByRole("region", { name: "Follow an employer" });
  await follow.getByLabel("Job link or careers page").fill(`${FAKE_CLAUDE}/careers/${name}`);
  await follow.getByLabel("Employer").fill(employer);
  await follow.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("region", { name: "Check by hand" }).getByRole("link", { name: employer })).toBeVisible();
  await page.getByRole("button", { name: "Check for new roles" }).click();
  const row = page
    .getByRole("region", { name: "Read automatically" })
    .getByRole("listitem")
    .filter({ hasText: employer });
  await expect(row).toContainText("Careers page", { timeout: 30_000 });

  await page.goto("/jobs");
  await page.getByRole("link", { name: `Graphics Engineer ${name}`, exact: true }).click();
  const pane = page.getByLabel(`Role: Graphics Engineer ${name}`, { exact: true });
  await expect(pane).toContainText("The advert text is not on file yet");
  await pane.getByRole("button", { name: "Read the advert" }).click();

  const requires = pane
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Requires", exact: true }) });
  const wanted = pane
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Also wanted, or part of the job", exact: true }) });
  const check = async () => {
    await expect(requires).toContainText("Vulkan");
    await expect(requires).toContainText("C++");
    await expect(requires).toContainText("Claude read these from the advert's own words");
    await expect(requires).toContainText("You have shipped a real-time renderer in Vulkan");
    await expect(wanted).toContainText("CUDA");
    await expect(pane.getByRole("button", { name: "Read the advert" })).toHaveCount(0);
  };
  await check();
  await page.reload();
  await check();

  // Put things back: pass on the role, and pause the page.
  await pane.getByLabel("Stage").selectOption("passed");
  await page.reload();
  await expect(pane.getByLabel("Stage")).toHaveValue("passed");
  await page.goto("/jobs?view=sources");
  await row.getByRole("button", { name: "Pause" }).click();
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible();
});
