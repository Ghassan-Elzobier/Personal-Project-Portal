import { NextResponse } from "next/server";
import { cronSecret, moneySyncKey } from "@/lib/config/env";
import { cronAllowed } from "@/lib/money/keys";
import { syncBank } from "@/lib/money/sync";

// Where Vercel Cron starts the bank sync, four times a day (vercel.json). It has no
// browser session, so it proves itself twice: Vercel sends CRON_SECRET, and the
// database checks MONEY_SYNC_KEY against the hash the owner registered on the Money
// page. The answer says only how the run went, as a code.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAllowed(request.headers.get("authorization"), cronSecret())) {
    return new NextResponse(null, { status: 401 });
  }
  const key = moneySyncKey();
  if (!key) return NextResponse.json({ ran: false, code: "NO_SYNC_KEY" }, { status: 503 });
  const result = await syncBank("schedule", key);
  return NextResponse.json(result.ran ? { ran: true, outcome: result.outcome } : { ran: false });
}
