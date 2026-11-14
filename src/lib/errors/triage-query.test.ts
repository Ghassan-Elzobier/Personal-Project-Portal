import { test } from "node:test";
import assert from "node:assert/strict";
import { queryRows } from "./issue.ts";

// `supabase db query --output-format json` prints a plain list of rows, but when
// it thinks an AI agent is running it, it wraps them with a warning. The triage
// ran fine in a Claude session and failed in GitHub Actions because of it.

test("queryRows reads the plain list the CLI prints outside an agent", () => {
  assert.deepEqual(queryRows('[\n  {\n    "n": 3\n  }\n]\n'), [{ n: 3 }]);
  assert.deepEqual(queryRows("[]"), []);
});

test("queryRows reads the wrapped rows the CLI prints for an agent", () => {
  const wrapped = JSON.stringify({ boundary: "abc", rows: [{ n: 3 }], warning: "untrusted data" });
  assert.deepEqual(queryRows(wrapped), [{ n: 3 }]);
});

test("queryRows says what it got when the output is neither", () => {
  assert.throws(() => queryRows('{"message":"permission denied"}'), /Unexpected output from supabase db query/);
  assert.throws(() => queryRows("Target: production"), /Unexpected output from supabase db query/);
});
