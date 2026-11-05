"use client";

import { useLinkStatus } from "next/link";

// Put inside a Link: a slim bar across the top of the window while its page loads.
//
// This stands in for a root loading.tsx, on purpose. With a streaming boundary on
// a page, whether from loading.tsx or <Suspense>, about 1 save in 50 right after a
// fresh load left the page showing old data: the router received the fresh page
// and never applied it. Without one, 300 of 300 saves applied. Check this before
// adding a streaming boundary to any page with saves on it.
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="fixed inset-x-0 top-0 z-50 h-0.5 bg-aqua motion-safe:animate-pulse" aria-hidden />;
}
