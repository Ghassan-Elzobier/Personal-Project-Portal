import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/auth/access";
import { pdfSignedUrl } from "@/lib/library/book";

// Opens the owner's PDF at a page: a signed link to the private bucket, valid
// for an hour, with #page= so the browser's viewer jumps there.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (!access) return NextResponse.redirect(new URL("/login", request.url));
  if (access.role !== "owner") return new NextResponse("Not found", { status: 404 });

  const raw = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "", 10);
  const page = Number.isFinite(raw) && raw > 0 && raw < 100000 ? raw : undefined;
  const url = await pdfSignedUrl(page);
  if (!url) return NextResponse.redirect(new URL("/library", request.url));
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
