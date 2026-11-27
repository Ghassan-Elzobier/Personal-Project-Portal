import assert from "node:assert/strict";
import test from "node:test";
import { postingData } from "./posting-data.ts";
import { salaryOf } from "./salary.ts";

const page = (...blocks: unknown[]) =>
  `<html><head><title>Careers</title>${blocks
    .map((b) => `<script type="application/ld+json">${typeof b === "string" ? b : JSON.stringify(b)}</script>`)
    .join("")}</head><body><nav>Menu</nav></body></html>`;

const POSTING = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Graphics Engineer",
  hiringOrganization: { "@type": "Organization", name: "Example Ltd" },
  jobLocation: {
    "@type": "Place",
    address: { "@type": "PostalAddress", addressLocality: "London", addressCountry: "GB" },
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "GBP",
    value: { "@type": "QuantitativeValue", minValue: 45000, maxValue: 55000, unitText: "YEAR" },
  },
  datePosted: "2026-11-02",
  validThrough: "2026-11-30T23:59:59Z",
  description: "<p>About the role</p><h3>Requirements</h3><ul><li>C++ and Vulkan</li></ul>",
};

test("a page's job posting gives the role's details as plain text", () => {
  const data = postingData(page(POSTING));
  assert.deepEqual(data, {
    title: "Graphics Engineer",
    company: "Example Ltd",
    location: "London, GB",
    salary: "£45,000 to £55,000 a year",
    postedOn: "2026-11-02",
    closesOn: "2026-11-30",
    text: "About the role\n\nRequirements\n\n- C++ and Vulkan",
  });
  // The salary reader understands the wording it is given.
  assert.deepEqual(salaryOf(data?.salary), { minPence: 4_500_000, maxPence: 5_500_000 });
});

test("the posting is found inside a graph, a list or a page's main entity", () => {
  assert.equal(postingData(page({ "@graph": [{ "@type": "WebPage" }, POSTING] }))?.title, "Graphics Engineer");
  assert.equal(postingData(page([{ "@type": "BreadcrumbList" }, POSTING]))?.title, "Graphics Engineer");
  assert.equal(
    postingData(page({ "@type": "WebPage", mainEntity: { ...POSTING, "@type": ["JobPosting"] } }))?.company,
    "Example Ltd",
  );
});

test("a broken block is skipped, and a page with no posting gives nothing", () => {
  assert.equal(postingData(page("{not json", POSTING))?.title, "Graphics Engineer");
  assert.equal(postingData(page({ "@type": "Organization", name: "Example Ltd" })), null);
  assert.equal(postingData("<html><body>No data here</body></html>"), null);
});

test("a remote role says where it may be done from", () => {
  const remote = { ...POSTING, jobLocation: undefined, jobLocationType: "TELECOMMUTE" };
  assert.equal(postingData(page(remote))?.location, "Remote");
  const uk = { ...remote, applicantLocationRequirements: { "@type": "Country", name: "United Kingdom" } };
  assert.equal(postingData(page(uk))?.location, "Remote, United Kingdom");
  const both = { ...POSTING, jobLocationType: "TELECOMMUTE" };
  assert.equal(postingData(page(both))?.location, "London, GB; Remote");
});

test("several places, a plain address and a single figure all read sensibly", () => {
  const data = postingData(
    page({
      ...POSTING,
      jobLocation: [
        { "@type": "Place", address: "Cambridge, UK" },
        {
          "@type": "Place",
          address: { addressLocality: "Bristol", addressRegion: "Bristol", addressCountry: { name: "UK" } },
        },
      ],
      baseSalary: { currency: "GBP", value: { value: 400, unitText: "DAY" } },
    }),
  );
  assert.equal(data?.location, "Cambridge, UK; Bristol, UK");
  assert.equal(data?.salary, "£400 a day");
  assert.deepEqual(salaryOf(data?.salary), { minPence: 9_200_000, maxPence: 9_200_000 });
});

test("another currency keeps its code, so the salary reader never takes it for pounds", () => {
  const data = postingData(
    page({ ...POSTING, baseSalary: { currency: "USD", value: { minValue: 120000, unitText: "YEAR" } } }),
  );
  assert.equal(data?.salary, "USD 120,000 a year");
  assert.equal(salaryOf(data?.salary), null);
});

test("what a page says is text, never markup, and dates that are not dates are dropped", () => {
  const data = postingData(
    page({
      ...POSTING,
      title: "Engineer <img src=x onerror=alert(1)>&amp; Lead",
      hiringOrganization: "Example &lt;b&gt;Ltd&lt;/b&gt;",
      validThrough: "soon",
      datePosted: 20261102,
    }),
  );
  assert.equal(data?.title, "Engineer & Lead");
  assert.equal(data?.company, "Example Ltd");
  assert.equal(data?.closesOn, "");
  assert.equal(data?.postedOn, "");
});

test("a block wrapped in a comment or CDATA still reads", () => {
  const wrapped = `<script type='application/ld+json'>//<![CDATA[\n${JSON.stringify(POSTING)}\n//]]></script>`;
  assert.equal(postingData(`<html><head>${wrapped}</head></html>`)?.company, "Example Ltd");
});

test("a block ends where a browser ends it: at --!> as well as -->, and at a closing tag with junk in it", () => {
  const block = `<script type="application/ld+json"><!--${JSON.stringify(POSTING)}--!></script data-x="1">`;
  assert.equal(postingData(`<html><head>${block}</head></html>`)?.company, "Example Ltd");
});
