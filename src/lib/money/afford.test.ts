import { test } from "node:test";
import assert from "node:assert/strict";
import { afford, parseBudget, type BudgetData } from "./budget.ts";

// A made-up week: £160 a week to live on, £40 spent so far, rent still to pay, payday in 6 weeks.
const plan = (o: Partial<BudgetData> = {}): BudgetData => ({
  balancePence: 150_000,
  allowancePence: 16_000,
  bufferPence: 0,
  bufferFrom: null,
  paydayRule: "last-working-day",
  firstPayday: "2026-12-31",
  categories: [
    {
      key: "rent",
      name: "Rent",
      kind: "bills",
      budgetPence: 50_000,
      paidMonth: 50_000,
      spentWeek: 0,
      spentLastWeek: 0,
    },
    {
      key: "groceries",
      name: "Groceries",
      kind: "groceries",
      budgetPence: 30_000,
      paidMonth: 0,
      spentWeek: 4_000,
      spentLastWeek: 0,
    },
  ],
  unsortedWeek: 0,
  unsortedLastWeek: 0,
  ...o,
});
const TODAY = "2026-11-18";

test("a £60 repair fits this week's amount, and says what's left after", () => {
  const a = afford(plan(), TODAY, 6_000);
  assert.equal(a.verdict, "fits");
  assert.equal(a.options[0].funding, "allowance");
  assert.match(a.options[0].text, /£60\.00 left this week after/);
  assert.ok(
    a.options.some((o) => o.funding === "spread" && o.weeks === 3 && /£20\.00 a week for 3 weeks/.test(o.text)),
  );
});

test("too big for this week but safe before payday: tight, with spreading and the weeks to payday as the ways", () => {
  const a = afford(plan({ balancePence: 90_000 }), TODAY, 30_000);
  assert.equal(a.verdict, "tight");
  assert.ok(!a.options.some((o) => o.funding === "allowance"));
  assert.ok(a.options.some((o) => o.funding === "safe" && /under your £160\.00 a week/.test(o.text)));
});

test("more than is safe before payday: out of reach, and it says by how much and that the buffer would go", () => {
  const a = afford(plan({ balancePence: 60_000, bufferPence: 5_000 }), TODAY, 20_000);
  assert.equal(a.verdict, "out");
  assert.deepEqual(a.options, []);
  // Safe: £600 less December's £500 rent and the £50 buffer is £50, so £200 is £150 past it.
  assert.match(a.reason, /£150\.00 past what's safe to spend before payday on 2026-12-31, into your buffer/);
});

test("a repair that saves the bus fare pays for itself, and no balance means no answer", () => {
  assert.equal(afford(plan(), TODAY, 6_000, 2_500).paysBackWeeks, 3);
  assert.equal(afford(plan({ balancePence: null }), TODAY, 6_000).verdict, "unknown");
});

test("planned purchases come back from the budget read, and count against what's left", () => {
  const data = parseBudget({
    balance_pence: 150_000,
    settings: { allowance_pence: 16_000, buffer_pence: 0, payday_rule: "last-working-day", first_payday: "2026-12-31" },
    categories: [],
    planned: [
      {
        id: 7,
        name: "Bike repair",
        pence: 6_000,
        due_on: "2026-11-18",
        funding: "spread",
        weeks: 3,
        added_by: "claude",
      },
    ],
  });
  assert.deepEqual(data.planned?.[0], {
    id: 7,
    name: "Bike repair",
    pence: 6_000,
    dueOn: "2026-11-18",
    funding: "spread",
    weeks: 3,
    addedBy: "claude",
  });
  const a = afford(data, TODAY, 15_000);
  assert.ok(!a.options.some((o) => o.funding === "allowance"), "this week has £140 left after the bike's £20 share");
});
