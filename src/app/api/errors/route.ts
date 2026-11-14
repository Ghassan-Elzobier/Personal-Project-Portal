import { NextResponse } from "next/server";
import { buildReport, isNoise, readBrowserReport } from "@/lib/errors/report";
import { saveReport } from "@/lib/errors/store";

// Where the browser reports its errors (src/lib/errors/browser.ts). Signed-in
// members only: the proxy sends anyone else to /login, and report_error checks
// access again. 204 means stored; 202 means accepted but not kept (noise, not
// production, or no access), which the browser treats the same.

const MAX_BYTES = 16_384;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const sent = readBrowserReport(body);
  if (!sent) return new NextResponse(null, { status: 400 });
  if (isNoise(sent)) return new NextResponse(null, { status: 202 });

  const report = buildReport({
    source: "browser",
    name: sent.name,
    message: sent.message,
    stack: sent.stack,
    route: sent.path,
    context: sent.context,
    release: sent.release || process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const stored = await saveReport(report);
  return new NextResponse(null, { status: stored ? 204 : 202 });
}
