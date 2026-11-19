import { expect, test, type Page } from "@playwright/test";
import { FIXED_NOW, OWNER_PAGES, OWNER_STATE } from "./env";

// The Content-Security-Policy (src/lib/auth/csp.ts, set in src/proxy.ts): only the
// portal's own scripts may run, held to a nonce that is new for every request.
// These checks read the header, and then load every page and fail on anything the
// browser refused because of it: a policy that is too strict breaks a page quietly.

const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1) ?? [];
const nonceIn = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";

async function policyOf(page: Page, path: string) {
  const response = await page.goto(path);
  return response?.headers()["content-security-policy"] ?? "";
}

type Watched = Window & { __refused?: string[] };

/** Starts recording what the browser refuses under the policy; call the result to read it, page by page. */
async function watch(page: Page) {
  const said: string[] = [];
  page.on("console", (message) => {
    if (/Content[ -]Security[ -]Policy/i.test(message.text())) said.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const w = window as Watched;
      w.__refused = [...(w.__refused ?? []), `${event.violatedDirective}: ${event.blockedURI || "inline"}`];
    });
  });
  return async () => {
    const onPage = await page.evaluate(() => (window as Watched).__refused ?? []);
    // The console's lines are handed over once, so one page's trouble is not blamed on the next.
    return [...onPage, ...said.splice(0)];
  };
}

test.describe("content security policy", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "pixel-7", "Runs once, at phone size.");
  });

  test("signed-in pages carry the policy, with a nonce that is new on every load and is on the page's scripts", async ({
    page,
  }) => {
    for (const path of ["/", "/life/money"]) {
      const policy = await policyOf(page, path);
      const nonce = nonceIn(policy);
      expect(nonce, `${path} has a nonce`).not.toBe("");
      expect(directive(policy, "script-src"), path).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
      expect(directive(policy, "object-src"), path).toEqual(["'none'"]);
      expect(directive(policy, "base-uri"), path).toEqual(["'none'"]);
      expect(directive(policy, "frame-ancestors"), path).toEqual(["'none'"]);

      // Next.js put this request's nonce on the scripts it rendered, and they ran.
      const onScripts = await page.evaluate(() => [...document.scripts].map((s) => s.nonce).filter(Boolean));
      expect(onScripts.length, `${path} has scripts with a nonce`).toBeGreaterThan(0);
      expect([...new Set(onScripts)], path).toEqual([nonce]);
      await expect
        .poll(() => page.evaluate(() => typeof (window as Window & { next?: { version?: string } }).next?.version))
        .toBe("string");

      expect(nonceIn(await policyOf(page, path)), `${path} gets a new nonce each time`).not.toBe(nonce);
    }
  });

  test("a script that gets into a page does not run", async ({ page, browser }) => {
    // What a slip in escaping would let through: markup that carries a script of its own.
    const inject = (target: Page) =>
      target.evaluate(() => {
        const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        document.body.insertAdjacentHTML(
          "beforeend",
          `<img alt="" src="${pixel}" onload="window.__injected = true"><a id="injected" href="javascript:window.__injected = true">x</a>`,
        );
        // Followed from the page itself: the link sits under the tab bar, where a tap can't reach it.
        document.getElementById("injected")?.click();
      });
    const ran = (target: Page) => target.evaluate(() => (window as Window & { __injected?: boolean }).__injected);

    const refused = await watch(page);
    await page.goto("/");
    await inject(page);
    await expect.poll(async () => (await refused()).some((line) => line.startsWith("script-src"))).toBe(true);
    expect(await ran(page)).toBeUndefined();

    // The control: in a browser told to ignore the policy, the same markup does run. So it is the policy that stops it.
    const context = await browser.newContext({ storageState: OWNER_STATE, bypassCSP: true });
    const open = await context.newPage();
    await open.goto("/");
    await inject(open);
    await expect.poll(() => ran(open)).toBe(true);
    await context.close();
  });

  test("the sign-in page carries the policy too, and nothing on it is refused", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const refused = await watch(page);
    const policy = await policyOf(page, "/login");
    expect(page.url()).toContain("/login");
    expect(directive(policy, "script-src")).toEqual(["'self'", `'nonce-${nonceIn(policy)}'`, "'strict-dynamic'"]);
    await page.waitForLoadState("networkidle");
    expect(await refused()).toEqual([]);
    await context.close();
  });

  test("no page has a script, style, picture or request refused by the policy", async ({ page }) => {
    test.setTimeout(180_000);
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    const refused = await watch(page);
    // Every page the owner can open, and one that does not exist.
    for (const path of [...OWNER_PAGES.map((p) => p.path), "/no-such-page"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect.soft(await refused(), path).toEqual([]);
    }
  });
});
