import { expect, test } from "@playwright/test";

// The error tracker maps stack frames back to source lines with the build's
// source maps (src/lib/errors/symbolicate.ts). The maps must exist, so frames
// are readable, and must never be served, so the code stays private even if
// the repository does not (src/proxy.ts).

test("the build's source maps exist but are never served", async ({ page, request }) => {
  await page.goto("/");
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")]
      .map((s) => (s as HTMLScriptElement).src)
      .filter((src) => src.includes("/_next/static/") && src.endsWith(".js")),
  );
  expect(scripts.length).toBeGreaterThan(0);

  const chunk = await request.get(scripts[0]);
  expect(chunk.status()).toBe(200);
  // The chunk points to its map, so the map was built and a 404 means it is refused.
  expect(await chunk.text()).toMatch(/\/\/# sourceMappingURL=\S+\.map/);

  for (const src of scripts.slice(0, 3)) {
    const map = await request.get(`${src}.map`);
    expect(map.status(), `${src}.map`).toBe(404);
  }
});

test("a browser error after a few actions is reported with its breadcrumbs", async ({ page }) => {
  await page.goto("/life");
  await page.locator('main a[href^="/"]:visible').first().click();
  await page.waitForLoadState("networkidle");
  const reported = page.waitForResponse((r) => r.url().endsWith("/api/errors") && r.request().method() === "POST");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e probe: breadcrumbs come with this");
    });
  });
  const response = await reported;
  expect(response.status()).toBe(204);
  const sent = response.request().postDataJSON() as { breadcrumbs: { kind: string }[]; viewport: string };
  expect(sent.breadcrumbs.map((c) => c.kind)).toContain("navigation");
  expect(sent.breadcrumbs.map((c) => c.kind)).toContain("click");
  expect(sent.viewport).toMatch(/^\d+x\d+$/);
});
