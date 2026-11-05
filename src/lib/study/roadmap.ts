// One path through all three plans. Each phase puts a stretch of PMPP beside the
// Axler sections and renderer milestones that use it, so that each makes the others
// easier. Every unit sits in exactly one phase, and a phase never comes before what
// its units need. plans.test.ts holds this file to that.
//
// The hours behind the pacing are rough guesses. Your logged hours are the real
// measure, so change them once you know how long things take you.

import { addDays } from "../dates/week.ts";
import { LINKS, type PlanLink } from "./links.ts";
import { findUnit } from "./plans.ts";
import { unitHours } from "./plan-types.ts";

export type Phase = {
  name: string;
  /** Why these go together. */
  why: string;
  /** What is true when the phase is over. */
  exit: string;
  units: string[];
};

export const PHASES: readonly Phase[] = [
  {
    name: "First kernels, first numbers",
    why: "Get one kernel running everywhere, and put a number on the renderer as it is. Axler starts with the vector spaces your first kernel is already adding in.",
    exit: "Vector addition runs on LeetGPU and as a Vulkan shader on both GPUs, and the path tracer has a recorded baseline on each.",
    units: ["pmpp-setup", "pmpp-1", "pmpp-2", "axler-1A", "axler-1B", "axler-1C", "r-baseline", "r-harness"],
  },
  {
    name: "Threads, grids and linear maps",
    why: "Chapter 3 multiplies matrices while Axler 3C explains what that means. Chapter 4 says what divergence costs, and your own shader shows you.",
    exit: "You can rebuild the blur and matrix multiplication from a blank file, prove that a matrix product is the matrix of a composition, and show SIMD efficiency falling bounce by bounce.",
    units: ["pmpp-3", "pmpp-4", "axler-2A", "axler-2B", "axler-2C", "axler-3A", "axler-3B", "axler-3C", "r-structure", "r-reference", "r-divergence"],
  },
  {
    name: "Memory is the limit",
    why: "The book's most important idea, applied to your own hardware. You measure both GPUs, place kernels on their rooflines, then make your scene data decisions with those numbers.",
    exit: "Both GPUs have a measured roofline card, you can give the checklist from memory, and the brute-force triangle number is recorded for the BVH to beat.",
    units: ["pmpp-5", "pmpp-6", "pmpp-app-c", "axler-3D", "axler-3E", "axler-3F", "axler-4", "r-machine", "r-camera", "r-scene-buffer", "r-materials", "r-triangles"],
  },
  {
    name: "Image patterns and eigenvalues",
    why: "Four small patterns, two of them applied straight to your rendered image. A stencil repeats one operator, which is a good first example for the eigenvalues in Axler 5. Then the BVH, where the histogram's bins return as binned SAH.",
    exit: "The renderer denoises and auto-exposes with passes you wrote, and BVH traversal clearly beats brute force on the same mesh.",
    units: ["pmpp-7", "pmpp-8", "pmpp-9", "pmpp-10", "pmpp-app-a", "axler-5A", "axler-5B", "axler-5C", "axler-5D", "axler-5E", "r-denoise", "r-exposure", "r-bvh-cpu", "r-bvh-traverse"],
  },
  {
    name: "Scan, filter, sort",
    why: "The run of chapters the renderer needs most, each building on the last. They end in a radix sort in GLSL and a BVH you can rebuild every frame. Axler's inner products go alongside, for the geometry you are already using.",
    exit: "A million keys sort correctly in a compute shader on both GPUs, and the LBVH's build and traversal times are recorded.",
    units: ["pmpp-11", "pmpp-12", "pmpp-13", "pmpp-14", "pmpp-15", "axler-6A", "axler-6B", "axler-6C", "r-bvh-quality", "r-lbvh-cpu", "r-gpu-sort", "r-lbvh-gpu", "r-hw-rt", "r-wide-bvh"],
  },
  {
    name: "Work that changes shape",
    why: "Sparse matrices and graph traversal teach queues that grow and shrink, which is what a wavefront path tracer runs on. The spectral theorem arrives just as you start reading about splats.",
    exit: "The path tracer runs as wavefront passes and matches the old image, with frame time and SIMD efficiency measured, and a splat scene loads as points.",
    units: ["pmpp-17", "pmpp-18", "pmpp-16", "axler-7A", "axler-7B", "axler-7C", "r-wavefront", "r-gs-paper", "r-gs-load"],
  },
  {
    name: "Splats: scatter, sort, measure",
    why: "Chapter 21 explains why splats are a different kind of problem from ray tracing, and Axler's SVD explains their shape. All three plans land on the same milestone here.",
    exit: "A published scene runs interactively on the RX 5700 XT with a PSNR you can explain, and you have written the one-page note on your renderer using your own numbers.",
    units: ["pmpp-21", "pmpp-22", "axler-7D", "axler-7E", "axler-7F", "r-gs-raster", "r-gs-sort", "r-gs-quality", "r-gs-train", "r-grid"],
  },
  {
    name: "Neural rendering, and finishing the books",
    why: "The open-ended part, time boxed. PMPP's last chapters supply the neural ideas, Axler finishes, and you decide what to build next.",
    exit: "You have trained a tiny NeRF, finished the main path of both books, and written new milestones for the direction you chose.",
    units: ["pmpp-app-b", "pmpp-19", "pmpp-20", "pmpp-23", "pmpp-24", "axler-8A", "axler-8B", "axler-8C", "axler-8D", "axler-9A", "axler-9B", "axler-9C", "axler-9D", "r-nerf-paper", "r-nerf-tiny", "r-neural-direction"],
  },
];

