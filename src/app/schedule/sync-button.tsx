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
          const r = await syncStudyCalendar();
          if (r.error) toast(r.error, { tone: "error" });
          else toast(`Synced ${r.synced} study ${r.synced === 1 ? "block" : "blocks"} to Google Calendar${r.failed ? `, ${r.failed} failed` : ""}.`, r.failed ? { tone: "error" } : {});
        })
      }
    >
      {pending ? "Syncing…" : "Sync study to Google"}
    </button>
  );
}
