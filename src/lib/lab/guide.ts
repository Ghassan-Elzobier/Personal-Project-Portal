// The Lab: how the Vulkan renderer works, drawn from its code at one commit. The
// pages under /lab and the connector's explain_renderer tool both read this file,
// so Claude explains the code the way the diagrams draw it.
//
// Three kinds of number appear here, always labelled: measured on the owner's
// Iris Xe laptop, computed by the shader model in pathtracer.ts, or a published
// figure. The PMPP references are section numbers and the PDF's own pages, from
// the outline scripts/load-book.mjs reads. Every explanation is in our words.

export const RENDERER = {
  repo: "https://github.com/Ghassan-Elzobier/Vulkan-Renderer",
  commit: "355324b446aaee4faee8a283d5be413d508f0fe8",
  short: "355324b",
  width: 800,
  height: 600,
} as const;

import { SCENE, explainPixel, randomSequence } from "./pathtracer.ts";

export type CodeRef = readonly [file: "main" | "shader" | "cmake", from: number, to?: number];

const PATHS = { main: "src/main.cpp", shader: "shaders/raytrace.comp", cmake: "CMakeLists.txt" } as const;
const LABELS = { main: "main.cpp", shader: "raytrace.comp", cmake: "CMakeLists.txt" } as const;

export function codeHref([file, from, to]: CodeRef): string {
  return `${RENDERER.repo}/blob/${RENDERER.commit}/${PATHS[file]}#L${from}${to ? `-L${to}` : ""}`;
}

export function codeLabel([file, from, to]: CodeRef): string {
  return `${LABELS[file]}:${from}${to ? `–${to}` : ""}`;
}

export type BookRef = { section: string; title: string; page: number; why: string };
export type Step = { title: string; text: string; code?: CodeRef[] };
export type Check = { q: string; a: string };
export type Source = "measured" | "model" | "published" | "code";
export type Fact = { label: string; value: string; source: Source; note?: string };
export type Finding = { title: string; text: string; kind: "bug" | "check" | "note"; code?: CodeRef[]; evidence?: string };

export type ViewId =
  | "frame" | "objects" | "shader-build" | "memory-binding" | "swapchain" | "timeline" | "sync" | "timing"
  | "invocation" | "camera" | "intersection" | "bounce" | "random" | "accumulation"
  | "dispatch" | "divergence" | "memory";

export type PartId = "start" | "vulkan" | "maths" | "gpu";

/** The four parts of the Lab, in reading order. */
export const PARTS: readonly { id: PartId; title: string; blurb: string }[] = [
  { id: "start", title: "Start here", blurb: "One frame, end to end. Every other view zooms into part of it." },
  { id: "vulkan", title: "Vulkan: the host side", blurb: "What main.cpp builds, how the shader gets onto the GPU, how images reach the screen, and how the frame is ordered and timed." },
  { id: "maths", title: "The ray tracer: the maths", blurb: "What one invocation of raytrace.comp works out, step by step, with your own pixels' numbers." },
  { id: "gpu", title: "On the GPU", blurb: "How 480,000 invocations run on real hardware: the grid, the lanes that wait, and where the bytes go." },
];

export type View = {
  id: ViewId;
  part: PartId;
  title: string;
  /** What the picture shows, in one sentence. Also the figure's caption. */
  claim: string;
  /** Numbered to match the markers in the figure. */
  steps: Step[];
  book: BookRef[];
  /** When PMPP has nothing on it, say so and point elsewhere. */
  bookNote?: string;
  /** Study plan units this view helps with. */
  units: string[];
  checks: Check[];
  facts: Fact[];
  findings?: Finding[];
};

/** What the shader model computes for frame 0 at 800 × 600. pathtracer.test.ts checks these. */
export const MODEL = {
  meanTrips: 1.95,
  meanHits: 0.96,
  escapeFirstTrip: 0.419,
  hitLimit: 0.008,
  inwardMetal: 506,
  inwardFromGold: 466,
  unitTries: 1.91,
  sphereTests: 7.8,
  flopPerPath: 324,
  bytesPerPixel: 36,
  /**
   * Bounce-loop SIMD efficiency by lane time: lanes still in the loop over width ×
   * subgroups still looping, summed over every trip. A GPU counter measures this.
   */
  efficiency: { 8: 0.72, 16: 0.644, 32: 0.583, 64: 0.534 },
  /** The same, trip by trip, as fractions. */
  perTrip: {
    8: [1, 0.993, 0.471, 0.296, 0.246, 0.213, 0.196, 0.186],
    16: [1, 0.991, 0.425, 0.234, 0.178, 0.146, 0.129, 0.118],
    32: [1, 0.988, 0.408, 0.202, 0.137, 0.106, 0.09, 0.079],
    64: [1, 0.982, 0.399, 0.188, 0.113, 0.083, 0.066, 0.056],
  },
} as const;

/** Read off this laptop on 2026-11-11: vulkaninfo, Mesa's shader dump and the validation layer. */
export const IRIS_XE = {
  device: "Intel Iris Xe Graphics (TGL GT2), Mesa 25.2.8",
  subgroup: { reported: 32, min: 8, max: 32, compiled: 16 },
  sharedMemory: "64 KiB",
  maxInvocations: 1024,
  timestampNs: 52.0833,
  queueFamilies: "One: graphics, compute and transfer",
  shader: "SIMD16, 2,197 instructions, no register spills; the bounce loop stays a loop and the 16-try loop is unrolled",
  hazards: "SYNC-HAZARD-WRITE-AFTER-READ on 1,100 of 1,100 frames",
  dispatchMs: { wayland: 2.21, x11: 0.8 },
} as const;

/**
 * The RX 5700 XT's chip (gfx1010), compiled by its Linux driver, RADV in Mesa
 * 25.2.8, on the laptop with RADV_FORCE_FAMILY=navi10, so without the card.
 * The statistics are the driver's own, from VK_KHR_pipeline_executable_properties.
 */
