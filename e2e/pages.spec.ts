import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW, OWNER_PAGES } from "./env";

// Every owner page opens, shows its heading, throws nothing in the browser and,
// on phones, keeps all of its content inside the main column. The layout check
// exists because pages once scrolled sideways on the owner's Pixel 7: a check
// on document width alone missed it, since a parent with overflow hidden can
// mask an overflowing child (docs/DESIGN.md, "Phones first").

/** Elements whose right edge crosses the main column's content edge, ignoring horizontal scrollers. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["no <main> element"];
    const style = getComputedStyle(main);
    const edge = main.getBoundingClientRect().right - parseFloat(style.paddingRight) + 1;
    const inScroller = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll") return true;
      }
      return false;
    };
    const viewport = document.documentElement.clientWidth;
    const hits: string[] = [];
    for (const el of main.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= edge) continue;
      const s = getComputedStyle(el);
      if (s.position === "fixed" || s.visibility === "hidden" || el.closest("dialog:not([open])")) continue;
      if (inScroller(el)) continue;
      // Deliberate: a band that runs edge to edge on a phone (-mx-5 px-5), or a
      // row that scrolls sideways itself. Neither moves the page.
      const withinViewport = r.left >= -0.5 && r.right <= viewport + 0.5;
      const fullBleed = r.left <= 0.5 && Math.abs(r.right - viewport) <= 0.5;
      const scrolls = s.overflowX === "auto" || s.overflowX === "scroll";
      if (withinViewport && (fullBleed || scrolls)) continue;
      const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "");
      const text = (el.textContent ?? "").trim().slice(0, 40);
      hits.push(`${name} ends at ${Math.round(r.right)}px (edge ${Math.round(edge)}px) "${text}"`);
      if (hits.length >= 5) break;
    }
    return hits;
  });
}

for (const { path, heading } of OWNER_PAGES) {
  test(`${path} opens cleanly`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date(FIXED_NOW));

    const response = await page.goto(path);
    expect(response?.status(), "status").toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/login|\/no-access/);
    await expect(page.locator("h1").first()).toHaveText(heading);
    await expect(page.getByText("Application error")).toHaveCount(0);

    if (info.project.name !== "desktop") {
      expect(await overflowing(page), "content wider than the main column").toEqual([]);
    }
    expect(errors, "browser errors").toEqual([]);
  });
}
