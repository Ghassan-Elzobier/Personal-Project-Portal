"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/access";
import { divergenceNotes, efficiencyOf, parseDivergence } from "@/lib/lab/results";
import * as ops from "@/lib/portal/operations";

/** Records a measured divergence run as one SIMD efficiency result, with its counts in the notes. */
export async function recordDivergence(input: { line: string; gpu: string; scene: string; commit: string; notes: string }): Promise<{ error?: string; overall?: number }> {
  await requireOwner();
  const parsed = parseDivergence(input.line);
  if (!parsed.ok) return { error: parsed.error };
  if (!input.gpu.trim()) return { error: "Say which GPU this was measured on." };
  const { overall } = efficiencyOf(parsed.value);
  const result = await ops.addBenchmark({
    project: "rendering",
    metric: "SIMD efficiency",
    value: Math.round(overall * 1000) / 10,
    unit: "%",
    scene: input.scene,
    gpu: input.gpu.trim(),
    commit: input.commit,
    notes: divergenceNotes(parsed.value, input.notes),
  });
  if (result.error) return { error: result.error };
  revalidatePath("/lab", "layout");
  return { overall };
}
