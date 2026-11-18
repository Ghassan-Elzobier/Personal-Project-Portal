import { test } from "node:test";
import assert from "node:assert/strict";
import { alertText, type Alert } from "./state.ts";

const alert = (o: Partial<Alert>): Alert => ({ id: 1, kind: "", raisedAt: "", payment: null, detail: {}, ...o });

test("a price rise says the bill, the old and new amount, and that Money counts the new one", () => {
  assert.equal(
    alertText(
      alert({
        kind: "price-rise",
        detail: { name: "Example Streaming", from_pence: 1099, to_pence: 1299, on: "2026-11-08" },
      }),
    ),
    "Example Streaming went up from £10.99 to £12.99 on Sun 8 Nov. Money counts the new amount from now on.",
  );
});

test("a missed bill says what was due and when, and what to do if it's cancelled", () => {
  assert.equal(
    alertText(alert({ kind: "missed-bill", detail: { name: "Example Energy", pence: 7000, due: "2026-11-08" } })),
    "Example Energy: £70.00 was due on Sun 8 Nov and hasn't gone out. If it's cancelled, ignore it under Bills.",
  );
});

test("a watched merchant's payment keeps its wording, and anything else asks for a look", () => {
  assert.equal(
    alertText(alert({ kind: "watched", payment: { madeOn: "2026-11-15", pence: -1850, name: "EXAMPLE TAKEAWAY" } })),
    "EXAMPLE TAKEAWAY: −£18.50 on Sun 15 Nov. A merchant you're watching.",
  );
  assert.equal(alertText(alert({ kind: "low-safe" })), "Something in Money needs a look.");
});
