import { NextResponse } from "next/server";
import { origin, protectedResourceMetadata } from "@/lib/connector/oauth";

export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(origin(request)));
}