/** The phase a unit belongs to, counted from zero. */
export function phaseOf(ref: string): number {
  return PHASES.findIndex((p) => p.units.includes(ref));
}

/**
 * Each link shows at the phase where its later end arrives, when you have both
 * sides to hand. A link whose later end is far off works as a reminder to look back.
 */
export function linksAt(phase: number): PlanLink[] {
  return LINKS.filter((l) => Math.max(phaseOf(l.a), phaseOf(l.b)) === phase);
}

/**
 * Due dates for everything still to do on the main path. Phases run in order, and
 * inside a phase each plan's units are spread evenly across it, so the three stay
 * side by side rather than running one after the other. Nothing falls due before
 * what it needs.
 */
export function scheduleRoadmap(input: { isDone: (ref: string) => boolean; start: string; hoursPerWeek: number }): { ref: string; dueOn: string }[] {
  const { isDone, start, hoursPerWeek } = input;
  const pace = Math.max(hoursPerWeek, 0.1);
  let hoursSoFar = 0;

  return PHASES.flatMap((phase) => {
    const units = phase.units.flatMap((ref) => {
      const found = findUnit(ref);
      return found && !found.unit.optional && !isDone(ref) ? [{ ref, project: found.plan.project, hours: unitHours(found.unit, found.plan) }] : [];
    });
    const totals = new Map<string, number>();
    for (const u of units) totals.set(u.project, (totals.get(u.project) ?? 0) + u.hours);

    const seen = new Map<string, number>();
    const last = new Map<string, string>();
    const placed = units.map((u) => {
      const before = seen.get(u.project) ?? 0;
      seen.set(u.project, before + u.hours);
      const previous = last.get(u.project);
      last.set(u.project, u.ref);
      return { ...u, previous, at: (before + u.hours / 2) / totals.get(u.project)! };
    });
    const byRef = new Map(placed.map((u) => [u.ref, u]));

    // Spreading evenly can put a unit ahead of something it needs, or of the unit
    // before it in its own plan, so those are pulled forward to go first.
    const ordered = new Set<(typeof placed)[number]>();
    const place = (u: (typeof placed)[number]): void => {
      if (ordered.has(u)) return;
      for (const ref of [...(findUnit(u.ref)?.unit.needs ?? []), ...(u.previous ? [u.previous] : [])]) {
        const first = byRef.get(ref);
        if (first) place(first);
      }
      ordered.add(u);
    };
    [...placed].sort((x, y) => x.at - y.at).forEach(place);

    return [...ordered].map((u) => {
      hoursSoFar += u.hours;
      return { ref: u.ref, dueOn: addDays(start, Math.max(Math.ceil((hoursSoFar * 7) / pace) - 1, 0)) };
    });
  });
}

