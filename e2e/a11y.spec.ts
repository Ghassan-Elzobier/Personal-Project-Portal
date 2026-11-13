import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXED_NOW, OWNER_PAGES } from "./env";

// Axe checks each page against WCAG 2.2 A and AA. Serious and critical findings
// fail the run. Known findings that predate this suite are listed in
// e2e/a11y-baseline.json, so new pages and changes must be clean while the
// refactor queue works the old ones off. Remove an entry once it is fixed.
import baseline from "./a11y-baseline.json" with { type: "json" };

const known = baseline as Record<string, string[]>;

test.describe("accessibility", () => {
  for (const { path } of OWNER_PAGES) {
    test(`${path} has no serious accessibility issues`, async ({ page }, info) => {
      test.skip(info.project.name !== "pixel-7", "Runs once, at phone size.");
      await page.clock.setFixedTime(new Date(FIXED_NOW));
      await page.goto(path);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      const allowed = new Set(known[path] ?? []);
      const fresh = result.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .filter((v) => !allowed.has(v.id))
        .map(
          (v) =>
            `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
        );
      expect(fresh, "new serious accessibility issues").toEqual([]);
    });
  }
});
