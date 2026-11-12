"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Coming back to the portal after a while (the phone was locked, another app was
// open, it is a new day): fetch the page again, so Today is today and a change
// made elsewhere, such as from Claude, shows. A quick look away does nothing.
// router.refresh keeps what is on screen until the new page is in, and keeps
// anything typed.

const AWAY_MS = 5 * 60 * 1000;

export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt: number | null = null;
    let day = new Date().toDateString();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      const now = new Date().toDateString();
      if (away > AWAY_MS || now !== day) {
        day = now;
        router.refresh();
      }
    };
    // Restored from the browser's back-forward cache: what is shown may be old.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onShow);
    };
  }, [router]);
  return null;
}
