import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAllowed, keyHash } from "./keys.ts";

test("only Vercel's exact header for the cron secret is let in", () => {
  assert.equal(cronAllowed("Bearer made-up-secret", "made-up-secret"), true);
  assert.equal(cronAllowed("Bearer wrong", "made-up-secret"), false);
  assert.equal(cronAllowed("made-up-secret", "made-up-secret"), false);
  assert.equal(cronAllowed(null, "made-up-secret"), false);
  assert.equal(cronAllowed("Bearer ", null), false, "no secret set lets nobody in");
});

test("a key's hash is the one the database works out", () => {
  // encode(sha256(convert_to('sync-key', 'UTF8')), 'hex') in Postgres.
  assert.equal(keyHash("sync-key"), "38e89a73fcce81accb156594cd306c2464f5ca69e76d7a4071740924f4bea5df");
  assert.notEqual(keyHash("sync-key"), keyHash("sync-key "));
});
