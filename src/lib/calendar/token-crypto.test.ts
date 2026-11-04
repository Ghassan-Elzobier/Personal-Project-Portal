import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "./token-crypto.ts";

const key = randomBytes(32).toString("base64");

test("a token round-trips and each seal differs", () => {
  const a = encryptToken("1//refresh-token", key);
  const b = encryptToken("1//refresh-token", key);
  assert.notEqual(a, b);
  assert.equal(decryptToken(a, key), "1//refresh-token");
});

test("a tampered seal or the wrong key is rejected", () => {
  const sealed = encryptToken("1//refresh-token", key);
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptToken(parts.join("."), key));
  assert.throws(() => decryptToken(sealed, randomBytes(32).toString("base64")));
  assert.throws(() => encryptToken("x", "short"));
});
