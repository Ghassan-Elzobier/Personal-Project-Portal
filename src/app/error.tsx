"use client";

import { useEffect } from "react";
import { sendErrorReport } from "@/lib/errors/browser";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // A digest means the error came from the server, which has reported it already.
    if (!error.digest) sendErrorReport(error, "boundary");
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md space-y-4 text-center" role="alert">
      <h1 className="text-2xl font-bold">This page did not load</h1>
      <p className="subtext">Your tasks are safe. It may be a brief connection problem, so try again.</p>
      <button onClick={reset} className="btn-primary">
        Try again
      </button>
    </div>
  );
}
