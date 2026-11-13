"use client";

import { toast } from "@/components/toaster";
import { syncLifeCalendar } from "./actions";
import { useAction } from "./kit";

/**
 * Brings the Google Calendar copy of the Life plan up to date. It updates by
 * itself after every change; this is for when Google was offline at the time.
 */
export function CalendarButton({
  className = "btn-soft",
  label = "Update Google Calendar",
}: {
  className?: string;
  label?: string;
}) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      className={className}
      onClick={() =>
        void run(async () => {
          const r = await syncLifeCalendar();
          if ("written" in r) {
            const changed = r.written + r.removed;
            toast(
              changed
                ? `Google Calendar updated: ${changed} ${changed === 1 ? "change" : "changes"}.${r.partial ? " Press again for the rest." : ""}`
                : "Google Calendar already matches your plan.",
            );
          }
          return r;
        })
      }
    >
      {pending ? "Updating…" : label}
    </button>
  );
}
