// Your recorded renderer results, read for the Lab: the latest dispatch time on
// each GPU, and measured divergence to set beside the model. Pure, so it is tested.
//
// A measured divergence run is one "SIMD efficiency" result. Its notes keep the
// raw counts, so the per-trip curve can be drawn again later:
//
//   subgroup=64; lanes=L1,…,L8; subgroups=S1,…,S8
//
// lanes[k] is the lanes still in the bounce loop at the top of trip k, summed
// over every subgroup and frame measured; subgroups[k] is how many subgroups
// were still looping. Efficiency on trip k is lanes[k] / (subgroups[k] × width).

import type { BenchmarkRow } from "../study/benchmarks.ts";
import { MODEL, RX_5700_XT } from "./guide.ts";

export type Divergence = { subgroup: number; lanes: number[]; subgroups: number[] };

/** Trip-by-trip efficiency, and over the whole loop, by lane time. */
export function efficiencyOf(d: Divergence): { perTrip: number[]; overall: number } {
  const perTrip = d.lanes.map((l, k) => (d.subgroups[k] ? l / (d.subgroups[k] * d.subgroup) : 0));
  const slots = d.subgroups.reduce((a, b) => a + b, 0) * d.subgroup;
  return { perTrip, overall: slots ? d.lanes.reduce((a, b) => a + b, 0) / slots : 0 };
}

const numbers = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);

/**
 * Reads the line the instrumented renderer prints, or the same fields in a
 * result's notes. Returns why it cannot, so the form can say what to fix.
 */
export function parseDivergence(text: string): { ok: true; value: Divergence } | { ok: false; error: string } {
  const sub = /subgroup\s*=\s*(\d+)/i.exec(text);
  const lanes = /lanes\s*=\s*([\d,\s]+)/i.exec(text);
  const groups = /subgroups\s*=\s*([\d,\s]+)/i.exec(text);
  if (!sub || !lanes || !groups)
    return { ok: false, error: "Paste the whole line: it needs subgroup=, lanes= and subgroups=." };
  const subgroup = Number(sub[1]);
  if (![4, 8, 16, 32, 64, 128].includes(subgroup))
    return { ok: false, error: "subgroup= should be the subgroup size, such as 16, 32 or 64." };
  const l = numbers(lanes[1]);
  const g = numbers(groups[1]);
  if (!l.length || l.length > 8 || l.length !== g.length)
    return { ok: false, error: "lanes= and subgroups= need the same count of numbers, one per trip, at most 8." };
  if ([...l, ...g].some((n) => !Number.isSafeInteger(n) || n < 0))
    return { ok: false, error: "The counts should be whole numbers, 0 or more." };
  for (let k = 0; k < l.length; k++) {
    if (l[k] > g[k] * subgroup)
      return { ok: false, error: `Trip ${k + 1} has more lanes than ${g[k]} subgroups of ${subgroup} can hold.` };
    if (k > 0 && g[k] > g[k - 1])
      return {
        ok: false,
        error: `More subgroups are looping on trip ${k + 1} than on trip ${k}, which cannot happen.`,
      };
  }
  if (!g[0])
    return { ok: false, error: "No subgroups ran the first trip. Check the counters are read after the frames." };
  return { ok: true, value: { subgroup, lanes: l, subgroups: g } };
}

/** The notes a divergence result is stored with. */
export function divergenceNotes(d: Divergence, extra = ""): string {
  const e = efficiencyOf(d);
  const curve = e.perTrip.map((x) => (x * 100).toFixed(1)).join(", ");
  return [
    `subgroup=${d.subgroup}; lanes=${d.lanes.join(",")}; subgroups=${d.subgroups.join(",")}`,
    `Per trip, % of lanes working: ${curve}.`,
    extra.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
}

/** The two GPUs, whatever name a result used for them. */
export function gpuKey(name: string): "iris" | "rx" | null {
  const n = name.toLowerCase();
  if (n.includes("5700")) return "rx";
  if (n.includes("iris")) return "iris";
  return null;
}

export type GpuResult = {
  gpu: "iris" | "rx";
  name: string;
  /** Latest dispatch time recorded for this renderer's scene, in ms. */
  dispatch: { ms: number; commit: string | null; date: string; scene: string } | null;
  /** Latest measured divergence, if any. */
  divergence: (Divergence & { overall: number; perTrip: number[]; commit: string | null; date: string }) | null;
};

/** Frame-time results on the original scene, latest per GPU, plus measured divergence. */
export function latestResults(rows: BenchmarkRow[]): Record<"iris" | "rx", GpuResult> {
  const out: Record<"iris" | "rx", GpuResult> = {
    iris: { gpu: "iris", name: "Iris Xe", dispatch: null, divergence: null },
    rx: { gpu: "rx", name: "RX 5700 XT", dispatch: null, divergence: null },
  };
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of ordered) {
    const key = gpuKey(r.gpu);
    if (!key) continue;
    out[key].name = r.gpu;
    const value = Number(r.value);
    if (r.metric === "Frame time" && r.unit === "ms" && Number.isFinite(value) && /800\s*[x×]\s*600/.test(r.scene)) {
      out[key].dispatch = { ms: value, commit: r.commit_sha, date: r.created_at.slice(0, 10), scene: r.scene };
    }
    if (r.metric === "SIMD efficiency") {
      const parsed = parseDivergence(r.notes);
      if (parsed.ok)
        out[key].divergence = {
          ...parsed.value,
          ...efficiencyOf(parsed.value),
          commit: r.commit_sha,
          date: r.created_at.slice(0, 10),
        };
    }
  }
  return out;
}

/** Achieved rates from a dispatch time, using the model's work and traffic per pixel. */
export function achieved(ms: number, pixels = 800 * 600) {
  const seconds = ms / 1000;
  const gflops = (pixels * MODEL.flopPerPath) / seconds / 1e9;
  const gbs = (pixels * MODEL.bytesPerPixel) / seconds / 1e9;
  const intensity = MODEL.flopPerPath / MODEL.bytesPerPixel;
  const roof = Math.min(RX_5700_XT.peak.tflops * 1000, RX_5700_XT.peak.gbs * intensity);
  return { gflops, gbs, mpaths: pixels / seconds / 1e6, intensity, ofRxRoof: gflops / roof };
}
