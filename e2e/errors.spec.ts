import { expect, test } from "@playwright/test";

// Errors in the browser reach the error tracker, which the factory files as bug
// issues (docs/FACTORY.md). The suite turns reporting on with ERROR_REPORTING
// (scripts/e2e.sh); in production it is always on. 204 means report_error
// stored the report; anything else means it was not kept.

const REPORT = {
  name: "Error",
  message: "e2e probe: the error tracker hears this",
  stack: "",
  path: "/",
  context: "uncaught",
  release: "",
};

test("an uncaught browser error is reported and stored", async ({ page }) => {
  await page.goto("/");
  const reported = page.waitForResponse((r) => r.url().endsWith("/api/errors") && r.request().method() === "POST");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e probe: the error tracker hears this");
    });
  });
  expect((await reported).status()).toBe(204);
});

test("a malformed report is refused", async ({ request }) => {
  const response = await request.post("/api/errors", { data: { ...REPORT, context: "server" } });
  expect(response.status()).toBe(400);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor cannot report errors", async ({ request }) => {
    const response = await request.post("/api/errors", { data: REPORT, maxRedirects: 0 });
    expect(response.status()).not.toBe(204);
  });
});
