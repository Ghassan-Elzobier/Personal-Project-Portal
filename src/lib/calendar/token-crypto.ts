import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the Google refresh token at rest. The key is 32 random
// bytes, base64-encoded, in GOOGLE_TOKEN_KEY. Output: "v1.<iv>.<tag>.<data>".

function key(raw: string | undefined): Buffer {
  const k = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new Error("GOOGLE_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function encryptToken(plain: string, rawKey: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptToken(sealed: string, rawKey: string | undefined): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised token format.");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
