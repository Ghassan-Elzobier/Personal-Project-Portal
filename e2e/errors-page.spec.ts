import { expect, test } from "@playwright/test";

// The errors page (/errors): its test buttons send a real error from the server
// and from the browser through the whole pipeline, and each arrives with its
// stack mapped back to the source (the suite runs a production build with the
// packed source maps). Ignore and Restore change where a bug is listed. These
// change shared data, so they run on one device; e2e/pages.spec.ts and
// e2e/a11y.spec.ts check the pages themselves on every size.

test.describe("the errors page", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "pixel-7"));

  test("a test error from the browser arrives with its stack mapped to the source", async ({ page }) => {
    await page.goto("/errors");
    await page.getByRole("button", { name: "From the browser" }).click();
    await expect(page.getByText("Test error sent from the browser")).toBeVisible();
    await page.getByRole("link", { name: /Test error from the errors page \(browser\)/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Error" })).toBeVisible();
    await expect(page.getByText(/src\/lib\/errors\/browser\.ts:\d+:\d+/).first()).toBeVisible();
    await expect(page.getByText("load → /errors")).toBeVisible();
  });

  test("a test error from the server arrives with its stack mapped to the source", async ({ page }) => {
    await page.goto("/errors");
    await page.getByRole("button", { name: "From the server" }).click();
    await expect(page.getByText("Test error sent from the server")).toBeVisible();
    await page.getByRole("link", { name: /Test error from the errors page \(server\)/ }).click();
    await expect(page.getByText(/src\/app\/errors\/actions\.ts:\d+:\d+/).first()).toBeVisible();
  });

  test("ignoring a bug moves it to Ignored, and restoring brings it back", async ({ page }) => {
    await page.goto("/errors/5eed0000000000000000000000000002");
    await page.getByRole("button", { name: "Ignore" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    await page.goto("/errors?show=ignored");
    await expect(page.getByRole("link", { name: /Invalid time value/ })).toBeVisible();
    await page.goto("/errors/5eed0000000000000000000000000002");
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Ignore" })).toBeVisible();
    await page.goto("/errors");
    await expect(page.getByRole("link", { name: /Invalid time value/ })).toBeVisible();
  });
});
