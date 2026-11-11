"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "@/components/toaster";
import { efficiencyOf, parseDivergence } from "@/lib/lab/results";
import { recordDivergence } from "./actions";

// Paste the line the instrumented renderer prints, check it, and record it as a
// SIMD efficiency result. The preview shows the curve before anything is saved.

export function RecordDivergence({ gpus, scene, commit }: { gpus: string[]; scene: string; commit: string }) {
  const [text, setText] = useState("");
  const [gpu, setGpu] = useState(gpus[0] ?? "");
  const [sha, setSha] = useState(commit);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const parsed = text.trim() ? parseDivergence(text) : null;
  const preview = parsed?.ok ? efficiencyOf(parsed.value) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await recordDivergence({ line: text, gpu, scene, commit: sha, notes });
      if (r.error) return void toast(r.error, { tone: "error" });
      toast(`Recorded: ${Math.round((r.overall ?? 0) * 100)}% on ${gpu}.`);
      setText("");
      setNotes("");
    });
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <h3 className="font-semibold">Record a measured run</h3>
        <p className="text-sm text-neutral-400">Paste the DIVERGENCE line the renderer prints. It is saved as a SIMD efficiency result, so it also shows under Study, Results.</p>
      </div>
      <label className="block">
        <span className="field-label">The renderer&apos;s line</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="DIVERGENCE subgroup=64 lanes=… subgroups=…" className="field-input font-mono text-xs" />
      </label>
      {parsed && !parsed.ok && <p className="text-sm text-coral">{parsed.error}</p>}
      {preview && (
        <p className="text-sm text-neutral-300 tabular-nums">
          {Math.round(preview.overall * 100)}% over the loop. Per trip: {preview.perTrip.map((x) => `${Math.round(x * 100)}%`).join(", ")}.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">GPU</span>
          <input list="lab-gpus" value={gpu} onChange={(e) => setGpu(e.target.value)} className="field-input" />
          <datalist id="lab-gpus">{gpus.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <label className="block">
          <span className="field-label">Commit</span>
          <input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="7 to 40 characters" className="field-input font-mono" />
        </label>
        <label className="block">
          <span className="field-label">Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 1000 frames, Release" className="field-input" />
        </label>
      </div>
      <button className="btn-primary" disabled={pending || !preview}>{pending ? "Recording…" : "Record it"}</button>
    </form>
  );
}
