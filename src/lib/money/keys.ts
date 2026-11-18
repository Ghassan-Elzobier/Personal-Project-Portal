// The scheduled sync's two secrets, checked without leaking them. Pure, so it is tested.
//
// Vercel Cron calls the sync route with "Authorization: Bearer <CRON_SECRET>". The
// route then proves itself to the database with MONEY_SYNC_KEY, of which the database
// holds only the sha256 (worked out the same way here and in SQL).

import { createHash, timingSafeEqual } from "node:crypto";

/** Whether a request carries the cron secret as Vercel sends it, compared in constant time. */
export function cronAllowed(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const sent = createHash("sha256").update(header).digest();
  const wanted = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(sent, wanted);
}

/** A key's sha256 in hex, as `job_keys` stores it. */
export function keyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
