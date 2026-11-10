"use client";

import { useTransition } from "react";
import { toast } from "@/components/toaster";
import { syncStudyCalendar } from "./actions";

/** Copies every open task's time slot to Google Calendar. Safe to press again: each task keeps one event. */
export function SyncStudyButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost px-4 py-1.5 text-sm"
      disabled={pending}
      title="Copy every planned study block to Google Calendar"
      onClick={() =>
        start(async () => {
          try {
            const r = await syncStudyCalendar();
            if (r.error) return toast(r.error, { tone: "error" });
            const parts = [`${r.synced} written`, `${r.unchanged} already there`];
            if (r.failed) parts.push(`${r.failed} failed (${r.firstError ?? "unknown error"})`);
            const more = r.remaining ? ` ${r.remaining} left: press again to carry on.` : "";
            toast(`Study blocks in Google Calendar: ${parts.join(", ")}.${more}`, r.failed ? { tone: "error" } : {});
          } catch {
            toast("The sync took too long and stopped. Press again: it carries on where it left off.", { tone: "error" });
          }
        })
      }
    >
      {pending ? "Syncing…" : "Sync study to Google"}
    </button>
  );
}
