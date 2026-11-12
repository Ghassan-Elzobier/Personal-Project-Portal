"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { timerClock, timerHours } from "@/lib/portal/stats";
import { toast } from "./toaster";
import { startNavigation } from "./navigation-progress";

// A running study session, kept in the browser so it survives reloads and shows
// in every tab. Stopping it opens Log a session with the hours filled in, which
// saves working out from memory how long the session took.

type Running = { gid: string; name: string; startedAt: number };

const KEY = "portal.session";
const EVENT = "portal:session";

function read(): string | null {
  return window.localStorage.getItem(KEY);
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function write(value: Running | null) {
  if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

function parse(raw: string | null): Running | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Running;
    return value.gid && value.name && Number.isFinite(value.startedAt) ? value : null;
  } catch {
    return null;
  }
}

function useRunning(): Running | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return parse(raw);
}

export function StartSessionButton({ gid, name, className = "" }: { gid: string; name: string; className?: string }) {
  const running = useRunning();
  const here = running?.gid === gid;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={here}
      disabled={here}
      onClick={() => {
        if (running) toast(`Switched from ${running.name}. That time was not logged.`);
        write({ gid, name, startedAt: Date.now() });
      }}
    >
      {here ? "Running" : "Start"}
    </button>
  );
}

/** The running session, in the nav. Empty when nothing is running. */
export function SessionPill() {
  const running = useRunning();
  const router = useRouter();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!running) return null;
  const elapsed = now ? now - running.startedAt : 0;
  return (
    <span className="flex items-center gap-2 rounded-full bg-mint/10 py-1 pr-1 pl-3 text-sm ring-1 ring-mint/30">
      <span className="h-2 w-2 rounded-full bg-mint motion-safe:animate-pulse" aria-hidden />
      <span className="max-w-32 truncate" title={running.name}>{running.name}</span>
      <span className="font-semibold tabular-nums">{timerClock(elapsed)}</span>
      <button
        className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20"
        onClick={() => {
          write(null);
          startNavigation();
          router.push(`/log?task=${running.gid}&hours=${timerHours(Date.now() - running.startedAt)}`);
        }}
      >
        Stop and log
      </button>
      <button
        className="cursor-pointer rounded-full px-2 py-1 text-xs text-neutral-400 hover:text-white"
        aria-label="Discard this session"
        title="Discard"
        onClick={() => {
          const saved = running;
          write(null);
          toast("Session discarded.", { action: { label: "Undo", onClick: () => write(saved) } });
        }}
      >
        ✕
      </button>
    </span>
  );
}