export const RX_5700_XT = {
  device: "AMD Radeon RX 5700 XT (gfx1010, RDNA 1)",
  driver: "RADV, Mesa 25.2.8, compiled without the card",
  subgroup: { reported: 64, min: 32, max: 64, compiled: 64 },
  sharedMemory: "64 KiB",
  maxInvocations: 1024,
  wave64: { vgprs: 44, sgprs: 128, instructions: 1951, branches: 37, perSimd: 22 },
  wave32: { vgprs: 48, sgprs: 128, instructions: 1951, branches: 37, perSimd: 20 },
  shader: "wave64 by default, 44 vector registers a lane, 1,951 instructions, no spills, no shared memory",
  /** Paper figures at reference clocks, from the study plan. */
  peak: { gbs: 448, tflops: 9.75 },
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

const BASE: readonly Omit<View, "part">[] = [
  {
    id: "frame",
    title: "One frame, start to finish",
    claim:
      "Every frame, main.cpp records one command buffer that runs raytrace.comp once per pixel, then copies the result into a swapchain image for the display.",
    steps: [
      { title: "The frame loop", text: "Waits for the last frame, gets a swapchain image, records the commands, submits them and presents. It runs once per frame until you close the window or the benchmark finishes.", code: [["main", 716, 863]] },
      { title: "The command buffer", text: "Recorded fresh every frame: barriers, the pipeline and its images, a push constant, the dispatch, the copy. Nothing runs while it is recorded. It is a list for the GPU.", code: [["main", 744, 835]] },
      { title: "The compute queue", text: "vkQueueSubmit hands the list to the GPU, which starts the commands in order. Barriers decide what has to finish before what.", code: [["main", 851]] },
      { title: "The dispatch", text: "100 × 75 workgroups of 8 × 8 invocations: 480,000 runs of main(), one per pixel. This is the kernel launch.", code: [["main", 785], ["shader", 3]] },
      { title: "accumImage", text: "A 32-bit float RGBA image holding the sum of every sample so far. Each invocation reads its pixel, adds this frame's colour and writes it back.", code: [["main", 678], ["shader", 159, 162]] },
      { title: "storageImage", text: "An 8-bit RGBA image holding this frame's average with a rough gamma: the picture you see.", code: [["main", 677], ["shader", 164, 167]] },
      { title: "The swapchain image", text: "vkCmdCopyImage copies storageImage's bytes into the image the display will show. A copy moves bytes. It never converts formats.", code: [["main", 821, 822]] },
      { title: "The display", text: "vkQueuePresentKHR queues the image. The display shows it once the GPU signals that the copy is done.", code: [["main", 861]] },
    ],
    book: [
      { section: "2.2", title: "CUDA C++ program structure", page: 93, why: "The same shape: host code on the CPU sets up memory and launches a kernel over a grid. main.cpp is the host code and raytrace.comp is the kernel." },
      { section: "2.6", title: "Calling kernel functions", page: 117, why: "A launch names a grid and a block size. vkCmdDispatch names the grid, and local_size in the shader names the block." },
    ],
    units: ["pmpp-2", "r-harness", "r-structure"],
    checks: [
      { q: "How many times does main() in raytrace.comp run per frame at 800 × 600? And at 1000 × 750, as 125% display scaling might give you?", a: "480,000, one per pixel, because 800 and 600 are multiples of 8. At 1000 × 750 the grid is 125 × 94 workgroups, which is 752,000 invocations for 750,000 pixels. The 2,000 extra sit past the bottom edge and leave at line 123." },
      { q: "Which two boxes would disappear if the shader wrote straight into the swapchain image?", a: "storageImage and the copy. That needs a swapchain that allows storage use in a non-sRGB format, which you would check in the surface capabilities. The copy works everywhere, which is why it is the safe first version." },
    ],
    facts: [
      { label: "Resolution", value: "800 × 600", source: "measured", note: "Display scaling can change it. Compare runs at the same size." },
      { label: "Invocations per frame", value: "480,000 in 7,500 workgroups", source: "code" },
    ],
  },
  {
    id: "objects",
    title: "What setup builds",
    claim:
      "Lines 632 to 699 build every object the frame loop uses. Most come from the logical device, and three of them exist only to tell the shader where its two images are.",
    steps: [
      { title: "Instance", text: "Your connection to the Vulkan loader, with the validation layer and debug messenger in Debug builds.", code: [["main", 72, 111], ["main", 649, 654]] },
      { title: "Surface", text: "GLFW's window, wrapped as something Vulkan can present to.", code: [["main", 656, 659]] },
      { title: "Physical device", text: "The first GPU with a compute queue, a present queue and the swapchain extension. On this laptop the list also holds llvmpipe, a CPU driver; the Iris Xe comes first.", code: [["main", 166, 179], ["main", 661, 665]] },
      { title: "Logical device and queue", text: "One queue from the compute family. Everything below is created from this device.", code: [["main", 181, 205], ["main", 668, 673]] },
      { title: "Swapchain", text: "The display's images, which you borrow one at a time. Usage is TRANSFER_DST only, because you copy into them.", code: [["main", 275, 332]] },
      { title: "Two storage images", text: "Each is three objects: the image, its device-local memory, and a view. CUDA does all three with one cudaMalloc.", code: [["main", 400, 459], ["main", 677, 678]] },
      { title: "Descriptor set", text: "The layout says the shader has two storage images at bindings 0 and 1. The set, from a pool, points at the two views. This is how binding = 0 in the shader finds memory.", code: [["main", 461, 544], ["shader", 5, 6]] },
      { title: "Pipeline", text: "The pipeline layout (the descriptor layout plus a 4-byte push constant) and the compiled SPIR-V, together: the kernel, ready to dispatch.", code: [["main", 546, 616], ["main", 685, 688]] },
      { title: "Per-frame tools", text: "A command pool and buffer, a query pool for two timestamps, one imageAvailable semaphore, one renderFinished per swapchain image, and a fence created signalled.", code: [["main", 690, 699]] },
    ],
    book: [
      { section: "2.4", title: "Device global memory and data transfer", page: 100, why: "cudaMalloc and cudaMemcpy. In Vulkan the allocation splits into image, memory and view, and data moves with copy commands." },
      { section: "2.5", title: "Kernel functions and threading", page: 108, why: "Kernel arguments. Yours are a descriptor set for the images and a push constant for frameCount." },
      { section: "4.8", title: "Querying device properties", page: 239, why: "pickPhysicalDevice and vkGetPhysicalDeviceProperties do this, and the limits worth recording are listed in the facts here." },
    ],
    units: ["r-harness", "r-structure", "pmpp-2"],
    checks: [
      { q: "The compute harness milestone has no window. Which of these objects does it keep?", a: "Instance, physical and logical device, queue, memory (buffers instead of images), descriptor set, pipeline, command buffer, query pool and fence. It drops the window, surface, swapchain, both kinds of semaphore and the copy." },
      { q: "Why is the fence created already signalled (line 373)?", a: "The loop waits on it before the first frame (line 718). If it started unsignalled, that first wait would never return." },
    ],
    facts: [
      { label: "Queue families on the Iris Xe", value: IRIS_XE.queueFamilies, source: "measured" },
      { label: "Max invocations per workgroup", value: String(IRIS_XE.maxInvocations), source: "measured" },
      { label: "Shared memory per workgroup", value: `${IRIS_XE.sharedMemory} (this shader uses none)`, source: "measured" },
    ],
    findings: [
      { kind: "check", title: "Queue family choice keeps the last match", text: "findQueueFamilies overwrites its answer for each family that fits, so it keeps the last family with compute and the last with present. The Iris Xe has one family, so nothing changes here. On a GPU with a separate compute-only family you get that one. If compute and present ever land in different families, line 673 asks for a queue from a family the device never created, because line 185 creates queues in one family only.", code: [["main", 157], ["main", 161], ["main", 185], ["main", 673]] },
      { kind: "note", title: "Cleanup runs in reverse", text: "vkDeviceWaitIdle first, so nothing is still in use, then everything is destroyed roughly in the reverse order it was made, with the instance and window last. Objects made from the device go before the device.", code: [["main", 865, 902]] },
      { kind: "note", title: "The first suitable GPU wins", text: "pickPhysicalDevice returns the first device that qualifies, in the driver's order. llvmpipe also qualifies on this laptop. Line 665 prints the name, so check it on the desktop before trusting a benchmark.", code: [["main", 172, 177]] },
    ],
  },
  {
    id: "timeline",
    title: "CPU, GPU and display over time",
    claim:
      "With one command buffer and one fence, the CPU waits for the GPU every frame, so frames never overlap: the CPU records, the GPU traces, and the CPU sleeps until it is done.",
    steps: [
      { title: "Wait for the fence", text: "Blocks until the GPU has finished the previous frame. The CPU spends most of each frame here.", code: [["main", 718]] },
      { title: "Read the timestamps", text: "The previous frame's two timestamps, converted with timestampPeriod. After 100 warm-up frames, 1,000 are averaged.", code: [["main", 719, 740]] },
      { title: "Acquire an image", text: "Returns an image index at once, but the display may still be showing that image. imageAvailable signals when it has let go.", code: [["main", 743]] },
      { title: "Record and submit", text: "The submit waits on imageAvailable, then signals renderFinished for this image and the fence.", code: [["main", 744, 851]] },
      { title: "The GPU works", text: "Barriers, the dispatch (about 2.2 ms on the Iris Xe under Wayland), another barrier, the copy, a last barrier.", code: [["main", 750, 833]] },
      { title: "Present", text: "Queued for the display, which waits on renderFinished. With MAILBOX, a newer frame replaces an older one rather than waiting for the screen.", code: [["main", 853, 861], ["main", 240, 247]] },
    ],
    book: [
      { section: "2.6", title: "Calling kernel functions", page: 117, why: "A kernel launch returns to the host before the kernel finishes. vkQueueSubmit does the same, which is why the fence exists." },
      { section: "4.3", title: "Synchronization and transparent scalability", page: 209, why: "Inside a kernel, __syncthreads orders threads. Between the CPU and the GPU, the fence is the only thing that orders anything here." },
    ],
    units: ["r-baseline", "r-camera"],
    checks: [
      { q: "With two command buffers and two fences (two frames in flight), what could overlap?", a: "The CPU could record frame N+1 while the GPU traces frame N. Here the CPU does almost nothing per frame, so the gain is small. It matters once the CPU does real work, such as moving a camera or rebuilding a BVH." },
      { q: "Why does the timing use timestampPeriod rather than nanoseconds?", a: "A timestamp counts GPU ticks, and tick length depends on the GPU: 52.08 ns on this Iris Xe and 1 ns on llvmpipe. Check the desktop's with vulkaninfo." },
    ],
    facts: [
      { label: "Dispatch, Iris Xe, Wayland", value: `${IRIS_XE.dispatchMs.wayland} ms`, source: "measured", note: "From docs/benchmark.md, Release build." },
      { label: "Dispatch, Iris Xe, X11", value: `about ${IRIS_XE.dispatchMs.x11} ms`, source: "measured", note: "Same build. Only compare runs made the same way." },
      { label: "Timestamp tick", value: `${IRIS_XE.timestampNs} ns`, source: "measured" },
    ],
  },
  {
    id: "sync",
    title: "Barriers, layouts and one hazard",
    claim:
      "Five barriers move three images between layouts. Four are right, but the swapchain image's first transition is not tied to the acquire semaphore, and the validation layer flags it on every frame.",
    steps: [
      { title: "Wait on imageAvailable", text: "Holds back any work at the compute-shader stage until the display has let go of the image. Work at other stages is not held back.", code: [["main", 838]] },
      { title: "storageImage to GENERAL", text: "Last frame's copy read it. This frame's shader writes it. Shader writes must wait for that read.", code: [["main", 760, 768]] },
      { title: "accumImage GENERAL to GENERAL", text: "No layout change. It makes last frame's writes visible to this frame's reads, which the fence alone does not promise.", code: [["main", 770, 778]] },
      { title: "The dispatch", text: "Reads and writes accumImage, writes storageImage.", code: [["main", 785]] },
      { title: "storageImage to TRANSFER_SRC", text: "Shader writes finish before the copy reads.", code: [["main", 788, 796]] },
      { title: "Swapchain image to TRANSFER_DST", text: "Its source stage is TOP_OF_PIPE, so this transition waits for nothing before it, including the semaphore.", code: [["main", 798, 806]] },
      { title: "The copy", text: "storageImage's bytes into the swapchain image.", code: [["main", 821, 822]] },
      { title: "Swapchain image to PRESENT_SRC", text: "Ready for the display. The submit then signals renderFinished, which present waits on.", code: [["main", 824, 833]] },
    ],
    book: [
      { section: "4.3", title: "Synchronization and transparent scalability", page: 209, why: "__syncthreads orders threads inside a block. A pipeline barrier orders commands on a queue, and Vulkan adds two jobs CUDA hides: changing an image's layout and making writes visible." },
      { section: "C.1", title: "Unified device memory address space", page: 1789, why: "CUDA hides most of the memory model that Vulkan makes you state. Read it with this diagram to see what the driver does for you there." },
    ],
    units: ["r-baseline", "r-structure"],
    checks: [
      { q: "Before reading the finding below: which line would you change, and to what?", a: "Line 804. With a source stage of COMPUTE_SHADER, the transition joins the semaphore wait at line 838 and cannot start before the image is free." },
      { q: "Why does the accumImage barrier exist when the layout never changes?", a: "A barrier also makes writes visible. Without it, this frame's imageLoad could read values last frame's imageStore had not made visible, even though the CPU waited on the fence in between." },
      { q: "How would you prove the fix?", a: "Run the same Debug build with VK_KHRONOS_VALIDATION_VALIDATE_SYNC=true. The hazard count should drop from one per frame to zero. Then rerun the Release benchmark to check the dispatch time did not move." },
    ],
    facts: [
      { label: "Hazards found", value: IRIS_XE.hazards, source: "measured", note: "Debug build, Khronos validation layer with synchronization validation, Iris Xe. Run through X11 because VS Code's snap breaks GLFW on Wayland." },
    ],
    findings: [
      {
        kind: "bug",
        title: "The swapchain transition can run before the display lets go",
        text: "The semaphore wait at line 838 only holds back work at the compute-shader stage. The barrier at line 804 has TOP_OF_PIPE as its source stage, so its layout transition is not chained to that wait, and a layout transition writes to the image. Smallest fix: make line 804's source stage VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT. Better fix: wait on imageAvailable at VK_PIPELINE_STAGE_TRANSFER_BIT (line 838) and use TRANSFER as line 804's source stage. The swapchain image is first touched by the copy, so the wait belongs there, and the ray tracing then no longer waits for the display at all.",
        code: [["main", 804], ["main", 838]],
        evidence: "SYNC-HAZARD-WRITE-AFTER-READ: the validation layer saw the barrier's layout transition race the presentation engine's read of the acquired image, on every frame. A copy with the better fix (TRANSFER on lines 804 and 838) ran the same 1,100 frames with no hazards and no other validation errors.",
      },
    ],
  },
  {
    id: "dispatch",
    title: "Pixels to workgroups to subgroups",
    claim:
      "vkCmdDispatch launches a 100 × 75 grid of 8 × 8 workgroups. The GPU runs each workgroup as a few subgroups, whose lanes step through the same instructions together.",
    steps: [
      { title: "The grid", text: "(800 + 7) / 8 = 100 across and (600 + 7) / 8 = 75 down. The + 7 rounds up, so an image that is not a multiple of 8 is still covered.", code: [["main", 785]] },
      { title: "A workgroup", text: "local_size 8 × 8 × 1 is 64 invocations. gl_LocalInvocationID is a position in the tile.", code: [["shader", 3]] },
      { title: "The global index", text: "gl_GlobalInvocationID = gl_WorkGroupID × 8 + gl_LocalInvocationID. In CUDA: blockIdx × blockDim + threadIdx.", code: [["shader", 120]] },
      { title: "The edge check", text: "Invocations past the image return at once.", code: [["shader", 123, 125]] },
      { title: "Subgroups", text: "The 64 invocations fill subgroups in order of gl_LocalInvocationIndex, which is x + 8y. At 16 wide, which is what the Iris Xe compiled, that is four subgroups of two rows each. The RX 5700 XT's Linux driver compiles it at 64, so one subgroup is the whole tile; 32 (four rows) is available if you ask for it.", code: [["shader", 3]] },
      { title: "Lanes", text: "One subgroup is one stream of instructions. Each lane keeps its own registers (seed, ray, colour) and works on one pixel.", code: [["shader", 25], ["shader", 137]] },
    ],
    book: [
      { section: "3.1", title: "Multidimensional grid organization", page: 152, why: "Your 2D grid of 2D workgroups, and how the built-in IDs relate." },
      { section: "3.2", title: "Mapping threads to multidimensional data", page: 158, why: "One thread per pixel, with a bounds check for the edges: exactly lines 120 to 125." },
      { section: "4.2", title: "Thread block scheduling", page: 206, why: "Workgroups are handed to cores in no promised order, which is why no workgroup here depends on another." },
      { section: "4.4", title: "Warps and SIMD hardware", page: 216, why: "How a block becomes warps. A subgroup is a warp, and 2D blocks are linearised the same way: row by row." },
    ],
    units: ["pmpp-3", "pmpp-4", "r-divergence"],
    checks: [
      { q: "Pixel (403, 298): which workgroup, which local ID, and which 16-wide subgroup of that tile?", a: "Workgroup (50, 37), local ID (3, 2), local index 3 + 8 × 2 = 19, so the second subgroup, which holds rows 2 and 3 of the tile." },
      { q: "Why might 8 × 8 beat 64 × 1 for this shader?", a: "Neighbouring pixels tend to hit the same spheres and take the same branches, so subgroups that cover a compact patch diverge less. Try 16 × 4 and 32 × 2 as well, and compare frame time." },
    ],
    facts: [
      { label: "Subgroup size on the Iris Xe", value: `reported ${IRIS_XE.subgroup.reported}, range ${IRIS_XE.subgroup.min} to ${IRIS_XE.subgroup.max}`, source: "measured" },
      { label: "What Mesa compiled", value: `SIMD${IRIS_XE.subgroup.compiled} on the Iris Xe; wave64 for the RX 5700 XT`, source: "measured", note: "The shader uses no subgroup operations, so each driver may choose any width it supports." },
      { label: "Subgroup size on the RX 5700 XT", value: `range ${RX_5700_XT.subgroup.min} to ${RX_5700_XT.subgroup.max}, ${RX_5700_XT.subgroup.reported} by default`, source: "measured", note: RX_5700_XT.driver },
      { label: "Workgroups per frame", value: "7,500", source: "code" },
    ],
    findings: [
      { kind: "note", title: "Measuring will change what you measure", text: "Once the divergence milestone adds subgroupBallot, the shader can see its subgroup size, and the driver may compile at a different width. Fix the width with requiredSubgroupSize (VK_EXT_subgroup_size_control, core in Vulkan 1.3) so the number you record is the one you meant.", code: [["shader", 3]] },
    ],
  },
  {
    id: "invocation",
    title: "Inside one invocation",
    claim:
      "Each invocation traces one path: up to eight trips through a loop that tests all four spheres, keeps the nearest hit and picks a new direction from the material, then adds the result to the running sum.",
    steps: [
      { title: "Which pixel", text: "From the global invocation ID, with the edge check.", code: [["shader", 120, 125]] },
      { title: "A seed", text: "A hash of the pixel index and the frame, so every pixel on every frame gets its own random sequence.", code: [["shader", 127], ["shader", 27, 31]] },
      { title: "The camera ray", text: "A random point inside the pixel (anti-aliasing for free, over frames), mapped to −1..1, corrected for aspect, y flipped. The camera sits at the origin looking down −z.", code: [["shader", 129, 135]] },
      { title: "A trip through the loop", text: "hitScene tests all four spheres, each a quadratic, and keeps the nearest hit further than 0.001.", code: [["shader", 139], ["shader", 93, 117], ["shader", 60, 91]] },
      { title: "A miss", text: "Multiply by the sky colour and leave the loop.", code: [["shader", 142, 145]] },
      { title: "A hit", text: "Multiply by the sphere's colour. Diffuse: the new direction is the normal plus a random unit vector. Metal: the mirror direction plus fuzz times a random unit vector.", code: [["shader", 147, 156]] },
      { title: "A random unit vector", text: "Pick points in the cube until one lands inside the ball, up to 16 tries.", code: [["shader", 42, 53]] },
      { title: "Add to the sum", text: "Read the pixel's running sum, add this sample, write it back. Frame 0 skips the read.", code: [["shader", 158, 162]] },
      { title: "Show the average", text: "Divide by the number of frames, take the square root as a rough gamma, write 8-bit RGBA.", code: [["shader", 164, 167]] },
    ],
    book: [
      { section: "3.3", title: "Image blur – a more complex kernel", page: 169, why: "The same pattern: one thread per output pixel, each doing all the work for its pixel." },
      { section: "A.1", title: "Floating-point data representation", page: 1681, why: "Why line 82 ignores hits closer than 0.001: the hit point carries rounding error, and without the margin a ray can hit the surface it just left." },
    ],
    units: ["pmpp-3", "pmpp-app-a", "r-materials", "r-triangles"],
    checks: [
      { q: "A pixel near the top of the image: how many trips through the loop?", a: `One. The ray misses everything, picks up the sky colour and leaves on the first trip. ${pct(MODEL.escapeFirstTrip)} of pixels do this.` },
      { q: "Why does randomUnitVector take 1.91 tries on average?", a: "A random point in the cube from −1 to 1 lands in the unit ball with probability (4π/3) / 8 = π/6, so it takes 6/π ≈ 1.91 tries. The model gets the same number, which is a good sign it matches the shader." },
      { q: "What would change if paths that hit the limit added black instead?", a: "Places with many inter-reflections, between the mirror sphere and the ground, get slightly darker. The RMSE tool from the reference-images milestone can put a number on it." },
    ],
    facts: [
      { label: "Trips through the loop per path", value: String(MODEL.meanTrips), source: "model" },
      { label: "Paths that leave on the first trip", value: pct(MODEL.escapeFirstTrip), source: "model" },
      { label: "Sphere tests per pixel", value: String(MODEL.sphereTests), source: "model" },
      { label: "Tries per random unit vector", value: `${MODEL.unitTries}, which is 6/π`, source: "model" },
      { label: "Work per path", value: `about ${MODEL.flopPerPath} FLOP`, source: "model", note: "Adds, multiplies, divides and square roots counted from the code, for the model's path mix." },
    ],
    findings: [
      { kind: "check", title: "Paths that never escape keep their colour", text: `A path still bouncing after 8 trips ends with the product of the colours it hit, as if it had seen white light (${(MODEL.hitLimit * 100).toFixed(1)}% of pixels, about 3,800 a frame). It never reached the sky, so physically it should add black. A cap is fine, but the usual choices are to return black or to stop paths at random (Russian roulette).`, code: [["shader", 139], ["shader", 158]] },
      { kind: "check", title: "Rays into a sphere pass through it", text: `hitSphere only tests the nearer root, so a ray that starts inside a sphere never hits it. Fuzzy metal can send a ray into the surface it just hit: ${MODEL.inwardMetal} such bounces a frame in the model, ${MODEL.inwardFromGold} of them on the gold sphere, whose fuzz is 0.3. Those rays go through the sphere. A common fix is to end the path when the new direction points into the surface.`, code: [["shader", 81, 84], ["shader", 153, 154]] },
      { kind: "note", title: "One sum is always 1", text: "a = dot(direction, direction) is 1 every time, because every direction is normalised. The compiler cannot know that, so it is work you could drop.", code: [["shader", 72]] },
    ],
  },
  {
    id: "divergence",
    title: "Divergence: lanes that wait",
    claim: `Lanes in a subgroup share one instruction stream, so the bounce loop runs as long as its slowest lane. Counted by time, ${pct(1 - MODEL.efficiency[16])} of the loop's lanes are waiting at the Iris Xe's 16 wide, and ${pct(1 - MODEL.efficiency[64])} at the RX 5700 XT's 64.`,
    steps: [
      { title: "Pick a pixel", text: "The explorer finds the subgroup holding it: two rows of its 8 × 8 tile at 16 wide." },
      { title: "Read the grid", text: "A column is a lane. A row is a trip through the bounce loop. A filled cell is work, and an empty one is a lane that has finished and waits." },
      { title: "The loop ends last", text: "Each lane leaves when its ray escapes, but the subgroup keeps going until every lane has.", code: [["shader", 139, 145]] },
      { title: "Both branches run", text: "If some lanes hit diffuse and others metal on the same trip, the subgroup runs both branches, each with the other lanes switched off.", code: [["shader", 150, 156]] },
      { title: "The same inside each trip", text: "The 16-try loop in randomUnitVector ends at different times per lane too. The Iris Xe's compiler turned it into nested ifs, so the waiting happens there as well.", code: [["shader", 43, 51]] },
      { title: "SIMD efficiency", text: "Lanes doing work over width × trips. For one subgroup it is the number shown. Over a whole frame, long-running subgroups count for more because they take more time, which is also what a GPU counter measures." },
    ],
    book: [
      { section: "4.4", title: "Warps and SIMD hardware", page: 216, why: "Why the lanes of a warp share instructions in the first place." },
      { section: "4.5", title: "Control divergence", page: 225, why: "Loops whose trip count depends on the data, and the efficiency number used here. Your bounce loop is the textbook case." },
      { section: "10.4", title: "Reducing control divergence", page: 604, why: "Rearranging which threads stay active, so whole warps finish together. Wavefront path tracing does the same with rays." },
      { section: "4.6", title: "Warp scheduling and latency tolerance", page: 231, why: "Waiting lanes cost less when the core has other subgroups to run." },
    ],
    units: ["pmpp-4", "r-divergence", "r-wavefront"],
    checks: [
      { q: "Before clicking: where do you expect the lowest efficiency?", a: "Along silhouettes, where a subgroup straddles a sphere's edge: some lanes hit the sky on trip 1 and others keep bouncing. Also between the mirror sphere and the ground, where paths bounce back and forth." },
      { q: "Why does a wider subgroup lose efficiency here?", a: "A wider subgroup covers more pixels, so it is more likely to hold one long path, and the loop runs to that lane's length. That is why the RX 5700 XT, at 64 wide, wastes more of its loop than the Iris Xe at 16." },
      { q: "Trip 2 is still 99% busy but trip 3 drops to about 42%. Why there?", a: "42% of rays leave on trip 1 and 39% after one hit, but almost every subgroup holds at least one ray still going, so trip 2 runs nearly full. By trip 3 most rays have reached the sky, while their subgroups keep looping for the few that bounce on." },
      { q: "Which milestone attacks this, and how?", a: "Wavefront path tracing. After each bounce, the live rays are compacted into a queue, so subgroups fill up with rays that still have work." },
    ],
    facts: [
      { label: "SIMD efficiency of the bounce loop", value: `${pct(MODEL.efficiency[8])} at 8, ${pct(MODEL.efficiency[16])} at 16, ${pct(MODEL.efficiency[32])} at 32, ${pct(MODEL.efficiency[64])} at 64`, source: "model", note: "Counted by lane time, frame 0, all 480,000 pixels. It barely changes from frame to frame." },
      { label: "Width each GPU compiled", value: `Iris Xe ${IRIS_XE.subgroup.compiled}, RX 5700 XT ${RX_5700_XT.subgroup.compiled} (Linux driver)`, source: "measured" },
    ],
    findings: [
      { kind: "note", title: "This is a model, so measure it", text: "The explorer runs the shader's own logic in your browser, with the same random numbers. The GPU's grouping and float precision can differ in detail, so a single pixel's path may part ways after a few bounces. The chart below puts the model's curve next to whatever you measure with subgroupBallot, which is the divergence milestone." },
    ],
  },
  {
    id: "memory",
    title: "Where the bytes and FLOPs go",
    claim: `The scene lives in the instructions and each path lives in registers. The only memory traffic is ${MODEL.bytesPerPixel} bytes per pixel for the two images, so the kernel does about 9 FLOP per byte.`,
    steps: [
      { title: "Registers", text: `Seed, ray, colour and the hit record, per lane. No spills on either GPU. For the RX 5700 XT the driver uses ${RX_5700_XT.wave64.vgprs} vector registers a lane, low enough that registers do not limit how many subgroups fit (PMPP 4.7).`, code: [["shader", 25], ["shader", 137, 139]] },
      { title: "Instructions", text: "The four spheres are constants in hitScene, compiled into the code. Reading the scene costs no memory traffic at all.", code: [["shader", 93, 117]] },
      { title: "Push constant", text: "frameCount, 4 bytes, recorded into the command buffer.", code: [["shader", 8, 10], ["main", 783]] },
      { title: "accumImage", text: "RGBA32F: 16 bytes read (not on frame 0) and 16 written per pixel.", code: [["shader", 6], ["shader", 160, 162]] },
      { title: "storageImage", text: "RGBA8: 4 bytes written per pixel.", code: [["shader", 5], ["shader", 167]] },
      { title: "The copy", text: "4 bytes read and 4 written per pixel, outside the timed dispatch.", code: [["main", 821, 822]] },
      { title: "Arithmetic intensity", text: `About ${MODEL.flopPerPath} FLOP per path over ${MODEL.bytesPerPixel} bytes: roughly 9 FLOP/B. PMPP calls this the compute to global memory access ratio.` },
    ],
    book: [
      { section: "5.1", title: "Memory bandwidth as a performance limiter", page: 267, why: "The ratio of work to memory traffic, and the roofline that turns it into a speed limit." },
      { section: "5.2", title: "CUDA memory types", page: 275, why: "Registers, shared memory, constant memory and global memory. This shader uses registers, constants and global memory, and no shared memory." },
      { section: "4.7", title: "Resource partitioning and occupancy", page: 235, why: "Registers per lane decide how many subgroups fit on a core at once, which decides how well waiting is hidden." },
      { section: "6.8", title: "A checklist of optimizations", page: 370, why: "The list to judge every later milestone against, starting from these numbers." },
    ],
    units: ["pmpp-5", "r-machine", "r-scene-buffer", "r-bvh-traverse"],
    checks: [
      { q: "With the RX 5700 XT's paper figures, what is the fastest this dispatch could run at 800 × 600?", a: "Memory: 17.3 MB / 448 GB/s ≈ 0.039 ms. Maths: 480,000 × 324 FLOP / 9.75 TFLOP/s ≈ 0.016 ms. The slower bound wins, so about 0.04 ms. Whatever you measure above that is the gap to explain." },
      { q: "What changes in this picture with a BVH?", a: "Every trip reads nodes and triangles from storage buffers. The scene stops being free, and traversal is memory-bound on paper (the plan estimates under 1 FLOP/B), so node layout starts to matter." },
    ],
    facts: [
      { label: "Memory traffic per dispatch", value: "17.3 MB at 800 × 600", source: "code" },
      { label: "Achieved on the Iris Xe, Wayland", value: "7.8 GB/s and 70 GFLOP/s", source: "measured", note: "From the 2.21 ms dispatch and the model's work per path." },
      { label: "Achieved on the Iris Xe, X11", value: "21.6 GB/s and 194 GFLOP/s", source: "measured", note: "From the 0.8 ms dispatch." },
      { label: "RX 5700 XT on paper", value: "448 GB/s, about 9.75 TFLOP/s, ridge near 21.8 FLOP/B", source: "published" },
      { label: "RX 5700 XT registers", value: `${RX_5700_XT.wave64.vgprs} vector registers a lane at wave64 (${RX_5700_XT.wave32.vgprs} at wave32), no spills; the driver estimates ${RX_5700_XT.wave64.perSimd} subgroups fit per SIMD`, source: "measured", note: RX_5700_XT.driver },
    ],
    findings: [
      { kind: "note", title: "Below both roofs", text: "Your recorded results sit well below what either GPU's memory or maths could do; the RX 5700 XT reaches about a quarter of its paper roof. With registers not the limit, the likely causes are divergence (a third to a half of the loop's lane time waits) and long chains of dependent maths (PMPP 4.6). The roofline milestone measures each GPU's real roofs to place these points properly." },
    ],
  },
  {
    id: "accumulation",
    title: "Frames add up",
    claim: "Every frame adds one more sample per pixel to accumImage and shows the average, so the noise falls as 1/√N: four times the frames for half the noise.",
    steps: [
      { title: "Frame 0", text: "No read. The image starts undefined, and the first sample overwrites it.", code: [["shader", 158, 162]] },
      { title: "Frame N", text: "Read the sum, add this frame's sample, write it back.", code: [["shader", 160, 162]] },
      { title: "Average", text: "Divide by N + 1.", code: [["shader", 164]] },
      { title: "Gamma", text: "The square root brightens the dark end, roughly what the display expects.", code: [["shader", 165]] },
      { title: "Never reset", text: "frameCount only grows. The camera milestone has to reset it whenever anything moves.", code: [["main", 862]] },
    ],
    book: [
      { section: "A.3", title: "Precision and special bit patterns in floating-point arithmetic", page: 1692, why: "A 32-bit float keeps about 7 digits. After very many frames, each new sample is small next to the sum and starts to round away." },
    ],
    units: ["r-reference", "r-camera"],
    checks: [
      { q: "How many frames until the noise is a tenth of frame 1's?", a: "100, because noise falls as 1/√N." },
      { q: "Why does frame 0 skip imageLoad?", a: "The accumulation image starts in the UNDEFINED layout, holding whatever was in memory. Adding to it would add garbage." },
    ],
    facts: [{ label: "The plotted pixel", value: "(600, 430), on the ground in front of the gold sphere", source: "model", note: "Luminance of each sample, frames 0 to 255." }],
    findings: [{ kind: "note", title: "The benchmark never sees this", text: "It times one sample per frame. Image quality for the time spent is a separate measure, and the reference-images milestone adds it." }],
  },
];

// The worked examples: real values from the shader model, never typed in.
const fx = (v: number, d = 3) => (Math.abs(v) < 0.0005 && v !== 0 ? v.toExponential(1) : v.toFixed(d));
const vec = (v: readonly number[], d = 3) => `(${v.map((x) => fx(x, d)).join(", ")})`;
const thousands = (n: number) => n.toLocaleString("en-GB");
/** The centre pixel: its ray hits the mirror sphere, then bounces four more times. */
export const CENTRE = explainPixel(400, 300, RENDERER.width, RENDERER.height, 0);
/** A pixel whose ray passes through two spheres, so hitScene must pick the nearer. */
export const TWO_HITS = explainPixel(240, 370, RENDERER.width, RENDERER.height, 0);
const centreHit = CENTRE.trips[0].tests[0];
const redTest = TWO_HITS.trips[0].tests[1];
const groundTest = TWO_HITS.trips[0].tests[3];
const draws = randomSequence(CENTRE.seed, 2);
const frame1 = explainPixel(400, 300, RENDERER.width, RENDERER.height, 1);
const unitCalls = Math.round(0.96 * RENDERER.width * RENDERER.height);
const giveUp = Math.pow(1 - Math.PI / 6, 16);

const ADDED: readonly Omit<View, "part">[] = [
  {
    id: "shader-build",
    title: "From GLSL to GPU code",
    claim: "Your shader is compiled twice: glslc turns the GLSL into SPIR-V when you build, and the driver turns that SPIR-V into the GPU's own instructions when the pipeline is created.",
    steps: [
      { title: "CMake runs glslc", text: "A custom command compiles shaders/raytrace.comp to build/raytrace.comp.spv whenever the shader changes, and the program's target depends on it, so a build always refreshes it.", code: [["cmake", 37, 48]] },
      { title: "SPIR-V on disk", text: "13,568 bytes of 32-bit words. The first word is SPIR-V's magic number, 0x07230203, and the second says version 1.0. It is a portable form that any Vulkan driver can read, the way PTX is for CUDA." },
      { title: "Read the file", text: "readFile loads the bytes. The path is relative, so the program only finds it when started from the project root.", code: [["main", 567, 582], ["main", 686]] },
      { title: "A shader module", text: "vkCreateShaderModule wraps the bytes. Nothing is compiled for the GPU yet.", code: [["main", 584, 597]] },
      { title: "The driver compiles", text: "vkCreateComputePipelines is where the driver turns SPIR-V into machine code for this GPU. Mesa made 2,197 instructions for the Iris Xe, 16 lanes wide, with no register spills. Drivers keep the result in an on-disk cache, so a second run can skip this.", code: [["main", 599, 616], ["main", 687]] },
      { title: "The module goes", text: "Line 688 destroys the shader module straight away. The pipeline keeps its own compiled code.", code: [["main", 688]] },
      { title: "Bound every frame", text: "vkCmdBindPipeline picks this pipeline before each dispatch.", code: [["main", 780]] },
    ],
    book: [{ section: "2.7", title: "Compilation", page: 119, why: "CUDA's compiler splits host and device code and compiles the device part in stages. Your build does the same in two steps: glslc to SPIR-V, then the driver to machine code." }],
    units: ["r-harness", "r-structure"],
    checks: [
      { q: "You edit raytrace.comp and run without rebuilding. Which shader runs?", a: "The old one. The program reads build/raytrace.comp.spv, which only changes when CMake reruns glslc." },
      { q: "Line 688 destroys the shader module. How does the dispatch still work every frame?", a: "The pipeline holds the compiled machine code. The module was only the input to that compile." },
      { q: "Where would you look to see what the GPU actually runs?", a: "At the driver's output, not the SPIR-V: INTEL_DEBUG=cs with Mesa on the Iris Xe, or Radeon GPU Analyzer for the RX 5700 XT." },
    ],
    facts: [
      { label: "build/raytrace.comp.spv", value: "13,568 bytes, SPIR-V 1.0, magic 0x07230203", source: "measured" },
      { label: "Compiled for the Iris Xe", value: IRIS_XE.shader, source: "measured" },
    ],
    findings: [{ kind: "note", title: "Start it from the project root", text: "The shader path is relative (line 686), so launching from any other folder fails to open it. Passing the path in, or looking next to the executable, would remove the trap.", code: [["main", 686]] }],
  },
  {
    id: "memory-binding",
    title: "How the shader finds its images",
    claim: "Each image is three objects, the image, its memory and a view, and the descriptor set is the table that connects binding 0 and binding 1 in the shader to those views. frameCount takes a shorter path, as a push constant.",
    steps: [
      { title: "Create the image", text: "800 × 600, a format, OPTIMAL tiling (the driver's own arrangement, built for the GPU's caches) and usage STORAGE plus TRANSFER_SRC. No memory yet.", code: [["main", 400, 419]] },
      { title: "Ask what memory it needs", text: "The driver answers with a size, an alignment and memoryTypeBits, one bit per memory type it may live in. On the Iris Xe the RGBA8 image needs 2,187,616 bytes, more than 800 × 600 × 4 = 1,920,000, because the tiled layout pads; the RGBA32F image needs 7,812,896. Both allow types 0 to 2.", code: [["main", 421, 422]] },
      { title: "Pick a memory type", text: "findMemoryType takes the first type whose bit is set and that has every property asked for, here DEVICE_LOCAL. On the Iris Xe that is type 0. All seven types sit in one 11.5 GiB heap: ordinary system RAM, shared with the CPU.", code: [["main", 382, 392], ["main", 424]] },
      { title: "Allocate and bind", text: "vkAllocateMemory gets the bytes and vkBindImageMemory ties them to the image.", code: [["main", 426, 435]] },
      { title: "Make a view", text: "How the shader sees the image: 2D, colour, one mip level, one layer.", code: [["main", 437, 451]] },
      { title: "Describe the slots", text: "The descriptor set layout says binding 0 and binding 1 are storage images, used by the compute stage.", code: [["main", 461, 483]] },
      { title: "Fill the slots", text: "A pool with room for two storage-image descriptors in one set. vkUpdateDescriptorSets writes each view, in layout GENERAL, into its binding.", code: [["main", 486, 544]] },
      { title: "Bind and read", text: "vkCmdBindDescriptorSets each frame, and the shader's layout(binding = 0, rgba8) and layout(binding = 1, rgba32f) find the two views. The format named in the shader must match the image's.", code: [["main", 781, 782], ["shader", 5, 6]] },
      { title: "The push constant", text: "frameCount is 4 bytes written straight into the command buffer, with no descriptor at all.", code: [["main", 546, 565], ["main", 783], ["shader", 8, 10]] },
    ],
    book: [
      { section: "2.4", title: "Device global memory and data transfer", page: 100, why: "cudaMalloc gives you a pointer in one call. Vulkan splits it into image, memory and view, and adds a table so the shader can find them." },
      { section: "5.2", title: "CUDA memory types", page: 275, why: "Storage images live in global memory. A push constant does the job of a small constant argument." },
      { section: "C.2", title: "Zero-copy access to host memory", page: 1790, why: "On the Iris Xe, device-local memory is host RAM. On the RX 5700 XT it is VRAM on the far side of PCIe, which is the difference the scene-buffer milestone measures." },
    ],
    units: ["r-scene-buffer", "r-harness", "pmpp-2", "pmpp-app-c"],
    checks: [
      { q: "Why is the RGBA8 image 2,187,616 bytes and not 1,920,000?", a: "OPTIMAL tiling stores the image in GPU-friendly tiles, padded out to whole tiles, so the driver needs more than the raw pixels." },
      { q: "What goes wrong if binding 1 said rgba16f while the image stays R32G32B32A32_SFLOAT?", a: "The shader would read the bytes as a different format. That is invalid: values come back wrong, and the validation layer reports it." },
      { q: "On the RX 5700 XT, where does DEVICE_LOCAL memory live?", a: "In its 8 GB of VRAM, across PCIe from the CPU. On the Iris Xe every type is the same system RAM." },
    ],
    facts: [
      { label: "Memory on the Iris Xe", value: "1 heap of 11.51 GiB (system RAM), 7 memory types", source: "measured" },
      { label: "storageImage, RGBA8", value: "2,187,616 bytes, 64 KiB aligned, types 0 to 2 allowed, type 0 chosen", source: "measured" },
      { label: "accumImage, RGBA32F", value: "7,812,896 bytes, 64 KiB aligned, types 0 to 2 allowed, type 0 chosen", source: "measured" },
    ],
  },
  {
    id: "swapchain",
    title: "The swapchain",
    claim: "The swapchain is a ring of images that the display lends you one at a time: acquire one, copy your frame into it, present it, and the display hands it back later.",
    steps: [
      { title: "Ask the surface", text: "What the window can take: its size limits, image counts, formats and present modes. Through X11 this laptop offers 2 formats; through Wayland, 14.", code: [["main", 207, 228]] },
      { title: "Choose a format", text: "The code wants R8G8B8A8_UNORM in the sRGB colour space, and otherwise takes the first format offered.", code: [["main", 230, 238]] },
      { title: "Choose a present mode", text: "MAILBOX if offered: a newer frame replaces one still waiting, and nothing waits for the screen. Otherwise FIFO: a queue, emptied once per refresh.", code: [["main", 240, 247]] },
      { title: "Choose the size and count", text: "The window's size, and one more image than the minimum: 4 through X11 (minimum 3), 5 through Wayland (minimum 4).", code: [["main", 249, 287]] },
      { title: "Create it", text: "Usage TRANSFER_DST only, because you copy into the images and never draw. Owned by one queue family. Opaque.", code: [["main", 289, 332]] },
      { title: "Acquire", text: "Says which image to use next, and signals imageAvailable once the display has let go of it.", code: [["main", 743]] },
      { title: "Fill and present", text: "Copy into it, move it to PRESENT_SRC, and present it once renderFinished for that image has signalled.", code: [["main", 798, 833], ["main", 853, 861]] },
      { title: "One renderFinished per image", text: "A semaphore can only be signalled again after the wait on it has happened. One per image makes sure a present has used it before it comes round again.", code: [["main", 694, 698]] },
    ],
    book: [],
    bookNote: "PMPP has nothing on this: CUDA has no display. The Vulkan tutorial's swapchain chapter and the Vulkan Guide's WSI pages are the places to read.",
    units: ["r-baseline", "r-structure", "r-reference"],
    checks: [
      { q: "Through X11 your code picks B8G8R8A8_SRGB. What colour is the red sphere on screen, and why?", a: "Blue. The storage image is RGBA and the swapchain image is BGRA, and vkCmdCopyImage copies bytes without converting them, so red lands where blue is read." },
      { q: "With MAILBOX, does the benchmark wait for the screen's refresh?", a: "No. A newer present replaces a waiting one instead of queueing behind it, so presenting never blocks on the refresh. FIFO would." },
      { q: "Why not share one renderFinished semaphore between all the images?", a: "Present waits on it, and it cannot be signalled again until that wait has happened. With several images in flight, the next frame could signal it too early." },
    ],
    facts: [
      { label: "Through X11", value: "B8G8R8A8_SRGB (the fallback), MAILBOX, 4 images", source: "measured", note: "Printed by a copy of the program with one extra line." },
      { label: "Through Wayland", value: "R8G8B8A8_UNORM, MAILBOX, 5 images, 14 formats offered", source: "measured" },
    ],
    findings: [
      {
        kind: "bug",
        title: "Red and blue swap through X11",
        text: "chooseSwapSurfaceFormat wants R8G8B8A8_UNORM. Through X11 this laptop offers only B8G8R8A8_SRGB and B8G8R8A8_UNORM, so the code falls back to the first, B8G8R8A8_SRGB. vkCmdCopyImage copies bytes as they are, so the RGBA storage image lands in a BGRA image with red and blue swapped. Wayland offers R8G8B8A8_UNORM, which is why it can look right. Fix: accept B8G8R8A8_UNORM as the second choice, then either swap the channels in the shader or copy with vkCmdBlitImage, which converts between formats. Avoid the _SRGB formats with a blit: it would encode to sRGB on top of your square root.",
        code: [["main", 230, 238], ["main", 821, 822]],
        evidence: "A copy of the program printed the format it chose: B8G8R8A8_SRGB through X11 and R8G8B8A8_UNORM through Wayland. A copy between them moves bytes unchanged, by the Vulkan spec.",
      },
    ],
  },
  {
    id: "timing",
    title: "Timing the dispatch",
    claim: "Two GPU timestamps bracket the dispatch. Their difference in ticks, times 52.08 ns on the Iris Xe, is the number the benchmark averages over 1,000 frames.",
    steps: [
      { title: "A pool of two queries", text: "Room for two timestamps, made once.", code: [["main", 618, 629], ["main", 692]] },
      { title: "Reset each frame", text: "A query has to be reset before it is written again.", code: [["main", 750]] },
      { title: "Timestamp before", text: "At TOP_OF_PIPE: written when the GPU reaches that point in the command buffer.", code: [["main", 784]] },
      { title: "The dispatch", text: "The work being timed.", code: [["main", 785]] },
      { title: "Timestamp after", text: "At BOTTOM_OF_PIPE: written once everything before it has finished.", code: [["main", 786]] },
      { title: "Read them a frame later", text: "After the fence wait the results are certainly ready, so the loop reads the previous frame's pair.", code: [["main", 718, 722]] },
      { title: "Convert", text: "ms = (t1 − t0) × timestampPeriod ÷ 1,000,000. At 52.0833 ns a tick, 0.812 ms is about 15,600 ticks.", code: [["main", 724], ["main", 664]] },
      { title: "Warm up, then average", text: "Skip 100 frames while clocks rise and one-off costs pass, then keep the mean, minimum and maximum of 1,000.", code: [["main", 705, 737]] },
      { title: "Paths per second", text: "Pixels ÷ mean seconds: 480,000 ÷ 0.000812 s ≈ 591 million paths a second.", code: [["main", 732]] },
    ],
    book: [{ section: "6.9", title: "Optimization strategy", page: 375, why: "The book's method starts from measurement and changes one thing at a time. These two timestamps are your measurement." }],
    units: ["r-baseline", "r-machine"],
    checks: [
      { q: "Is Mpaths/s the same as million rays a second?", a: "No. A path is up to 8 rays, and 1.95 on average in this scene, so rays a second are about twice the path rate." },
      { q: "Does the timed interval include the copy to the swapchain?", a: "No. The second timestamp comes straight after the dispatch, so the copy and present are outside it." },
      { q: "Why skip the first 100 frames?", a: "The GPU raises its clocks under load, and the first frames carry one-off costs. Timing them would mix start-up with steady state." },
    ],
    facts: [
      { label: "Iris Xe, X11, today", value: "0.812 ms, 591 million paths a second", source: "measured" },
      { label: "Iris Xe, Wayland, today", value: "1.39 ms, 344 million paths a second", source: "measured", note: "docs/benchmark.md recorded 2.21 ms on an earlier run, so Wayland's number also varies more." },
      { label: "One tick", value: `${IRIS_XE.timestampNs} ns`, source: "measured" },
    ],
    findings: [
      { kind: "note", title: "The Wayland gap is not the semaphore", text: "The first timestamp is not held back by the acquire semaphore, so one explanation for Wayland's slower numbers was time spent waiting for the display inside the measurement. A copy with the better sync fix, which takes that wait out of the dispatch, timed the same: 0.811 against 0.812 ms through X11, 1.35 against 1.39 ms through Wayland. The gap is real GPU time; look at clocks and at the compositor sharing the GPU next." },
    ],
  },
  {
    id: "camera",
    title: "From pixel to camera ray",
    claim: "Each pixel becomes one ray from the eye at the origin through a random point inside that pixel, on a screen one unit in front, so the image covers a view about 106° wide and 90° tall.",
    steps: [
      { title: "Jitter", text: `Two random numbers pick a point inside the pixel. For pixel (400, 300) on frame 0: ${vec(CENTRE.jitter)}.`, code: [["shader", 129]] },
      { title: "0 to 1 across the image", text: `(pixel + jitter) ÷ size: ${vec(CENTRE.uv01, 4)}.`, code: [["shader", 130]] },
      { title: "−1 to 1", text: `× 2 − 1 puts the centre of the image at 0: ${vec([CENTRE.uv01[0] * 2 - 1, CENTRE.uv01[1] * 2 - 1], 4)}.`, code: [["shader", 131]] },
      { title: "Square pixels", text: `x × 800 ÷ 600, so the image is wider than it is tall without stretching: ${vec(CENTRE.uv, 4)}.`, code: [["shader", 132]] },
      { title: "The direction", text: `(u, −v, −1), made length 1: ${vec(CENTRE.dir, 4)}. y is negated because pixel rows count down while the scene's y points up.`, code: [["shader", 135]] },
      { title: "The camera", text: "The eye sits at (0, 0, 0) looking down −z, and never moves. That is why accumulation can keep adding frames forever.", code: [["shader", 134]] },
    ],
    book: [{ section: "3.2", title: "Mapping threads to multidimensional data", page: 158, why: "Each thread works out its own coordinates from its indices and maps them onto the data. Here the data is a direction into the scene." }],
    units: ["r-camera", "pmpp-3"],
    checks: [
      { q: "How wide is the view, left to right?", a: "At z = −1, x runs from −4/3 to 4/3, so the half-angle is atan(4/3) ≈ 53°: about 106° across, and 90° top to bottom." },
      { q: "What would happen without the jitter?", a: "Every frame would trace the same ray through each pixel's corner, so averaging frames would add nothing: edges would stay jagged and the noise would never fall." },
      { q: "Why is y negated?", a: "Pixel rows count down from the top, but up is +y in the scene. Without the minus sign the picture would be upside down." },
    ],
    facts: [
      { label: "Field of view", value: "about 106° across, 90° high", source: "code" },
      { label: "Pixel (400, 300), frame 0", value: `direction ${vec(CENTRE.dir, 4)}`, source: "model" },
    ],
  },
  {
    id: "intersection",
    title: "Hitting a sphere: the maths",
    claim: "A ray hits a sphere where its distance from the centre equals the radius. Writing that out gives a quadratic in t, and its discriminant says miss, touch or hit.",
    steps: [
      { title: "A point on the ray", text: "p(t) = o + t·d: start at o and go t units along d." },
      { title: "A point on the sphere", text: "Any point p with |p − c|² = r², where c is the centre and r the radius." },
      { title: "Put one in the other", text: "With oc = o − c, |oc + t·d|² = r² expands to (d·d)t² + 2(oc·d)t + (oc·oc − r²) = 0. That is a t² + b t + c = 0.", code: [["shader", 71, 74]] },
      { title: "The discriminant", text: "b² − 4ac below zero: the line misses the sphere. Zero: it just touches. Above zero: it crosses twice.", code: [["shader", 75, 79]] },
      { title: "The nearer root", text: "t = (−b − √(b² − 4ac)) ÷ 2a is where the ray first enters the sphere.", code: [["shader", 81]] },
      { title: "Not too close", text: "A t of 0.001 or less is ignored, so a ray leaving a surface cannot hit that same surface through rounding error.", code: [["shader", 82, 84]] },
      { title: "Point and normal", text: "p = o + t·d, and the normal is (p − c) made length 1, pointing out of the sphere.", code: [["shader", 86, 90]] },
      { title: "The nearest of four", text: `hitScene runs this for every sphere and keeps the smallest t. Pixel (240, 370) crosses the red sphere at t = ${fx(redTest.t!)} and the ground at t = ${fx(groundTest.t!)}; the red sphere wins.`, code: [["shader", 93, 117]] },
    ],
    book: [{ section: "A.1", title: "Floating-point data representation", page: 1681, why: "Why step 6 exists: a hit point carries rounding error, so a ray can find its own surface again at t ≈ 0." }],
    units: ["r-triangles", "pmpp-app-a", "axler-6A"],
    checks: [
      { q: "Why is a always 1 here?", a: "a = d·d, and every direction is normalised, so its length squared is 1. The shader computes it anyway." },
      { q: "A ray starts on the mirror sphere's surface, heading out. What does the test against that same sphere give?", a: `c is about 0, because the start is on the surface, and the roots are about −b and 0, both at or behind the start, so the sphere is ignored. The centre pixel's second trip does exactly this: b = ${fx(CENTRE.trips[1].tests[0].b)}.` },
      { q: "If b² − 4ac is exactly 0, what is t?", a: "−b ÷ 2a: one root, where the ray just grazes the sphere." },
    ],
    facts: [
      { label: "Centre pixel, mirror sphere", value: `a = ${fx(centreHit.a)}, b = ${fx(centreHit.b)}, c = ${fx(centreHit.c)}, b² − 4ac = ${fx(centreHit.disc)}, t = ${fx(centreHit.t!)}`, source: "model" },
      { label: "Centre pixel, the other three", value: CENTRE.trips[0].tests.slice(1).map((t) => `${SCENE[t.sphere].name.toLowerCase()} ${fx(t.disc, 2)}`).join(", ") + ": all below zero, all missed", source: "model" },
    ],
  },
  {
    id: "bounce",
    title: "Bouncing and colour",
    claim: "At each hit the path's colour is multiplied by the sphere's colour and a new direction is chosen, around the normal for matte surfaces and around the mirror direction for metal. What the path brings back is whatever is left when it reaches the sky.",
    steps: [
      { title: "Multiply in the colour", text: "The colour starts white, (1, 1, 1), and each surface keeps only part of it: the ground half of each channel, the red sphere mostly red.", code: [["shader", 137], ["shader", 147]] },
      { title: "Matte: around the normal", text: "New direction = normal + a random unit vector. Directions close to the normal come up most often, which is how a matte surface scatters light (Lambert's cosine law).", code: [["shader", 150, 151]] },
      { title: "Metal: the mirror direction", text: "reflect(d, n) = d − 2(d·n)n: keep the part of d along the surface and flip the part along the normal.", code: [["shader", 152, 153]] },
      { title: "Fuzz", text: "Add fuzz × a random unit vector to the mirror direction: 0.01 on the big mirror sphere, nearly perfect, and 0.3 on the gold one, brushed.", code: [["shader", 153, 154]] },
      { title: "The sky is the light", text: "On a miss, the colour is multiplied by a sky that runs from white at the horizon to light blue overhead, by how far the ray points up. Nothing else in the scene gives off light.", code: [["shader", 55, 58], ["shader", 142, 145]] },
      { title: "What comes back", text: `The centre pixel: mirror, ground, mirror, ground, then sky. Its colour goes from white to ${vec(CENTRE.result.color)}.`, code: [["shader", 158]] },
      { title: "Gamma", text: "The stored value is an amount of light; screens expect gamma-encoded values. The square root brightens the darks, close to the sRGB curve.", code: [["shader", 165]] },
    ],
    book: [],
    bookNote: "PMPP does not cover rendering. Axler 6C explains reflect(): it is an orthogonal decomposition. Ray Tracing in One Weekend covers the same materials.",
    units: ["r-materials", "axler-6C", "r-reference"],
    checks: [
      { q: "A path hits the ground twice and then the sky. At most how bright can it be?", a: "The ground keeps half of each channel, so at most 0.5 × 0.5 = 0.25 of the sky's colour." },
      { q: "reflect() with d = (1, −1, 0)/√2 and n = (0, 1, 0)?", a: "d·n = −1/√2, so r = d − 2(d·n)n = (1, −1, 0)/√2 + (0, 2, 0)/√2 = (1, 1, 0)/√2: the y part flips and the x part stays." },
      { q: "Why does the gold sphere look blurrier than the mirror sphere?", a: "Its fuzz is 0.3 against 0.01, so its reflected rays spread over a much wider cone." },
    ],
    facts: [
      { label: "Centre pixel's path", value: `${CENTRE.trips.length} trips, colour ${vec(CENTRE.result.color)}`, source: "model" },
      { label: "Sky", value: "(1, 1, 1) at the horizon to (0.5, 0.7, 1) straight up", source: "code" },
    ],
  },
  {
    id: "random",
    title: "Random numbers",
    claim: "Every random number comes from hashing: the pixel's index and the frame number make a seed, and each draw hashes the seed again and scales it to between 0 and 1, so every pixel on every frame gets its own repeatable sequence.",
    steps: [
      { title: "The seed", text: `Pixel index (x + y × width) plus frame × 719,393, hashed. Pixel (400, 300) on frame 0: index ${thousands(400 + 300 * 800)}, seed ${thousands(CENTRE.seed)}. Adding 719,393 a frame moves each frame's inputs past all 480,000 pixel indices.`, code: [["shader", 127]] },
      { title: "pcgHash", text: "Multiply and add, a shift that depends on the value itself, then multiply and shift again. A tiny change in the input scatters the output across all 2³² values.", code: [["shader", 27, 31]] },
      { title: "A draw", text: `Hash the seed again, keep that as the new seed, and divide by 2³². The centre pixel's first two draws are ${draws.map((d) => fx(d.value, 4)).join(" and ")}, its jitter.`, code: [["shader", 33, 36]] },
      { title: "In a range", text: "lo + (hi − lo) × r stretches a draw to any range, here −1 to 1.", code: [["shader", 38, 40]] },
      { title: "A random unit vector", text: "Pick points in the cube from −1 to 1 until one lands inside the ball, then make it length 1. The ball fills π/6 ≈ 52% of the cube, so it takes 1.91 tries on average.", code: [["shader", 42, 53]] },
      { title: "One copy per invocation", text: "seed is declared at the top of the shader, but each invocation has its own, so lanes never share a sequence.", code: [["shader", 25]] },
    ],
    book: [],
    bookNote: "PMPP does not cover random numbers. This is the PCG hash, which Jarzynski and Olano (2020), Hash Functions for GPU Rendering, recommend for exactly this job.",
    units: ["r-divergence", "r-reference"],
    checks: [
      { q: "Run the program twice. Are the frames identical?", a: "Yes. The seeds depend only on the pixel and the frame number, so every sequence repeats exactly. That is what makes reference images and RMSE comparisons possible." },
      { q: "Why also reject points with length² ≤ 0.0001?", a: "A point at the very centre has almost no direction, and dividing by its tiny length would blow up." },
      { q: "The loop gives up after 16 tries. How often?", a: `Each try misses with probability 1 − π/6 ≈ 0.48, so all 16 miss with probability about ${giveUp.toExponential(1)}. With about ${thousands(unitCalls)} calls a frame, that is roughly ${Math.round(giveUp * unitCalls)} a frame, each returning straight up, (0, 1, 0).` },
    ],
    facts: [
      { label: "Pixel (400, 300), frame 0", value: `seed ${thousands(CENTRE.seed)}, jitter ${vec(CENTRE.jitter, 4)}`, source: "model" },
      { label: "Same pixel, frame 1", value: `seed ${thousands(frame1.seed)}, jitter ${vec(frame1.jitter, 4)}`, source: "model" },
      { label: "Tries per unit vector", value: "1.91 in the model; 6/π ≈ 1.910 in theory", source: "model" },
    ],
  },
];

const PART_OF: Record<ViewId, PartId> = {
  frame: "start",
  objects: "vulkan", "shader-build": "vulkan", "memory-binding": "vulkan", swapchain: "vulkan", timeline: "vulkan", sync: "vulkan", timing: "vulkan",
  invocation: "maths", camera: "maths", intersection: "maths", bounce: "maths", random: "maths", accumulation: "maths",
  dispatch: "gpu", divergence: "gpu", memory: "gpu",
};

/** Every view, in reading order. */
export const VIEWS: readonly View[] = (Object.keys(PART_OF) as ViewId[]).map((id) => {
  const v = [...BASE, ...ADDED].find((x) => x.id === id);
  if (!v) throw new Error(`No view ${id}`);
  return { ...v, part: PART_OF[id] };
});

/**
 * Every line of the renderer, and the view that explains it. Ranges run end to
 * end with no gaps, which pathtracer.test.ts checks, so nothing goes unexplained.
 */
export const CODE_MAP: readonly { file: CodeRef[0]; from: number; to: number; what: string; views: ViewId[] }[] = [
  { file: "cmake", from: 1, to: 36, what: "Build settings, GLFW and Vulkan", views: ["shader-build"] },
  { file: "cmake", from: 37, to: 48, what: "glslc compiles the shader", views: ["shader-build"] },
  { file: "main", from: 1, to: 29, what: "Headers, the validation switch, extension lists", views: ["objects"] },
  { file: "main", from: 30, to: 71, what: "checkValidationLayerSupport, checkDeviceExtensionSupport", views: ["objects"] },
  { file: "main", from: 72, to: 144, what: "createInstance, debugCallback, setupDebugMessenger", views: ["objects"] },
  { file: "main", from: 145, to: 206, what: "findQueueFamilies, pickPhysicalDevice, createLogicalDevice", views: ["objects"] },
  { file: "main", from: 207, to: 333, what: "Swapchain support, format, present mode, extent, createSwapchain", views: ["swapchain"] },
  { file: "main", from: 334, to: 359, what: "createCommandPool, createCommandBuffer", views: ["objects", "timeline"] },
  { file: "main", from: 360, to: 381, what: "createSemaphore, createFence", views: ["timeline", "sync"] },
  { file: "main", from: 382, to: 460, what: "findMemoryType, createStorageImage", views: ["memory-binding"] },
  { file: "main", from: 461, to: 566, what: "Descriptor set layout, pool, set and writes; pipeline layout", views: ["memory-binding"] },
  { file: "main", from: 567, to: 617, what: "readFile, createShaderModule, createPipeline", views: ["shader-build"] },
  { file: "main", from: 618, to: 631, what: "createQueryPool", views: ["timing"] },
  { file: "main", from: 632, to: 715, what: "main(): build everything", views: ["objects", "frame"] },
  { file: "main", from: 716, to: 751, what: "Frame loop: wait, read timings, acquire, record", views: ["timeline", "timing", "swapchain"] },
  { file: "main", from: 752, to: 779, what: "Barriers before the dispatch", views: ["sync"] },
  { file: "main", from: 780, to: 787, what: "Bind, push frameCount, timestamps, dispatch", views: ["dispatch", "timing", "memory-binding"] },
  { file: "main", from: 788, to: 836, what: "Barriers and the copy to the swapchain", views: ["sync", "swapchain"] },
  { file: "main", from: 837, to: 864, what: "Submit and present", views: ["timeline", "swapchain"] },
  { file: "main", from: 865, to: 909, what: "Cleanup", views: ["objects"] },
  { file: "shader", from: 1, to: 11, what: "Workgroup size, image bindings, push constant", views: ["dispatch", "memory-binding"] },
  { file: "shader", from: 12, to: 24, what: "Materials and the hit record", views: ["bounce"] },
  { file: "shader", from: 25, to: 41, what: "seed, pcgHash, randomFloat, randomFloatRange", views: ["random"] },
  { file: "shader", from: 42, to: 54, what: "randomUnitVector", views: ["random", "bounce"] },
  { file: "shader", from: 55, to: 59, what: "skyColor", views: ["bounce"] },
  { file: "shader", from: 60, to: 118, what: "hitSphere, hitScene", views: ["intersection"] },
  { file: "shader", from: 119, to: 126, what: "Which pixel, and the edge check", views: ["dispatch", "invocation"] },
  { file: "shader", from: 127, to: 128, what: "The seed", views: ["random"] },
  { file: "shader", from: 129, to: 136, what: "The camera ray", views: ["camera"] },
  { file: "shader", from: 137, to: 157, what: "The bounce loop", views: ["invocation", "bounce", "divergence"] },
  { file: "shader", from: 158, to: 167, what: "Accumulate, average, gamma, store", views: ["accumulation", "memory"] },
];

export const CODE_LINES = { main: 909, shader: 167, cmake: 48 } as const;

export function viewById(id: string): View | undefined {
  return VIEWS.find((v) => v.id === id);
}

/** Every finding, with the view it belongs to, worst first. */
export function allFindings() {
  const order = { bug: 0, check: 1, note: 2 } as const;
  return VIEWS.flatMap((v) => (v.findings ?? []).map((f) => ({ ...f, view: v.id, viewTitle: v.title }))).sort((a, b) => order[a.kind] - order[b.kind]);
}

/** The views that help with a study plan unit. */
export function viewsForUnit(ref: string): View[] {
  return VIEWS.filter((v) => v.units.includes(ref));
}

/** A view as plain text, for the Claude connector. */
export function viewForClaude(v: View, base: string) {
  return {
    view: v.id,
    title: v.title,
    claim: v.claim,
    page: `${base}/lab/${v.id}`,
    code_at_commit: RENDERER.short,
    steps: v.steps.map((s, i) => ({ n: i + 1, title: s.title, text: s.text, code: (s.code ?? []).map((c) => ({ where: codeLabel(c), url: codeHref(c) })) })),
    pmpp: v.book.map((b) => ({ section: b.section, title: b.title, page: b.page, why: b.why })),
    facts: v.facts.map((f) => ({ ...f })),
    findings: (v.findings ?? []).map((f) => ({ kind: f.kind, title: f.title, text: f.text, evidence: f.evidence, code: (f.code ?? []).map(codeLabel) })),
    check_yourself: v.checks.map((c) => ({ question: c.q, answer: c.a })),
  };
}
