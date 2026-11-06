import assert from "node:assert/strict";
import test from "node:test";
import { parseBoardLink, readFeed, rssItems } from "./feeds.ts";
import { followedNames, toPosting } from "./ingest.ts";

/** A stand-in for fetch that answers from a table and records what was asked. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (!(url in routes)) return new Response("not here", { status: 404 });
    const body = routes[url];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

test("a job link is enough to find an employer's feed", () => {
  assert.deepEqual(parseBoardLink("https://job-boards.greenhouse.io/example/jobs/123?gh_src=x"), { kind: "greenhouse", token: "example" });
  assert.deepEqual(parseBoardLink("https://jobs.ashbyhq.com/Example-Co/abc-def"), { kind: "ashby", token: "Example-Co" });
  assert.deepEqual(parseBoardLink("https://jobs.lever.co/example/abc"), { kind: "lever", token: "example" });
  assert.deepEqual(parseBoardLink("https://apply.workable.com/example/j/ABC/"), { kind: "workable", token: "example" });
  assert.deepEqual(parseBoardLink("https://example.teamtailor.com/jobs/1-role"), { kind: "teamtailor", token: "example" });
});

test("anything else is not treated as a feed", () => {
  assert.equal(parseBoardLink("https://www.linkedin.com/jobs/view/1/"), null);
  assert.equal(parseBoardLink("https://jobs.ashbyhq.com.evil.example/x/y"), null);
  assert.equal(parseBoardLink("not a link"), null);
});

test("a board name cannot redirect a request elsewhere", async () => {
  const { fetcher, calls } = fakeFetch({});
  const read = await readFeed({ kind: "ashby", token: "../../evil", name: "X" }, new Set(), fetcher);
  assert.equal(read.ok, false);
  assert.equal(calls.length, 0);
});

test("a kind with no feed is refused, not guessed at", async () => {
  const { fetcher, calls } = fakeFetch({});
  assert.equal((await readFeed({ kind: "link", token: "x", name: "X" }, new Set(), fetcher)).ok, false);
  assert.equal(calls.length, 0);
});

test("a failed read reports failure and claims to have seen nothing", async () => {
  const { fetcher } = fakeFetch({});
  const read = await readFeed({ kind: "lever", token: "gone", name: "X" }, new Set(), fetcher);
  assert.deepEqual([read.ok, read.seen, read.jobs], [false, null, []]);
  assert.match(read.error ?? "", /404/);
});

test("Ashby roles carry their text, every location and pay", async () => {
  const { fetcher } = fakeFetch({
    "https://api.ashbyhq.com/posting-api/job-board/example?includeCompensation=true": {
      jobs: [
        { id: "a", title: "Rendering Engineer", location: "Munich", secondaryLocations: [{ location: "London" }], jobUrl: "https://jobs.example/a", descriptionHtml: "<p>Vulkan</p>", publishedAt: "2026-10-05T10:00:00Z", compensation: { compensationTierSummary: "£80K" } },
        { id: "b", title: "Hidden", isListed: false },
      ],
    },
  });
  const read = await readFeed({ kind: "ashby", token: "example", name: "Example" }, new Set(), fetcher);
  assert.deepEqual(read.seen, ["a"]);
  assert.deepEqual(read.jobs[0].locations, ["Munich", "London"]);
  assert.equal(read.jobs[0].salary, "£80K");
  assert.equal(read.jobs[0].postedOn, "2026-10-05");
});

test("Greenhouse only fetches text for relevant roles it does not already hold", async () => {
  const base = "https://boards-api.greenhouse.io/v1/boards/example/jobs";
  const { fetcher, calls } = fakeFetch({
    [base]: {
      jobs: [
        { id: 1, title: "Rendering Engineer", location: { name: "London" } },
        { id: 2, title: "Rendering Engineer II", location: { name: "London" } },
        { id: 3, title: "Account Executive", location: { name: "London" } },
        { id: 4, title: "Backend Engineer", location: { name: "Seattle, USA" } },
      ],
    },
    [`${base}/1`]: { content: "<p>Vulkan</p>" },
  });
  const read = await readFeed({ kind: "greenhouse", token: "example", name: "Example" }, new Set(["2"]), fetcher);
  assert.deepEqual(calls, [base, `${base}/1`]);
  assert.deepEqual(read.seen, ["1", "2", "3", "4"], "everything listed counts as seen, kept or not");
  assert.deepEqual(read.jobs.map((j) => [j.id, j.content]), [["1", "<p>Vulkan</p>"], ["2", null]]);
});

test("Lever's sections keep their headings, and remote keeps its country", async () => {
  const { fetcher } = fakeFetch({
    "https://api.lever.co/v0/postings/example?mode=json": [
      { id: "x", text: "Engineer", categories: { location: "Remote" }, country: "US", workplaceType: "remote", hostedUrl: "https://jobs.example/x", description: "<p>Hi</p>", lists: [{ text: "Requirements", content: "<li>C++</li>" }] },
    ],
  });
  const read = await readFeed({ kind: "lever", token: "example", name: "Example" }, new Set(), fetcher);
  assert.deepEqual(read.jobs[0].locations, ["Remote, US"]);
  assert.match(read.jobs[0].content ?? "", /<h3>Requirements<\/h3>/);
  assert.equal(toPosting(read.jobs[0], "lever")?.location_tier, undefined, "a general role abroad is not kept");
});

test("RSS items are read by tag, with CDATA unwrapped", () => {
  const items = rssItems(`<rss><channel><item><title><![CDATA[Role & More]]></title><link>https://x.example/1</link><job_listing:location>London</job_listing:location></item></channel></rss>`);
  assert.equal(items.length, 1);
  assert.equal(items[0]("title"), "Role & More");
  assert.equal(items[0]("job_listing:location"), "London");
  assert.equal(items[0]("missing"), "");
});

test("a link that is not http is dropped", async () => {
  const { fetcher } = fakeFetch({
    "https://apply.workable.com/api/v1/widget/accounts/example?details=true": { jobs: [{ shortcode: "A", title: "Engineer", country: "United Kingdom", city: "London", url: "javascript:alert(1)", description: "x" }] },
  });
  const read = await readFeed({ kind: "workable", token: "example", name: "Example" }, new Set(), fetcher);
  assert.equal(read.jobs[0].url, null);
});

const job = (over: Partial<Parameters<typeof toPosting>[0]>) => ({ id: "1", title: "Rendering Engineer", company: "Example", locations: ["London"], remote: false, url: null, postedOn: null, salary: null, content: "Requirements\n- Vulkan", ...over });

test("a chosen employer's relevant role is kept, and its requirements read", () => {
  const row = toPosting(job({}), "ashby");
  assert.equal(row?.family, "graphics");
  assert.equal(row?.location_tier, "london");
  assert.deepEqual(row?.requirements.map((r) => r.skill), ["vulkan"]);
});

test("general software abroad is dropped, but a specialist role abroad can stay", () => {
  assert.equal(toPosting(job({ title: "Backend Engineer", locations: ["Berlin, Germany"] }), "ashby"), null);
  assert.equal(toPosting(job({ locations: ["Berlin, Germany"] }), "ashby")?.location_tier, "abroad");
});

test("a general feed must show a real link to your fields", () => {
  assert.equal(toPosting(job({ title: "Backend Engineer", content: "Requirements\n- TypeScript" }), "arbeitnow"), null);
  assert.equal(toPosting(job({ title: "Backend Engineer", content: "Requirements\n- Vulkan" }), "arbeitnow"), null, "one specialist skill is not enough");
  assert.ok(toPosting(job({ title: "Backend Engineer", content: "Requirements\n- Vulkan\n- Compute shaders" }), "arbeitnow"));
  assert.equal(toPosting(job({ title: "AI Engineer", content: "Requirements\n- Machine learning\n- LLMs" }), "arbeitnow"), null, "generic AI words do not count");
  assert.ok(toPosting(job({ title: "AI Engineer", content: "Requirements\n- PyTorch\n- Deep learning" }), "arbeitnow"));
  assert.equal(toPosting(job({ locations: ["Berlin, Germany"] }), "arbeitnow"), null, "not abroad from a general feed");
});

test("a general feed never repeats an employer you already follow", () => {
  const followed = followedNames([{ kind: "greenhouse", token: "exampleglobal", name: "Example Games" }, { kind: "arbeitnow", token: "uk", name: "Discovery" }]);
  assert.equal(toPosting(job({ company: "exampleglobal" }), "arbeitnow", followed), null);
  assert.equal(toPosting(job({ company: "Example Games" }), "arbeitnow", followed), null);
  assert.ok(toPosting(job({ company: "Someone Else" }), "arbeitnow", followed));
  assert.ok(toPosting(job({ company: "Discovery" }), "arbeitnow", followed));
});

test("addresses across several lines become one line", () => {
  assert.equal(toPosting(job({ locations: ["9 Appold St\nLondon\nUnited Kingdom"] }), "teamtailor")?.location, "9 Appold St, London, United Kingdom");
});
