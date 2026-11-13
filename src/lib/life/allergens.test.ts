import { test } from "node:test";
import assert from "node:assert/strict";
import { expandGroups, judge, labelChecks, parseRules, type FoodRules } from "./allergens.ts";

const rules: FoodRules = {
  rules: [
    { tag: "egg", level: "avoid", allowForms: ["baked", "batter"] },
    { tag: "soy", level: "avoid" },
    { tag: "sesame", level: "flag", note: "fine in small amounts" },
  ],
  mayContainOk: [],
  dislikes: [],
  avoidTraits: [],
};

test("egg baked into a cake is allowed, egg as itself is not", () => {
  assert.equal(judge(rules, "egg", "baked", "eggs")?.verdict, "allowed");
  assert.equal(judge(rules, "egg", "batter", "eggs")?.verdict, "allowed");
  assert.equal(judge(rules, "egg", "cooked", "eggs")?.verdict, "blocked");
  assert.equal(judge(rules, "egg", "raw", "eggs")?.verdict, "blocked");
});

test("a flag rule serves the food and says so", () => {
  const f = judge(rules, "sesame", "cooked", "tahini");
  assert.equal(f?.verdict, "flagged");
  assert.match(f!.why, /small amounts/);
});

test("foods with no rule are not mentioned", () => {
  assert.equal(judge(rules, "milk", "cooked", "milk"), null);
});

test("label checks skip forms the rules allow", () => {
  assert.deepEqual(labelChecks(rules, ["egg:baked", "soy"]), ["soy"]);
  assert.deepEqual(labelChecks(rules, ["egg:pasta"]), ["egg"]);
  assert.deepEqual(labelChecks(rules, ["milk"]), []);
});

test("legumes expand to every legume, peanut included", () => {
  const tags = expandGroups(["legumes"]);
  for (const t of ["peanut", "soy", "pea", "chickpea", "lentil", "bean", "fenugreek", "tamarind"])
    assert.ok(tags.includes(t as never), t);
});

test("parsing drops unknown tags, forms and duplicates", () => {
  const parsed = parseRules({
    rules: [
      { tag: "egg", level: "avoid", allowForms: ["baked", "fried"] },
      { tag: "egg", level: "flag" },
      { tag: "unicorn", level: "avoid" },
      { tag: "soy", level: "sometimes" },
    ],
    mayContainOk: ["egg", "nope"],
    avoidTraits: ["strong", "loud"],
  });
  assert.deepEqual(parsed.rules, [{ tag: "egg", level: "avoid", allowForms: ["baked"], note: undefined }]);
  assert.deepEqual(parsed.mayContainOk, ["egg"]);
  assert.deepEqual(parsed.avoidTraits, ["strong"]);
  assert.deepEqual(parseRules(null).rules, []);
});
