"use client";

import { useEffect, useRef, useState } from "react";

// One loading bar for every navigation: any internal link, the Work / Life switch,
// or code that calls startNavigation() before router.push. Pages here render on
// the server, so without it a tap on a slow connection looks like nothing
// happened, and a second tap follows. The bar starts on the tap and finishes when
// the address changes, which is when the new page is on screen.
//
// This stands in for a root loading.tsx, on purpose. With a streaming boundary on
// a page, whether from loading.tsx or <Suspense>, about 1 save in 50 right after a
// fresh load left the page showing old data: the router received the fresh page
// and never applied it. Without one, 300 of 300 saves applied. Check this before
// adding a streaming boundary to any page with saves on it.

const EVENT = "portal:navigate";

/** For code that navigates with router.push: show the bar now. */
export function startNavigation() {
  window.dispatchEvent(new Event(EVENT));
}

function isInternalNavigation(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as HTMLElement | null)?.closest?.("a");
  if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  // Same page, or only a #fragment: nothing to load.
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url.href;
}

export function NavigationProgress() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const from = useRef<string>("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    const finish = () => {
      clear();
      setState("done");
      timers.current.push(window.setTimeout(() => setState("idle"), 250));
    };
    const start = () => {
      clear();
      from.current = location.href;
      setState("loading");
      // Watch for the address to change, which happens once the new page is shown.
      const watch = () => {
        if (location.href !== from.current) return finish();
        timers.current.push(window.setTimeout(watch, 50));
      };
      timers.current.push(window.setTimeout(watch, 50));
      // Never leave a bar hanging: a failed load shows the error page anyway.
      timers.current.push(window.setTimeout(finish, 15000));
    };
    const onClick = (e: MouseEvent) => {
      if (isInternalNavigation(e)) start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(EVENT, start);
    window.addEventListener("popstate", finish);
    return () => {
      clear();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(EVENT, start);
      window.removeEventListener("popstate", finish);
    };
  }, []);

  if (state === "idle") return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
      role="progressbar"
      aria-label="Loading the page"
      aria-busy={state === "loading"}
    >
      <div
        className={`h-full bg-gradient-to-r from-aqua to-mint shadow-[0_0_8px_var(--color-aqua)] ${state === "loading" ? "nav-progress" : "w-full opacity-0 transition-opacity duration-200"}`}
      />
    </div>
  );
}
