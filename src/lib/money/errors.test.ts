import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubText } from "../errors/report.ts";
import { BankError } from "./map.ts";

// Production errors become public GitHub issues, so a money error is a code and
// nothing else, and it reads the same after the tracker's scrubber.

const CODES = ["NO_KEY", "HTTP_401", "HTTP_429", "HTTP_503", "TIMEOUT", "NETWORK", "BAD_JSON", "BAD_BALANCE", "AMOUNT"];

test("a money error is a code, and the error tracker keeps it as it is", () => {
  for (const code of CODES) {
    const message = new BankError(code).message;
    assert.match(message, /^BANK_SYNC:[A-Z0-9_]+$/);
    assert.equal(scrubText(message), message);
  }
});

test("if an account number ever reached a message, the tracker would take it out", () => {
  const scrubbed = scrubText("Lunch Flow said account 55551234 at sort code 202015 was 'Example Holder'");
  assert.ok(!scrubbed.includes("55551234"), scrubbed);
  assert.ok(!scrubbed.includes("Example Holder"), scrubbed);
});
