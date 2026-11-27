import assert from "node:assert/strict";
import test from "node:test";
import { checkLink, fetchJobPage, isPublicAddress, PageError, pageText, type Lookup } from "./job-page.ts";

/** A made-up web: what each URL answers, and what each name resolves to. */
function fakeWeb(
  pages: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>,
  dns: Record<string, string[]> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const page = pages[url];
    if (!page) return new Response("not here", { status: 404 });
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...page.headers },
    });
  }) as typeof fetch;
  const lookup: Lookup = async (host) => dns[host] ?? ["93.184.215.14"];
  return { fetcher, lookup, calls };
}

const ADVERT = `<html><body><main><h1>Graphics Engineer</h1><p>${"Example Ltd builds tools for artists. ".repeat(8)}</p></main></body></html>`;

const messageOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof PageError, `expected a PageError, got ${String(e)}`);
    return e.message;
  }
  assert.fail("expected it to throw");
};

test("public addresses pass and private, loopback, link-local and reserved ones do not", () => {
  for (const ip of ["93.184.215.14", "8.8.8.8", "2606:4700::6810:84e5", "::ffff:93.184.215.14"])
    assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "not an address",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
});

test("only public web links on the standard ports are read", () => {
  assert.equal(checkLink(" https://jobs.example.org/role/1 ").hostname, "jobs.example.org");
  const refused = [
    "ftp://jobs.example.org/x",
    "file:///etc/passwd",
    "https://user:pass@jobs.example.org/",
    "https://jobs.example.org:8443/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://localhost/",
    "http://intranet/",
    "https://printer.local/",
    "https://metadata.internal/",
    "not a link",
  ];
  for (const link of refused) assert.throws(() => checkLink(link), PageError, link);
});

test("sites whose terms bar automated reading are never fetched, and the owner is told to paste", async () => {
  const { fetcher, lookup, calls } = fakeWeb({});
  for (const link of [
    "https://www.linkedin.com/jobs/view/123/",
    "https://uk.indeed.com/viewjob?jk=1",
    "https://www.glassdoor.co.uk/job-listing/x",
    "https://jobs.apple.com/en-gb/details/1",
  ])
    assert.match(await messageOf(() => fetchJobPage(link, fetcher, lookup)), /terms.*paste it here/);
  assert.equal(calls.length, 0);
});