/** Where each kind of work runs. CUDA needs NVIDIA, and neither of your GPUs is one. */
export const TOOLS: readonly { name: string; runs: string; use: string }[] = [
  { name: "LeetGPU", runs: "CUDA, emulated in the browser", use: "Writing and checking kernels. Its cycle-accurate mode estimates timing, so use it to compare your own attempts." },
  { name: "Colab GPU", runs: "Real CUDA on NVIDIA hardware", use: "Anything LeetGPU cannot run, and training for the neural work." },
  { name: "RX 5700 XT", runs: "Vulkan compute, 8 GB GDDR6, 448 GB/s", use: "Your main benchmark GPU, with Radeon GPU Profiler for what timing cannot show." },
  { name: "Iris Xe", runs: "Vulkan compute, sharing system RAM", use: "The contrast: the same kernel with far less bandwidth and no copy to make. Also what you have away from the desk." },
];

/** What a CUDA kernel becomes when you port it to GLSL. */
export const CUDA_TO_VULKAN: readonly { cuda: string; vulkan: string; note?: string }[] = [
  { cuda: "Launching a grid", vulkan: "vkCmdDispatch(x, y, z)" },
  { cuda: "Thread block", vulkan: "Workgroup", note: "Set with local_size_x, y and z." },
  { cuda: "Warp", vulkan: "Subgroup", note: "Ask for 32 on the RX 5700 XT with a required subgroup size. Check the range on the Iris Xe." },
  { cuda: "threadIdx, blockIdx", vulkan: "gl_LocalInvocationID, gl_WorkGroupID" },
  { cuda: "blockDim, gridDim", vulkan: "gl_WorkGroupSize, gl_NumWorkGroups" },
  { cuda: "Device global memory", vulkan: "Storage buffer in device-local memory" },
  { cuda: "cudaMemcpy", vulkan: "Staging buffer and vkCmdCopyBuffer", note: "On the Iris Xe you can often map memory directly." },
  { cuda: "__shared__", vulkan: "shared", note: "Limited by maxComputeSharedMemorySize, so record it." },
  { cuda: "__constant__", vulkan: "Uniform buffer or push constants" },
  { cuda: "__syncthreads()", vulkan: "memoryBarrierShared(); barrier();" },
  { cuda: "__syncwarp()", vulkan: "subgroupBarrier()" },
  { cuda: "cuda::atomic_ref", vulkan: "atomicAdd and friends", note: "On shared variables or buffer members." },
  { cuda: "__shfl_down_sync", vulkan: "subgroupShuffleDown", note: "Needs GL_KHR_shader_subgroup_shuffle_relative." },
  { cuda: "Warp-wide reduction and scan", vulkan: "subgroupAdd, subgroupMin, subgroupMax, subgroupInclusiveAdd", note: "Built in, so you rarely write the shuffles yourself." },
  { cuda: "Grid-wide barrier (cooperative groups)", vulkan: "None", note: "End the dispatch and add a pipeline barrier." },
  { cuda: "Lookback between blocks", vulkan: "Avoid", note: "Vulkan gives only a limited guarantee that other workgroups make progress." },
  { cuda: "Occupancy, bank conflicts, vector loads", vulkan: "Not under your control", note: "Look at them with Radeon GPU Profiler, and reason about them with the book's method." },
];
