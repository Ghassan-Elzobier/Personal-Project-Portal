"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toaster";
import { startPdfUpload } from "./actions";

// Puts the PDF in the private library bucket, so every page number in the portal
// can open the real book with its figures. The file goes from the browser
// straight to storage, through a link only the owner can make.

const LIMIT = 50 * 1024 * 1024;

export function UploadPdf() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const upload = (file: File) =>
    start(async () => {
      if (file.type !== "application/pdf") return void toast("Choose the book's PDF file.", { tone: "error" });
      if (file.size > LIMIT)
        return void toast("That file is over 50 MB, which is the storage limit.", { tone: "error" });
      setStatus(`Uploading ${(file.size / 1024 / 1024).toFixed(0)} MB…`);
      const target = await startPdfUpload();
      if ("error" in target) {
        setStatus(null);
        return void toast(target.error, { tone: "error" });
      }
      const { createClient } = await import("@supabase/supabase-js");
      const storage = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ).storage;
      const { error } = await storage
        .from("library")
        .uploadToSignedUrl(target.path, target.token, file, { contentType: "application/pdf", upsert: true });
      setStatus(null);
      if (error) return void toast(`The upload failed: ${error.message}`, { tone: "error" });
      toast("The PDF is in. Page numbers now open it.");
      router.refresh();
    });

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="max-w-2xl space-y-1">
        <h2 className="font-semibold">Add the PDF, for the figures</h2>
        <p className="text-sm text-muted">
          Search works without it. With it, every page number here, in Study and in the Lab opens the real book at that
          page. It stays private to you.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        aria-label="Choose the PDF"
      />
      <button
        type="button"
        className="btn-ghost"
        disabled={busy}
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        {status ?? "Choose the PDF"}
      </button>
    </section>
  );
}