test("a page is fetched once, without following redirects by itself", async () => {
  const { fetcher, lookup, calls } = fakeWeb({ "https://jobs.example.org/role/1": { body: ADVERT } });
  const page = await fetchJobPage("https://jobs.example.org/role/1", fetcher, lookup);
  assert.equal(page.url, "https://jobs.example.org/role/1");
  assert.match(page.html, /Graphics Engineer/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");
});

test("a redirect is followed only after its new address is checked", async () => {
  const { fetcher, lookup, calls } = fakeWeb({
    "http://careers.example.org/r/1": { status: 301, headers: { location: "https://boards.example.net/role/1" } },
    "https://boards.example.net/role/1": { body: ADVERT },
  });
  const page = await fetchJobPage("http://careers.example.org/r/1", fetcher, lookup);
  assert.equal(page.url, "https://boards.example.net/role/1");
  assert.equal(calls.length, 2);

  const inward = fakeWeb({
    "https://careers.example.org/r/2": {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    },
  });
  assert.match(
    await messageOf(() => fetchJobPage("https://careers.example.org/r/2", inward.fetcher, inward.lookup)),
    /isn't a public website/,
  );
  assert.equal(inward.calls.length, 1);
});

test("a public name that resolves to a private address is refused before anything is sent", async () => {
  const { fetcher, lookup, calls } = fakeWeb(
    { "https://sneaky.example.org/": { body: ADVERT } },
    { "sneaky.example.org": ["93.184.215.14", "10.0.0.5"] },
  );
  assert.match(await messageOf(() => fetchJobPage("https://sneaky.example.org/", fetcher, lookup)), /public website/);
  assert.equal(calls.length, 0);
  const nowhere = fakeWeb({}, { "gone.example.org": [] });
  assert.match(
    await messageOf(() => fetchJobPage("https://gone.example.org/", nowhere.fetcher, nowhere.lookup)),
    /Couldn't find/,
  );
});

test("a redirect loop stops", async () => {
  const { fetcher, lookup, calls } = fakeWeb({
    "https://a.example.org/": { status: 302, headers: { location: "https://b.example.org/" } },
    "https://b.example.org/": { status: 302, headers: { location: "https://a.example.org/" } },
  });
  assert.match(await messageOf(() => fetchJobPage("https://a.example.org/", fetcher, lookup)), /kept redirecting/);
  assert.equal(calls.length, 5);
});

test("a closed role, a refusal and a file that is not a page each say what to do", async () => {
  const { fetcher, lookup } = fakeWeb({
    "https://jobs.example.org/closed": { status: 410 },
    "https://jobs.example.org/walled": { status: 403 },
    "https://jobs.example.org/broken": { status: 502 },
    "https://jobs.example.org/role.pdf": { body: "%PDF-1.7", headers: { "content-type": "application/pdf" } },
  });
  assert.match(
    await messageOf(() => fetchJobPage("https://jobs.example.org/closed", fetcher, lookup)),
    /role may have closed/,
  );
  assert.match(
    await messageOf(() => fetchJobPage("https://jobs.example.org/walled", fetcher, lookup)),
    /paste it here/,
  );
  assert.match(await messageOf(() => fetchJobPage("https://jobs.example.org/broken", fetcher, lookup)), /answered 502/);
  assert.match(await messageOf(() => fetchJobPage("https://jobs.example.org/role.pdf", fetcher, lookup)), /PDF/);
});

test("a page that cannot be reached, or is too slow, says so", async () => {
  const lookup: Lookup = async () => ["93.184.215.14"];
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.match(await messageOf(() => fetchJobPage("https://jobs.example.org/", down, lookup)), /Couldn't reach/);
  const slow = (async () => {
    throw Object.assign(new Error("slow"), { name: "TimeoutError" });
  }) as typeof fetch;
  assert.match(await messageOf(() => fetchJobPage("https://jobs.example.org/", slow, lookup)), /too long/);
});

test("a huge page is read only up to the limit", async () => {
  const huge = `<html><body>${"x".repeat(4 * 1024 * 1024)}</body></html>`;
  const { fetcher, lookup } = fakeWeb({ "https://jobs.example.org/huge": { body: huge } });
  const page = await fetchJobPage("https://jobs.example.org/huge", fetcher, lookup);
  assert.ok(page.html.length <= 3 * 1024 * 1024);
});

test("a page's text is its main content, without menus, headers, footers or forms", () => {
  const html = `<html><body><header>Sign in</header><nav>Jobs Teams</nav><main><h1>Graphics Engineer</h1>
    <p>${"You will build renderers in C++. ".repeat(8)}</p><form><button>Apply</button></form></main>
    <footer>Cookies</footer></body></html>`;
  const text = pageText(html);
  assert.match(text, /^Graphics Engineer/);
  assert.doesNotMatch(text, /Sign in|Jobs Teams|Apply|Cookies/);
});

test("a page with too little text to be an advert is one to paste instead", () => {
  assert.throws(
    () => pageText('<html><body><div id="root"></div><script>render()</script></body></html>'),
    /builds itself in the browser/,
  );
});

test("only the suite's own local origin may be fetched though it isn't public, and only when given", async () => {
  const origin = "http://localhost:3198";
  assert.equal(checkLink(`${origin}/careers/x`, origin).href, `${origin}/careers/x`);
  assert.throws(() => checkLink(`${origin}/careers/x`), PageError);
  assert.throws(() => checkLink("http://localhost:3199/careers/x", origin), PageError);
  assert.throws(() => checkLink("http://169.254.169.254/latest", "http://169.254.169.254"), PageError);
  // A test origin that isn't on this machine opens nothing.
  assert.throws(() => checkLink("http://jobs.example.org:8080/", "http://jobs.example.org:8080"), PageError);
  const { fetcher, calls } = fakeWeb({ [`${origin}/careers/x`]: { body: ADVERT } });
  const asked: string[] = [];
  const lookup: Lookup = async (host) => {
    asked.push(host);
    return ["127.0.0.1"];
  };
  const page = await fetchJobPage(`${origin}/careers/x`, fetcher, lookup, origin);
  assert.match(page.html, /Graphics Engineer/);
  assert.deepEqual(asked, []);
  assert.equal(calls.length, 1);
});

test("each failure a caller words its own way carries its reason", async () => {
  const reasonOf = async (run: () => Promise<unknown> | unknown) => {
    try {
      await run();
    } catch (e) {
      assert.ok(e instanceof PageError);
      return e.reason;
    }
    assert.fail("expected it to throw");
  };
  const { fetcher, lookup } = fakeWeb({
    "https://jobs.example.org/closed": { status: 404 },
    "https://jobs.example.org/walled": { status: 403 },
  });
  assert.equal(await reasonOf(() => checkLink("https://www.linkedin.com/jobs")), "barred");
  assert.equal(await reasonOf(() => fetchJobPage("https://jobs.example.org/closed", fetcher, lookup)), "gone");
  assert.equal(await reasonOf(() => fetchJobPage("https://jobs.example.org/walled", fetcher, lookup)), "refused");
  assert.equal(await reasonOf(() => pageText("<html><body><div id=root></div></body></html>")), "browser");
  assert.equal(await reasonOf(() => checkLink("not a link")), "other");
});
