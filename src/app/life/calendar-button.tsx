"use client";

import { toast } from "@/components/toaster";
import { syncLifeCalendar } from "./actions";
import { useAction } from "./kit";

/** Puts this week's cooking and gym into Google Calendar, next to study. */
export function CalendarButton({ className = "btn-soft", label = "Add cooking and gym to my calendar" }: { className?: string; label?: string }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending} aria-busy={pending}
      className={className}
      onClick={() =>
        void run(async () => {
          const r = await syncLifeCalendar();
          if ("added" in r) toast(r.added ? `Added ${r.added} to your calendar${r.skipped ? `, ${r.skipped} already there` : ""}.` : "Everything is in your calendar already.");
          return r;
        })
      }
    >
      {pending ? "Adding…" : label}
    </button>
  );
}
