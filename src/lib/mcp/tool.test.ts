import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArgs, err, KEYWORDS, ok, unsupported, withoutNulls, type Json } from "./tool.ts";

// Schemas shaped like the portal's own tools, with made-up values. The real ones
// can't be loaded here (they sit in server-only modules), so the end-to-end suite
// holds every live tool to the same checker (e2e/state-connector.spec.ts).

const PENCE = { type: "integer", minimum: 1, maximum: 100_000_000, description: "Price in pence. A guess is fine." };
const afford: Json = {
  type: "object",
  properties: { pence: PENCE, what: { type: "string", maxLength: 80 } },
  required: ["pence"],
  additionalProperties: false,
};
const schedule: Json = {
  type: "object",
  properties: {
    task: { type: "string", pattern: "^\\d+$", description: "Task gid, from get_today, list_tasks or get_week." },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Day, YYYY-MM-DD. Leave out for today." },
    minutes: { type: "integer", minimum: 15, maximum: 720, description: "Length in minutes, a multiple of 5." },
    kind: { type: "string", enum: ["study", "rest"] },
    done: { type: "boolean" },
    kg: { type: "number", minimum: 20, maximum: 400 },
  },
  required: ["task"],
  additionalProperties: false,
};
const claims: Json = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          statement: { type: "string", minLength: 1, maxLength: 20 },
          confidence: { type: ["integer", "null"], minimum: 0, maximum: 100 },
          pair: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
        },
        required: ["statement"],
        additionalProperties: false,
      },
    },
    budget: { anyOf: [{ type: "integer", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
  },
  additionalProperties: false,
};

test("a missing required value is named, with what it should be and the tool's own words about it", () => {
  assert.equal(checkArgs(afford, {}), "pence is required: a whole number from 1 to 100000000. (Price in pence.)");
  assert.equal(checkArgs(afford, { pence: 1200 }), null);
  assert.equal(checkArgs(afford, { pence: 1200, what: "A made-up kettle" }), null);
});

test("a value of the wrong kind or out of range is refused, and the message says what was sent", () => {
  assert.equal(
    checkArgs(afford, { pence: "1200" }),
    'pence must be a whole number from 1 to 100000000, not the text "1200". (Price in pence.)',
  );
  assert.match(checkArgs(afford, { pence: 12.5 })!, /^pence must be a whole number .*, not 12\.5\./);
  assert.match(checkArgs(afford, { pence: 0 })!, /^pence must be a whole number from 1 to 100000000, not 0\./);
  assert.equal(
    checkArgs(schedule, { task: "12", minutes: 5 }),
    "minutes must be a whole number from 15 to 720, not 5. (Length in minutes, a multiple of 5.)",
  );
  assert.match(checkArgs(schedule, { task: "12", minutes: 721 })!, /^minutes must be/);
  assert.match(checkArgs(schedule, { task: "12", kg: 500 })!, /^kg must be a number from 20 to 400, not 500\./);
  assert.match(checkArgs(schedule, { task: "12", kg: "60" })!, /^kg must be a number .*, not the text "60"\./);
  assert.match(checkArgs(schedule, { task: "12", done: "yes" })!, /^done must be true or false, not the text "yes"\./);
  assert.equal(checkArgs(schedule, { task: "12", minutes: 45, kg: 60.5, done: false, kind: "rest" }), null);
});

test("text is held to its pattern, its length and its allowed values", () => {
  assert.equal(
    checkArgs(schedule, { task: "12", date: "tomorrow" }),
    'date must be text matching ^\\d{4}-\\d{2}-\\d{2}$, not the text "tomorrow". (Day, YYYY-MM-DD.)',
  );
  assert.match(checkArgs(schedule, { task: "twelve" })!, /^task must be text matching \^\\d\+\$/);
  assert.equal(
    checkArgs(schedule, { task: "12", kind: "nap" }),
    'kind must be one of "study", "rest", not the text "nap".',
  );
  assert.match(
    checkArgs(afford, { pence: 5, what: "x".repeat(81) })!,
    /^what must be text up to 80 characters, not the text "x{39}…\./,
  );
  assert.match(
    checkArgs(claims, { claims: [{ statement: "" }] })!,
    /^claims\[0\]\.statement must be text from 1 to 20 characters/,
  );
});

test("a field the tool never named is refused, with the ones it takes", () => {
  assert.equal(
    checkArgs(afford, { pence: 5, colour: "red" }),
    "colour is not something this tool takes. It takes pence, what.",
  );
  assert.equal(
    checkArgs({ type: "object", properties: {}, additionalProperties: false }, { week: 1 }),
    "week is not something this tool takes. It takes nothing.",
  );
  // A tool that doesn't close its fields takes whatever else arrives.
  assert.equal(checkArgs({ type: "object", properties: { a: { type: "string" } } }, { a: "x", b: 1 }), null);
});

test("lists are held to their size and every item to its own schema, by position", () => {
  assert.match(checkArgs(claims, { claims: [] })!, /^claims must be a list from 1 to 3 items, not a list\./);
  assert.match(checkArgs(claims, { claims: [1, 2, 3, 4].map(() => ({ statement: "s" })) })!, /^claims must be a list/);
  assert.equal(
    checkArgs(claims, { claims: [{ statement: "one" }, {}] }),
    "claims[1].statement is required: text from 1 to 20 characters.",
  );
  assert.match(
    checkArgs(claims, { claims: [{ statement: "one", pair: ["a"] }] })!,
    /^claims\[0\]\.pair must be a list of 2 items/,
  );
  assert.match(
    checkArgs(claims, { claims: [{ statement: "one", pair: ["a", 2] }] })!,
    /^claims\[0\]\.pair\[1\] must be text/,
  );
  assert.match(checkArgs(claims, { claims: "one" })!, /^claims must be a list .*, not the text "one"\./);
  assert.match(
    checkArgs(claims, { claims: [{ statement: "one", extra: 1 }] })!,
    /^claims\[0\]\.extra is not something/,
  );
  assert.equal(checkArgs(claims, { claims: [{ statement: "one", pair: ["a", "b"] }] }), null);
});

test("a null is a field left out, unless the tool says null means something", () => {
  // Left out: fine for an optional field, missing for a required one.
  assert.equal(checkArgs(schedule, { task: "12", date: null, minutes: null }), null);
  assert.match(checkArgs(schedule, { task: null })!, /^task is required: text matching/);
  // Meaningful: checked and kept.
  assert.equal(checkArgs(claims, { budget: null, claims: [{ statement: "s", confidence: null }] }), null);
  assert.equal(checkArgs(claims, { budget: 500 }), null);
  assert.equal(checkArgs(claims, { budget: -1 }), "budget must be a whole number from 0 to 1000000, or null, not -1.");
  assert.match(
    checkArgs(claims, { claims: [{ statement: "s", confidence: 101 }] })!,
    /^claims\[0\]\.confidence must be/,
  );

  assert.deepEqual(withoutNulls(schedule, { task: "12", date: null, minutes: 30 }), { task: "12", minutes: 30 });
  assert.deepEqual(withoutNulls(claims, { budget: null, claims: [{ statement: "s", confidence: null, pair: null }] }), {
    budget: null,
    claims: [{ statement: "s", confidence: null }],
  });
});

test("arguments that are not an object of named values are refused outright", () => {
  for (const args of [null, undefined, "pence=5", 5, [1, 2]])
    assert.match(checkArgs(afford, args)!, /^The arguments must be an object of named values/, String(args));
});

test("a schema that uses a keyword or type the checker doesn't know is caught, wherever it sits", () => {
  for (const schema of [afford, schedule, claims]) assert.deepEqual(unsupported(schema), []);
  assert.deepEqual(unsupported({ type: "object", properties: { a: { type: "string", format: "date" } } }), [
    "a: format",
  ]);
  assert.deepEqual(
    unsupported({ type: "object", properties: { a: { type: "array", items: { type: "string", multipleOf: 5 } } } }),
    ["a[]: multipleOf"],
  );
  assert.deepEqual(unsupported({ type: "object", properties: { a: { anyOf: [{ type: "date" }, { const: 1 }] } } }), [
    "a (choice 1): type date",
    "a (choice 2): const",
  ]);
  assert.deepEqual(unsupported({ type: "object", additionalProperties: true }), [
    "the schema: additionalProperties other than false",
  ]);
  assert.ok(KEYWORDS.includes("minItems"));
});

test("ok and err make the two shapes a tool answers with", () => {
  assert.deepEqual(ok({ a: 1 }), { text: '{\n "a": 1\n}' });
  assert.deepEqual(err("No such task."), { text: "No such task.", isError: true });
});
