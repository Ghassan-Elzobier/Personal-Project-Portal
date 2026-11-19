"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// Ticks made in a shop, where the signal is often weak. Each tap is written to the
// phone first, so the list changes at once and survives a reload, then sent to
// the portal one set at a time, in order, so a slow early save can never undo a
// later tap. A set that fails is kept and sent again when the signal comes back.
// Once the page shows the saved set, the phone's copy is cleared.

/** `via`: ticked in the shop or while ordering online, so the list opens that way again. */
export type Ticks = { ticked: string[]; missing: string[]; via?: "store" | "online" };

const EVENT = "portal:ticks";
const RETRY_MS = 10_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: Ticks | null) {
  try {
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode or full storage: the tap still goes to the portal.
  }
  window.dispatchEvent(new Event(EVENT));
}

function parse(raw: string | null): Ticks | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Ticks>;
    const strings = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : null);
    const ticked = strings(v.ticked);
    const missing = strings(v.missing);
    const via = v.via === "store" || v.via === "online" ? { via: v.via } : {};
    return ticked && missing ? { ticked, missing, ...via } : null;
  } catch {
    return null;
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
// A set without `via` (queued before ticks carried it) matches any, so it can't be resent forever.
const same = (a: Ticks, b: Ticks) =>
  sameSet(a.ticked, b.ticked) && sameSet(a.missing, b.missing) && (!a.via || !b.via || a.via === b.via);

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * The ticks to show: the phone's unsent set if there is one, else the saved one.
 * `send` says whether the portal took the set ("sent"), turned it down for good
 * ("refused": the phone's copy is dropped and the saved set shows), or couldn't be
 * reached ("offline": kept and sent again). `waiting` is true while a set is on
 * the phone and not yet on the page.
 */
export function useTicks(
  key: string,
  saved: Ticks,
  send: (value: Ticks) => Promise<"sent" | "refused" | "offline">,
): { ticks: Ticks; set: (next: Ticks) => void; waiting: boolean } {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const pending = parse(raw);
  const sending = useRef(false);
  const savedKey = JSON.stringify([[...saved.ticked].sort(), [...saved.missing].sort(), saved.via ?? null]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (;;) {
        const next = parse(read(key));
        if (!next) return;
        let answer: "sent" | "refused" | "offline";
        try {
          answer = await send(next);
        } catch {
          answer = "offline";
        }
        if (answer === "offline") return;
        if (answer === "refused") {
          write(key, null);
          return;
        }
        const now = parse(read(key));
        // Sent what is waiting; the page clears it once it shows it. A newer tap: send that too.
        if (!now || same(now, next)) return;
      }
    } finally {
      sending.current = false;
    }
  }, [key, send]);

  useEffect(() => {
    const waiting = parse(raw);
    if (!waiting) return;
    const shown = JSON.parse(savedKey) as [string[], string[], Ticks["via"] | null];
    if (same(waiting, { ticked: shown[0], missing: shown[1], via: shown[2] ?? undefined })) {
      write(key, null);
      return;
    }
    void flush();
    const retry = window.setInterval(() => void flush(), RETRY_MS);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener("online", online);
    };
  }, [raw, savedKey, key, flush]);

  return {
    ticks: pending ?? saved,
    set: (next) => write(key, next),
    waiting: pending !== null,
  };
}
