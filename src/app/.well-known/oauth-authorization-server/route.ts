import { NextResponse } from "next/server";
import { authorizationServerMetadata, origin } from "@/lib/connector/oauth";

export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(origin(request)));
}
