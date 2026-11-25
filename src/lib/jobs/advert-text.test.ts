import assert from "node:assert/strict";
import test from "node:test";
import { advertText, withoutTags } from "./extract.ts";

// Advert text never holds a tag: not after one pass of tag stripping, and not after
// decoding a feed that escaped its HTML more often than advertText undoes. Every
// advert here is made up.

/** Whether a browser would read anything in the text as the start of a tag. */
const opensATag = (text: string) => /<[!/?]?[a-z]/i.test(text);

test("a tag that only forms once another is taken out goes too", () => {
  assert.equal(withoutTags("<<b>script>alert(1)<</b>/script>"), "b>script>alert(1)/b>/script>");
  assert.equal(withoutTags("<scr<i>ipt>x"), "script>x");
  assert.equal(opensATag(advertText("<p>Apply <<b>script>alert(1)<</b>/script> now</p>")), false);
});

test("a tag left open at the end is taken out", () => {
  assert.equal(advertText("<p>Example role</p><script"), "Example role\nscript");
  assert.equal(advertText("Example role <iframe src=x"), "Example role iframe src=x");
});

test("a feed escaped more times than advertText undoes still gives no tag", () => {
  // Two levels are undone before the tags go, and decoding undoes the third:
  // this once came out as "Example <script>alert(1)".
  const text = advertText("&lt;i&gt;Example&lt;/i&gt; &amp;lt;b&amp;gt; &amp;amp;lt;script&amp;amp;gt;alert(1)");
  assert.equal(text, "Example alert(1)");
  assert.equal(opensATag(text), false);
});

test("a < that is not a tag is text, escaped or not", () => {
  assert.equal(advertText("<p>Salary &lt;£50k, &lt;5 years, 3 &lt; 4 &gt; 2</p>"), "Salary <£50k, <5 years, 3 < 4 > 2");
  // A browser shows "<£40k>" as text too: only a letter, "/", "!" or "?" after "<" opens a tag.
  assert.equal(advertText("<p>Pay <£40k> a year at Example Ltd</p>"), "Pay <£40k> a year at Example Ltd");
});

test("ordinary adverts read as before", () => {
  assert.equal(
    advertText('<div class="x"><h3>About Example Ltd</h3><p>We build <strong>tools</strong>.</p><!DOCTYPE html></div>'),
    "About Example Ltd\n\nWe build tools.",
  );
});

test("a long run of < or of half-open tags is swept in one go, not once per character", () => {
  // Each takes a few milliseconds; trying the run from every "<" took seconds.
  const started = Date.now();
  assert.equal(advertText(`${"<".repeat(50000)}5`).length, 50001);
  assert.equal(opensATag(withoutTags(`${"<a".repeat(25000)}${">".repeat(25000)}`)), false);
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
});
