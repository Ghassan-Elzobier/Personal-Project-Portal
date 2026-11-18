import { test } from "node:test";
import assert from "node:assert/strict";
import { csvLine, newStatementRows, parseStatement, statementDate, StatementError } from "./statement.ts";

// A made-up statement in the usual CSV layout: account lines, a blank line, the header, rows.
const FILE = [
  '"Account Name:","Example Current ****1234"',
  '"Account Balance:","£1,000.00"',
  '"Available Balance: ","£1,000.00"',
  "",
  '"Date","Transaction type","Description","Paid out","Paid in","Balance"',
  '"03 Nov 2026","Visa purchase","EXAMPLE CAFE","£3.50","","£996.50"',
  '"03 Nov 2026","Visa purchase","EXAMPLE CAFE","£3.50","","£993.00"',
  '"01 Nov 2026","Direct debit","EXAMPLE ENERGY","£45.00","","£1,000.00"',
  '"02 Nov 2026","Bank credit","EXAMPLE LTD, SALARY","","£1,306.00","£2,306.00"',
  '"04 Nov 2026","Standing order","TO SAVINGS","£50.00","","£943.00"',
].join("\r\n");

test("a statement's rows come out in date order, with money out negative and the account lines skipped", () => {
  const s = parseStatement(FILE);
  assert.equal(s.from, "2026-11-01");
  assert.equal(s.to, "2026-11-04");
  assert.deepEqual(
    s.rows.map((r) => [r.booked_on, r.pence, r.method, r.description]),
    [
      ["2026-11-01", -4500, "direct-debit", "EXAMPLE ENERGY"],
      ["2026-11-02", 130600, "transfer", "EXAMPLE LTD, SALARY"],
      ["2026-11-03", -350, "card", "EXAMPLE CAFE"],
      ["2026-11-03", -350, "card", "EXAMPLE CAFE"],
      ["2026-11-04", -5000, "standing-order", "TO SAVINGS"],
    ],
  );
  assert.notEqual(s.rows[2].fingerprint, s.rows[3].fingerprint, "two identical coffees stay two rows");
  assert.ok(!s.rows.some((r) => r.description.includes("1234")), "the account number is not read");
});

test("a mangled pound sign, a byte order mark and other date forms still read", () => {
  const file =
    '﻿"Date","Description","Paid out","Paid in"\n"05/11/2026","EXAMPLE SHOP","�12.00",""\n"2026-11-06","REFUND","","9.99"';
  const s = parseStatement(file);
  assert.deepEqual(
    s.rows.map((r) => [r.booked_on, r.pence]),
    [
      ["2026-11-05", -1200],
      ["2026-11-06", 999],
    ],
  );
  assert.equal(statementDate("7 September 2026"), "2026-09-07");
  assert.equal(statementDate("31 Foo 2026"), null);
  assert.deepEqual(csvLine('"A ""quoted"" word",1,"x,y"'), ['A "quoted" word', "1", "x,y"]);
});

test("a file that isn't a statement says so in words", () => {
  assert.throws(() => parseStatement("name,email\nEx,ex@example.test"), StatementError);
  assert.throws(() => parseStatement('"Date","Description","Paid out","Paid in"\n'), /no payments/);
});

test("only the rows the portal doesn't already hold are added, one for one", () => {
  const rows = parseStatement(FILE).rows;
  const held = [
    { booked_on: "2026-11-03", pence: -350 },
    { booked_on: "2026-11-01", pence: -4500 },
    { booked_on: null, pence: -350 },
  ];
  const { add, skipped } = newStatementRows(rows, held);
  assert.equal(skipped, 2);
  assert.deepEqual(
    add.map((r) => [r.booked_on, r.pence]),
    [
      ["2026-11-02", 130600],
      ["2026-11-03", -350],
      ["2026-11-04", -5000],
    ],
    "one coffee is held, so the second is new; a pending row matches nothing",
  );
});
