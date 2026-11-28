import { expect, test } from "@playwright/test";

// Skills ranks the gaps by how many roles each one would move up a band if you could
// show it (#239), in a "Moves up" column. The counting is unit-tested
// (src/lib/jobs/unlocks.test.ts). This checks that the column is there and the page fits.
// The seed has no roles, so the test adds one from a made-up advert (read by
// e2e/fake-claude.mjs). Roles can't be deleted, so it ends by passing on the role,
// which takes it out of the market again.
// Runs at the Pixel 7's 412 px (the state project, playwright.config.ts).

test.setTimeout(60_000);

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

const advert = (title: string) =>
  [
    `Role: ${title}`,
    "Employer: Example Ltd",
    "Location: London, UK",
    "About the role",
    "You will build real-time renderers for artists.",
    "Requirements",
    "- Strong C++ and Vulkan",
    "- Experience with CUDA",
    "- Experience with Houdini",
  ].join("\n");

test("the not-in-your-plan table shows how many roles each skill would move up, and the page does not scroll sideways", async ({
  page,
}) => {
  const title = unique("Rendering engineer");
  await page.goto("/jobs?view=sources");
  const byHand = page.getByRole("region", { name: "Add a role by hand" });
  await byHand.getByLabel("Job link or advert").fill(advert(title));
  await byHand.getByRole("button", { name: "Add from the advert" }).click();
  const pane = page.getByLabel(`Role: ${title}`, { exact: true });
  await expect(pane).toBeVisible();
  await expect(page).toHaveURL(/[?&]role=\d+/);
  const rolePage = page.url();

  try {
    await page.goto("/jobs?view=skills");
    const gaps = page.getByRole("region", { name: "Asked for, and not in your plan" });
    await expect(gaps.getByRole("columnheader", { name: "Moves up" })).toBeVisible();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(sideways, "the page does not scroll sideways").toBe(false);
  } finally {
    // Back out of the market: pass on the role.
    await page.goto(rolePage);
    await pane.getByLabel("Stage").selectOption("passed");
    await page.reload();
    await expect(pane.getByLabel("Stage")).toHaveValue("passed");
  }
});
