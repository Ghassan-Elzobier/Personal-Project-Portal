import { expect, test } from "@playwright/test";
import { FAKE_CLAUDE } from "./env";

// A role from a pasted advert is read and saved in one tap: Claude (the made-up one in
// e2e/fake-claude.mjs) finds the advert among the page's lines and fills in the role,
// and a closing date becomes the step to apply by the day before. A misread detail is
// fixed in the role's pane. With the month's credit spent, nothing is added: what was
// read goes into the form instead. Roles can't be deleted, so the test ends by passing
// on the one it made, which takes it out of everything in progress.

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** A made-up advert as it comes off a page: the site's menus and other jobs around it. */
const advert = (title: string) =>
  [
    "Home  Jobs  Teams  Sign in",
    "We use cookies to make this site work",
    `Role: ${title}`,
    "Employer: Example Ltd",
    "Location: London, UK (hybrid)",
    "Salary: £45,000 to £55,000 a year",
    "Closing date: 30 November 2026",
    "About the role",
    "You will build real-time renderers for artists.",
    "Requirements",
    "- Strong C++ and Vulkan",
    "Similar jobs: Web Developer (React)",
  ].join("\n");

test("a pasted advert is read and saved in one tap with its details and a dated next step, and a fixed detail lasts a reload", async ({
  page,
}) => {
  const title = unique("Rendering engineer");
  await page.goto("/jobs?view=sources");
  const byHand = page.getByRole("region", { name: "Add a role by hand" });
  await byHand.getByLabel("Job link or advert").fill(advert(title));
  await byHand.getByRole("button", { name: "Add from the advert" }).click();

  // Saved at once: its pane opens with what the advert says.
  const pane = page.getByLabel(`Role: ${title}`, { exact: true });
  await expect(pane).toBeVisible();
  const check = async () => {
    await expect(pane).toContainText("Example Ltd, London, UK (hybrid)");
    await expect(pane).toContainText("£45,000 to £55,000 a year");
    await expect(pane.getByLabel("Next action")).toHaveValue("Apply, closes 30 Nov");
    await expect(pane.getByLabel("By", { exact: true })).toHaveValue("2026-11-29");
    // The advert kept is the advert alone, without the site's menus or its other jobs.
    await pane.getByText("The advert", { exact: true }).click();
    const kept = pane.locator("details");
    await expect(kept).toContainText("Strong C++ and Vulkan");
    await expect(kept).not.toContainText("We use cookies");
    await expect(kept).not.toContainText("Similar jobs");
  };
  await check();
  await page.reload();
  await check();

  // A detail is fixed in the pane, at once and after a reload.
  const fixed = `${title} II`;
  await pane.getByRole("button", { name: "Edit details" }).click();
  await pane.getByLabel("Role title", { exact: true }).fill(fixed);
  await pane.getByLabel("Salary", { exact: true }).fill("£50,000 a year");
  await pane.getByRole("button", { name: "Save details" }).click();
  const fixedPane = page.getByLabel(`Role: ${fixed}`, { exact: true });
  await expect(fixedPane).toContainText("£50,000 a year");
  await expect(fixedPane.getByRole("button", { name: "Save details" })).toHaveCount(0);
  await page.reload();
  await expect(fixedPane).toContainText("£50,000 a year");
  await expect(fixedPane).toContainText("Example Ltd, London, UK (hybrid)");

  // Back out of everything in progress: pass on the role.
  await fixedPane.getByLabel("Stage").selectOption("passed");
  await page.reload();
  await expect(fixedPane.getByLabel("Stage")).toHaveValue("passed");
});

test("with the month's credit spent, nothing is added and the advert goes into the form to finish by hand", async ({
  page,
  request,
}) => {
  await request.post(`${FAKE_CLAUDE}/__credit?spent=1`);
  try {
    const title = unique("Rendering engineer");
    await page.goto("/jobs?view=sources");
    const byHand = page.getByRole("region", { name: "Add a role by hand" });
    await byHand.getByLabel("Job link or advert").fill(advert(title));
    await byHand.getByRole("button", { name: "Add from the advert" }).click();

    await expect(byHand.getByRole("status")).toContainText("credit is spent");
    await expect(byHand.getByLabel("Advert text")).toHaveValue(new RegExp(`Role: ${title}`));
    await expect(byHand.getByLabel("Role title")).toHaveValue("");
    await expect(byHand.getByLabel("Role title")).toBeFocused();
    await expect(page.getByLabel(`Role: ${title}`, { exact: true })).toHaveCount(0);
  } finally {
    await request.post(`${FAKE_CLAUDE}/__credit?spent=0`);
  }
});
