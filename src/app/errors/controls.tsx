"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { sendTestError } from "@/lib/errors/browser";
import { toast } from "@/components/toaster";
import { setIgnored, sendServerTestError } from "./actions";

/** Ignore a bug, or restore an ignored one. */
export function IgnoreButton({ fingerprint, ignored }: { fingerprint: string; ignored: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-ghost min-h-11"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const result = await setIgnored(fingerprint, !ignored);
          if (result.error) return toast(result.error, { tone: "error" });
          toast(
            ignored
              ? "Restored. Its GitHub issue reopens on the next triage."
              : "Ignored. Its GitHub issue closes as not planned on the next triage.",
          );
        })
      }
    >
      {ignored ? "Restore" : "Ignore"}
    </button>
  );
}

/** Sends a test error from the server or the browser, to check the whole pipeline. */
export function TestErrorButtons() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const send = (from: "server" | "browser") =>
    start(async () => {
      const stored = from === "server" ? (await sendServerTestError()).stored : await sendTestError();
      if (!stored) {
        return toast("Not stored: errors are only recorded in production.", { tone: "error" });
      }
      toast(`Test error sent from the ${from}. It is in the list, marked Test.`);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-3" aria-busy={pending}>
      <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => send("server")}>
        From the server
      </button>
      <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => send("browser")}>
        From the browser
      </button>
    </div>
  );
}
