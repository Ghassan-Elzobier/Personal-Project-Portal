// Programming Massively Parallel Processors, 5th edition, by Hwu, Kirk and El Hajj.
// Chapter order, section numbers, exercise counts and pages were read from the book.
// Pages are the PDF's own: the file is an ebook conversion, so they are not the print
// edition's. Notes and review prompts are in our own words, so none of the book's
// text is in this repo.
//
// The book never mentions ray tracing, BVHs, splats or Vulkan. Every link to the
// renderer, here and in links.ts, is our own reading rather than the authors'.
//
// Part 3 is not in chapter order. Its chapters are separate case studies, and the
// renderer needs 21 and 22 before the neural work that 19 leads to. Only the batching
// example in 22.5 leans on Chapter 20, and it stands on its own.

import type { PlanReview, PlanUnit, StudyPlan } from "./plan-types.ts";

const READ_STEPS = ["Read with a question in mind", "Explain the main idea out loud, without notes"];

type ChapterInput = {
  page: number;
  hours: number;
  notes: string;
  steps: string[];
  reviews: string[];
  exercises?: number;
  needs?: string[];
  optional?: boolean;
  milestone?: boolean;
  links?: { label: string; url: string }[];
};

/**
 * A GPU MODE lecture, found by searching the channel. YouTube titles differ from the
 * lecture repository's, so a search on the lecture's own words is steadier than a
 * video id.
 */
function gpuMode(n: number, title: string, query = title): { label: string; url: string } {
  return { label: `GPU MODE lecture ${n}: ${title}`, url: `https://www.youtube.com/@GPUMODE/search?query=${encodeURIComponent(`Lecture ${n} ${query}`)}` };
}

function chapter(n: number, title: string, input: ChapterInput): PlanUnit {
  const { reviews, ...rest } = input;
  return {
    ref: `pmpp-${n}`,
    name: `Ch ${n} ${title}`,
    short: `PMPP ${n}`,
    ...rest,
    reviews: reviews.map((prompt): PlanReview => ({ kind: "idea", prompt: `PMPP ${n}: ${prompt}` })),
  };
}

export const PMPP: StudyPlan = {
  project: "pmpp",
  mode: "book",
  title: "Programming Massively Parallel Processors",
  subtitle: "Hwu, Kirk and El Hajj, 5th edition",
  guidance:
    "From Chapter 7 on, every chapter runs the same way: a basic kernel, then items from the checklist in Fig. 6.13, each judged by its arithmetic intensity. Learn that method, not just the code. Kernels run in three places. LeetGPU checks CUDA in the browser. A Colab GPU runs real CUDA when LeetGPU cannot. Your ports run in Vulkan compute on the RX 5700 XT and Iris Xe, and those are the only real timings you will own. Many exercises need no GPU at all, so each chapter says which. Pages are the PDF's own. Each chapter ends with \"Description of Figure\" pages written for screen readers, which you can skip. The book does not mention ray tracing or Vulkan, so the links to the renderer are ours: check them as you go. There is no answer key, so attempt everything first.",
  extraLinks: [
    { label: "LeetGPU", url: "https://leetgpu.com" },
    { label: "Vulkan subgroups", url: "https://www.khronos.org/blog/vulkan-subgroup-tutorial" },
    { label: "GPU MODE on YouTube", url: "https://www.youtube.com/@GPUMODE" },
    { label: "GPU MODE lecture notes and code", url: "https://github.com/gpu-mode/lectures" },
  ],
  defaultPerWeek: 1,
  defaultHours: 6,
  unitLabel: "chapters",
  sections: [
    {
      name: "Before you start",
      units: [
        {
          ref: "pmpp-setup",
          name: "Set up your three places to run kernels",
          short: "CUDA setup",
          hours: 2,
          links: [gpuMode(1, "Profiling and Integrating CUDA kernels in PyTorch", "Profiling"), gpuMode(26, "SYCL MODE (Intel GPU)", "SYCL"), gpuMode(27, "gpu.cpp"), gpuMode(41, "CUDA Docs for Humans")],
          notes:
            "CUDA needs an NVIDIA GPU and neither of yours is one. LeetGPU emulates one on a CPU, with a functional mode for output and a cycle-accurate mode, built on Accel-Sim, that estimates timing. Its authors say it covers most of the core runtime API, so expect gaps in what the book uses later: cuda::atomic_ref, warp shuffles, cooperative groups. Find out now rather than mid-chapter. A Colab GPU runtime is your fallback for real CUDA. Done when a small kernel runs in both, and you have saved vulkaninfo for both of your own GPUs.",
          steps: [
            "Run a small CUDA kernel on LeetGPU in both modes, and note any limits on run time and memory",
            "Try three features the book relies on: __shared__ with __syncthreads(), an atomic, and __shfl_down_sync. Write down what fails",
            "Run the same kernel on a Colab GPU runtime, so you have somewhere to go when LeetGPU falls short",
            "Install vulkan-tools on both machines and save the vulkaninfo output for the RX 5700 XT and the Iris Xe",
          ],
        },
        chapter(1, "Introduction", {
          page: 47,
          hours: 1.5,
          links: [gpuMode(2, "Recap Ch. 1-3 from the PMPP book", "Recap")],
          notes:
            "A short read, with no exercises. Read 1.7 for the map of the book, and write down what you most want from it: for you, a faster renderer. Amdahl's law comes up here and returns in Chapter 22.",
          steps: READ_STEPS,
          reviews: [
            "Why have CPUs and GPUs followed different designs? Answer in terms of latency and throughput.",
            "State Amdahl's law, then work out the speedup when 95% of a program runs 100 times faster.",
          ],
        }),
      ],
    },
    {
      name: "Part 1: Fundamental concepts",
      units: [
        chapter(2, "Heterogeneous data-parallel computing", {
          page: 88,
          hours: 6.5,
          links: [gpuMode(3, "Getting Started With CUDA"), gpuMode(2, "Recap Ch. 1-3 from the PMPP book", "Recap")],
          exercises: 10,
          needs: ["pmpp-setup"],
          notes:
            "Vector addition, from allocating memory to reading back the result. All ten exercises are on paper, mostly mapping indices and counting threads. Your own copy of this kernel is the first program in the compute harness, in the Rendering lab.",
          steps: [
            "Read 2.1 to 2.7 and run the vector addition on LeetGPU",
            "Rebuild it from a blank file: allocate, copy in, launch, copy out, free",
            "Run it at several sizes in cycle-accurate mode and see how the estimate grows",
            "Exercises 1 to 10, all on paper. Try each one before checking",
            "Work through GPU MODE lecture 3 in its Colab notebook, which runs on a real NVIDIA GPU",
          ],
          reviews: [
            "From memory, list the steps that move a computation onto a GPU, and say where the data lives at each one.",
            "Write the expression that turns a block index and a thread index into a data index. Why does a kernel need a boundary check?",
          ],
        }),
        chapter(3, "Multidimensional grids and data", {
          page: 150,
          hours: 7,
          links: [gpuMode(2, "Recap Ch. 1-3 from the PMPP book", "Recap")],
          notes:
            "The book has no exercises for this chapter, so the steps below stand in for them. Your shader's 8×8 workgroup is one of this chapter's 2D blocks, and gl_GlobalInvocationID is the same index sum you write here by hand. Matrix multiplication returns in Chapters 5 and 15, so get it right now.",
          steps: [
            "Read 3.1 to 3.4, running the kernels on LeetGPU",
            "Rebuild the image blur (3.3) from a blank file, and draw how one thread finds its pixels",
            "Rebuild matrix multiplication (3.4) from a blank file, and test it on a product you worked out by hand",
            "Check the blur is linear: blur(a·x + b·y) should match a·blur(x) + b·blur(y), up to rounding",
            "Watch GPU MODE lecture 2, a recap of chapters 1 to 3, and note anything you would explain differently",
          ],
          reviews: [
            "Given a 2D grid of 2D blocks, write the pixel coordinates and the linear array index for one thread.",
            "Each output of matrix multiplication is one inner product. Of what, and how do threads divide the work?",
          ],
        }),
        chapter(4, "Compute architecture and scheduling", {
          page: 202,
          hours: 7.5,
          links: [gpuMode(4, "Intro to Compute and Memory Architecture", "Compute and Memory"), gpuMode(37, "Introduction to SASS & GPU Microarchitecture", "SASS")],
          exercises: 9,
          notes:
            "How threads actually run. All nine exercises are on paper. The book's warp is 32 threads, which is close to home: your RX 5700 XT can run compute at a subgroup size of 32 or 64, and the Iris Xe reports its own range. Then test the idea on your own path tracer, in the divergence lab.",
          steps: [
            "Read 4.1 to 4.8",
            "Work out SIMD efficiency by hand for a loop where threads stop at different iterations, as in Fig. 4.10",
            "Compare what 4.8 queries with your vulkaninfo: subgroup sizes, invocations per workgroup, shared memory",
            "Exercises 1 to 9, all on paper",
            "Watch GPU MODE lecture 4 on compute and memory architecture, and check it against your notes on warps and scheduling",
          ],
          reviews: [
            "Define warp, SIMD efficiency and occupancy, and say what limits occupancy.",
            "How can you tell from a branch's condition whether it can diverge? What does divergence cost?",
            "Why must threads in different blocks not wait for each other? What do you gain by that rule?",
          ],
        }),
        chapter(5, "Memory architecture and data locality", {
          page: 264,
          hours: 9.5,
          links: [gpuMode(5, "Going Further with CUDA for Python Programmers", "Going Further with CUDA"), gpuMode(4, "Intro to Compute and Memory Architecture", "Compute and Memory")],
          exercises: 12,
          notes:
            "The most important chapter for the renderer. A kernel is limited by compute or by memory, and its arithmetic intensity in FLOP/B says which. The book's H100 crosses over at 20.0 FLOP/B (66.9 TFLOPS over 3.35 TB/s). Your RX 5700 XT's paper figures give about 21.8 (9.75 TFLOPS over 448 GB/s), so the book's reasoning carries over almost unchanged, at a lower absolute speed. The Iris Xe shares system RAM, so measure it. Exercises are on paper, with exercise 10 a kernel to debug by reading.",
          steps: [
            "Read 5.1 with its roofline sidebar, then 5.2 to 5.6",
            "Work out the crossover for each of your GPUs: peak FLOPS over peak bandwidth",
            "Rebuild the tiled matrix multiplication (5.4) from a blank file",
            "Compute the intensity of the plain and tiled kernels. Say which side of the crossover each falls on",
            "Exercises 1 to 12, all without a GPU",
            "Watch GPU MODE lecture 5, which builds a tiled matrix multiply with shared memory, and compare it with yours",
          ],
          reviews: [
            "Define arithmetic intensity, and work out where a GPU crosses from memory-bound to compute-bound.",
            "A kernel does 0.25 FLOP/B on a GPU with 3.35 TB/s of bandwidth. What is its speed limit, and how do you know?",
            "Why does tiling raise arithmetic intensity, and how does the gain scale with the tile's size?",
          ],
        }),
        chapter(6, "Performance considerations", {
          page: 346,
          hours: 8,
          links: [gpuMode(8, "CUDA Performance Checklist", "Performance Checklist"), gpuMode(16, "On Hands profiling", "profiling")],
          exercises: 5,
          milestone: true,
          notes:
            "The checklist in Fig. 6.13 is what this chapter is for, and every later chapter applies items from it. From here on, end each build by saying which item you used and what it changed. Vulkan hides bank conflicts, vector loads and occupancy, so learn them here and use Radeon GPU Profiler to see what the desktop actually does. Exercises 1, 3 and 5 are on paper; 2 and 4 are code.",
          steps: [
            "Read 6.1 to 6.7",
            "Rewrite the checklist (6.8) in your own words, grouped as compute, memory, synchronisation and coarsening",
            "Read 6.9, then write down how you would find what limits a kernel before changing any code",
            "Exercises 1, 3 and 5 on paper, then 2 and 4 on LeetGPU or Colab",
            "Watch GPU MODE lecture 8 on the performance checklist, and match each item to Fig. 6.13",
          ],
          reviews: [
            "Give the checklist from memory, by category, with a line on what each item buys you.",
            "What makes a set of memory accesses coalesced? Name two ways to get there when the pattern is irregular.",
            "What does thread coarsening trade away, and what does double buffering remove?",
          ],
        }),
      ],
    },
    {
      name: "Part 2: Parallel patterns",
      units: [
        chapter(7, "Convolution", {
          page: 404,
          hours: 8,
          exercises: 11,
          notes:
            "A blur done properly: filter in constant memory, then tiles with halo cells. Exercises 1 to 7 are on paper, and 8 to 11 extend the kernels. Bring it home in the denoise lab, where your image borders are its ghost cells.",
          steps: [
            "Read 7.1 to 7.4, and run the basic and constant-memory kernels",
            "Rebuild the tiled kernel with halo cells (7.5) from a blank file",
            "Follow the chapter's intensity analysis, then redo it with your own filter and tile sizes",
            "Exercises 1 to 7 on paper, then code one of 8 to 11",
          ],
          reviews: [
            "What are halo cells and ghost cells, and how do they change a tiled kernel's control flow?",
            "Why does the filter belong in constant memory? What does tiling then do for arithmetic intensity?",
          ],
        }),
        chapter(8, "Stencil computation", {
          page: 470,
          hours: 6,
          exercises: 2,
          notes:
            "Convolution with a physics motive: repeated sweeps over a 3D grid, which is why coarsening and register tiling pay off here. Both exercises are on paper. Repeated sweeps with two buffers are also how an à-trous denoiser works.",
          steps: [
            "Read 8.1 to 8.3, and run the basic 3D 7-point kernel",
            "Rebuild it with shared-memory tiling and thread coarsening (8.4, 8.5)",
            "Add register tiling (8.6), and write down what moved from shared memory into registers",
            "Exercises 1 and 2, on paper",
          ],
          reviews: [
            "What makes a stencil different from a convolution, and which optimisations does that open up?",
            "Why does a sweep read from one buffer and write to another?",
          ],
        }),
        chapter(9, "Histogram", {
          page: 522,
          hours: 6,
          exercises: 5,
          notes:
            "The first pattern where a thread cannot know in advance which output it will touch, which brings in atomics. This edition uses an image histogram and cuda::atomic_ref, so check that LeetGPU runs it, and use Colab if not. All five exercises are on paper. Your own version is the auto-exposure lab, and binned SAH is this same idea.",
          steps: [
            "Read 9.1 to 9.3, and run the basic atomic kernel",
            "Rebuild it with privatisation into shared memory (9.4)",
            "Add thread coarsening (9.5), then read thread-level privatisation (9.6)",
            "Exercises 1 to 5, on paper",
          ],
          reviews: [
            "Why is atomic throughput on one location roughly the inverse of twice the memory latency? Work one example.",
            "What does privatisation change, and when would it stop helping?",
          ],
        }),
        chapter(10, "Reduction", {
          page: 587,
          hours: 9,
          links: [gpuMode(9, "Reductions")],
          exercises: 6,
          notes:
            "A small pattern used to teach a lot: reducing divergence, coalescing and synchronisation in turn. Exercise 4 is a max reduction, which is half of a bounding box. Vulkan gives you the warp-level step directly as subgroupAdd, subgroupMin and subgroupMax, so compare them with the shuffles you write here. Exercises 1, 2 and 6 are on paper; 3 to 5 are code.",
          steps: [
            "Read 10.1 to 10.6",
            "Rebuild the kernel that avoids divergence and uncoalesced access (10.4, 10.5) from a blank file",
            "Read 10.7 and 10.8, and add the warp-level version",
            "Exercises 1, 2 and 6 on paper, then 3 to 5 in code",
            "Watch GPU MODE lecture 9 on reductions, and compare its kernels with the book's",
          ],
          reviews: [
            "How does a reduction tree work? What must the operator satisfy, and when does the order of operands matter too?",
            "Name the three overheads this chapter removes from the simple kernel, and how each one goes away.",
          ],
        }),
        chapter(11, "Scan", {
          page: 677,
          hours: 12,
          links: [gpuMode(20, "Scan Algorithm"), gpuMode(21, "Scan Algorithm Part 2", "Scan Algorithm Part 2"), gpuMode(24, "Scan at the Speed of Light", "Speed of Light")],
          exercises: 7,
          notes:
            "The longest pattern chapter, and what filter and radix sort are built on. Budget for it. Take Kogge-Stone and reduce-scan-scan with you into Vulkan. Leave lookback (11.9) behind: it relies on other workgroups making progress, and Vulkan only gives a limited guarantee of that. Exercises 1, 2, 3 and 6 are on paper; 4, 5 and 7 are code.",
          steps: [
            "Read 11.1 to 11.4: Kogge-Stone, double buffering, warp-level primitives",
            "Rebuild Kogge-Stone from a blank file, and check it against a sequential scan on random input",
            "Read 11.5 to 11.10, and write a short comparison of scan-scan-add, reduce-scan-scan and lookback",
            "Exercises 1, 2, 3 and 6 on paper, then 4, 5 and 7 in code",
            "Watch GPU MODE lectures 20 and 21, where Izzat El Hajj, one of the book's authors, teaches scan",
          ],
          reviews: [
            "Compare Kogge-Stone with Brent-Kung on work and on steps. Why can the less work-efficient one win on a GPU?",
            "Trace Kogge-Stone by hand on eight numbers from memory.",
            "Explain reduce-scan-scan, and why it touches global memory less than scan-scan-add.",
          ],
        }),
        chapter(12, "Filter", {
          page: 787,
          hours: 6,
          exercises: 4,
          needs: ["pmpp-11"],
          notes:
            "New in this edition, and the missing piece between scan and radix sort. An unstable filter uses atomics and is simple. A stable filter uses scan and keeps the order. Radix sort's partition generalises a stable filter. In the renderer, this is removing dead rays and culling splats. All four exercises are code, and they build on each other.",
          steps: [
            "Read 12.1 to 12.4: the unstable filter, warp-level coalescing, privatisation",
            "Exercise 1: build a stable filter as three kernels, using your scan from Chapter 11",
            "Read 12.5 to 12.8",
            "Exercises 2 to 4: one kernel, then privatised, then coarsened",
          ],
          reviews: [
            "Compare the stable and unstable filters: how each finds where to write, and what each costs.",
            "How does a scan turn a yes-or-no test into output positions with no gaps?",
          ],
        }),
        chapter(13, "Merge", {
          page: 832,
          hours: 6,
          exercises: 4,
          notes:
            "Radix sort does not need this, so keep the build small. It is here for merge sort and for one idea worth keeping: each thread finds its own input range with a binary search, with no coordination, using the co-rank function. Exercises 1, 2 and 4 are on paper; 3 is code.",
          steps: [
            "Read 13.1 to 13.5",
            "Rebuild the co-rank function and the basic merge, and check the output against std::merge",
            "Read 13.6 to 13.8 for the ideas. No need to rebuild the circular buffer",
            "Exercises 1, 2 and 4 on paper, then 3 in code",
          ],
          reviews: [
            "Define the co-rank function. How does it give each thread equal work without searching everything?",
            "Why does the merge favour assigning threads to the output rather than the input?",
          ],
        }),
        chapter(14, "Sorting", {
          page: 916,
          hours: 9,
          exercises: 4,
          milestone: true,
          needs: ["pmpp-11", "pmpp-12"],
          notes:
            "The chapter the renderer leans on most, since LBVH and splat sorting both need it. The book tells most readers to use a library such as CUB, but Vulkan gives you none, so here it matters that you can write one. Use it to sort 30-bit Morton codes, with as many keys as LeetGPU handles comfortably. All four exercises are code; exercises 1 to 3 improve the kernel, and exercise 4 needs your merge.",
          steps: [
            "Read 14.1 to 14.5, and run odd-even sort so you have something to compare against",
            "Rebuild one single-bit radix iteration (14.5) from a blank file, using your scan",
            "Exercise 2: extend it to several bits, and use 14.7 to choose a radix for 30-bit Morton codes",
            "Exercises 1, 3 and 4: shared memory, coarsening, and merge sort",
          ],
          reviews: [
            "Derive where a key goes in one radix pass, for a zero and for a one, from the count of ones before it.",
            "Why must each pass be stable? What limits how large the radix can usefully get?",
            "Why does radix sort suit a GPU better than comparison sorts?",
          ],
        }),
        chapter(15, "Advanced optimizations for matrix multiplication", {
          page: 971,
          hours: 9,
          links: [gpuMode(15, "CUTLASS"), gpuMode(23, "Tensor Cores")],
          exercises: 3,
          optional: true,
          notes:
            "New in this edition, and the checklist applied to its limit: large tiles, register tiling, padding against bank conflicts, software pipelining. Much of it is below what Vulkan lets you control. Read it if a neural direction takes off, or if you want to see how far the checklist goes.",
          steps: [
            "Read 15.1 to 15.3, and follow the data reuse analysis",
            "Read 15.4 to 15.9, mapping each step to its checklist item",
            "Exercises 1 to 3, in code",
          ],
          reviews: ["Large output tiles make matrix multiplication compute-bound. What goes wrong with occupancy, and how does the chapter recover?"],
        }),
      ],
    },
    {
      name: "Part 3: Advanced patterns and applications",
      units: [
        chapter(17, "Sparse matrix computation", {
          page: 1135,
          hours: 7,
          exercises: 5,
          notes:
            "The same product stored six ways: COO, CSR, ELL, hybrid, JDS and CSC. It teaches how data layout decides what a kernel can do, and Chapter 18 needs CSR and CSC. Exercise 3 builds CSR out of histogram and scan, so it reuses two patterns at once. Exercises 1 and 2 are on paper; 3 to 5 are code.",
          steps: [
            "Read 17.1 to 17.3, and run the COO and CSR kernels",
            "Build the ELL kernel (17.4), and compare its coalescing and padding with CSR",
            "Read 17.5 to 17.7",
            "Exercises 1 and 2 on paper, then 3 to 5 in code",
          ],
          reviews: [
            "For m rows, n columns and z non-zeros, what does each format store? What does ELL gain, and what can make it blow up?",
            "Why do iterative solvers spend most of their time in SpMV, and why is SpMV's FLOPS rating so low?",
          ],
        }),
        chapter(18, "Graph traversal", {
          page: 1205,
          hours: 8,
          exercises: 3,
          needs: ["pmpp-17"],
          notes:
            "Work that changes shape as it runs, using breadth-first search. The frontier queue and the load-balancing ideas carry over to a wavefront path tracer, where the set of live rays shrinks every bounce. Cooperative groups (18.7) need real CUDA, so use Colab, and Vulkan has no equivalent: you end the dispatch instead. Exercise 1 is on paper; 2 and 3 are code.",
          steps: [
            "Read 18.1 to 18.4: push, pull and edge-centric",
            "Rebuild the frontier version (18.5) from a blank file",
            "Read 18.6 to 18.8",
            "Exercise 1 on paper, then 2 and 3 in code",
          ],
          reviews: [
            "Compare push, pull and edge-centric BFS. When is each one the right choice?",
            "How do you build a frontier queue in parallel when each thread adds an unknown number of items?",
          ],
        }),
        chapter(21, "Electrostatic potential map", {
          page: 1475,
          hours: 6,
          exercises: 5,
          notes:
            "Two ideas you will use directly. Scatter against gather: each thread writes wherever its input lands, or owns one output and pulls in what it needs. Your path tracer gathers: each invocation owns a pixel, so it needs no atomics. Splats scatter, which is why they go through blending hardware. Cutoff binning, with its overflow list, is a uniform grid. Exercises 1 and 4 are code; 2, 3 and 5 are analysis.",
          steps: [
            "Read 21.1 and 21.2, and rebuild the gather kernel",
            "Add thread coarsening (21.3), and count what it saves",
            "Read 21.4 and 21.5, paying attention to the overflow list",
            "Exercises 2, 3 and 5 by reasoning, then 1 and 4 in code",
          ],
          reviews: [
            "Compare scatter with gather. Why can the slower sequential code make the better parallel kernel?",
            "How does cutoff binning change the cost as the system grows, and what happens to atoms that do not fit a bin?",
          ],
        }),
        chapter(22, "Algorithm selection, problem decomposition, and problem formulation", {
          page: 1528,
          hours: 3,
          notes:
            "No exercises and no kernels. Instead, use it on your own work: write a one-page note taking each pass of your renderer and saying whether it is input-centric or output-centric, what share of a frame it takes, and what Amdahl's law says that limits. Skim 22.5 if you have skipped Chapter 20.",
          steps: [
            "Read 22.1 to 22.5",
            "Sort the book's patterns into input-centric and output-centric from memory, then check against 22.2",
            "Write the one-page note on your renderer, using your measured numbers",
          ],
          reviews: [
            "Compare input-centric and output-centric decomposition. What should decide between them?",
            "When does accepting worse latency give you better throughput? Use batching as the example.",
          ],
        }),
        {
          ref: "pmpp-app-b",
          name: "Appendix B Deep learning basics",
          short: "PMPP App. B",
          page: 1727,
          hours: 4,
          notes:
            "Moved out of Chapter 19 in this edition. It covers classifiers, fully connected and convolutional layers, and training. NeRF is a fully connected network, so this matters even if you skip the rest of the neural chapters.",
          steps: ["Read B.1 to B.4", "Write out one forward and one backward pass for a two-layer network by hand"],
          reviews: [{ kind: "idea", prompt: "PMPP App. B: From memory, describe a forward and a backward pass through a small network, and name what is stored for each." }],
        },
        chapter(19, "Convolutional neural networks", {
          page: 1294,
          hours: 7,
          exercises: 4,
          needs: ["pmpp-7", "pmpp-app-b"],
          notes:
            "Chapter 7's convolution becomes a layer, and then 19.3 rewrites that layer as a matrix product so it can use fast matrix code. Training is too heavy for an emulator, so use a Colab GPU. Your RX 5700 XT is not on AMD's supported list for ROCm: workarounds exist with mixed reports, so do not lose a week to them. It can still run a trained layer as a Vulkan compute shader. Exercises 2 and 4 are analysis; 1 and 3 are code.",
          steps: [
            "Read 19.1 and 19.2, and rebuild the convolutional layer kernel",
            "Read 19.3, and draw the rearrangement into a matrix product for a small layer",
            "Read 19.4",
            "Exercises 2 and 4 by reasoning, then 1 and 3 in code",
          ],
          reviews: ["How can a convolutional layer be rearranged into a matrix multiplication, and what does that buy you?"],
        }),
        chapter(20, "Large language models", {
          page: 1362,
          hours: 10,
          links: [gpuMode(12, "Flash Attention")],
          exercises: 4,
          optional: true,
          needs: ["pmpp-19"],
          notes:
            "New in this edition, and worth reading for its own sake, but the renderer does not depend on it. It covers attention, softmax, KV caching and flash attention. Make it core if you want to work on LLMs, or if your neural direction turns to attention-based scene models.",
          steps: [
            "Read 20.1 to 20.3",
            "Rebuild the attention computation for a small input",
            "Read 20.4 to 20.7",
            "Exercises 1 to 4",
          ],
          reviews: [
            "Walk through one attention head as matrices, from Q, K and V to its output.",
            "What does KV caching save, and what memory problem does it create?",
          ],
        }),
        chapter(16, "Dynamic programming and wavefront parallelism", {
          page: 1043,
          hours: 8,
          exercises: 6,
          optional: true,
          notes:
            "Despite the name, this is not wavefront path tracing. It parallelises dynamic programming tables, using Floyd-Warshall and Smith-Waterman. A good chapter if you want it, and the renderer does not need it.",
          steps: ["Read 16.1 to 16.5", "Rebuild the block-tiled kernel (16.6)", "Read 16.7 and 16.8", "Exercises 1 to 6, in code"],
          reviews: ["What dependency pattern defines a wavefront, and why does tilting the tiles keep threads busy?"],
        }),
        chapter(23, "Multi-GPU programming", {
          page: 1556,
          hours: 8,
          links: [gpuMode(17, "GPU Collective Communication (NCCL)", "NCCL")],
          exercises: 3,
          optional: true,
          notes:
            "Clusters, using MPI, NCCL and NVSHMEM. Your two GPUs are in two different machines and neither runs CUDA, so there is nothing here to run. The exercises are on paper if you want the ideas, particularly overlapping computation with communication (23.3).",
          steps: READ_STEPS,
          reviews: ["How does computing boundary values first let a stencil overlap computation and communication?"],
        }),
      ],
    },
    {
      name: "Conclusion",
      units: [
        chapter(24, "Conclusion and future outlook", {
          page: 1668,
          hours: 1,
          notes: "A short read to finish on. Compare your first kernel with what you would write now.",
          steps: READ_STEPS,
          reviews: ["What would you now do differently in your first kernels, and why?"],
        }),
      ],
    },
    {
      name: "Appendices (dip in when needed)",
      units: [
        {
          ref: "pmpp-app-a",
          name: "Appendix A Numerical considerations",
          short: "PMPP App. A",
          page: 1679,
          hours: 3,
          links: [gpuMode(84, "Numerics and AI")],
          exercises: 5,
          optional: true,
          notes:
            "Read A.6 alongside Chapter 10: floating-point addition is not associative, so a reduction tree and a loop can disagree. Come back when precision causes trouble, such as a ray hitting the surface it just left.",
          steps: ["Read A.1 to A.4 and A.6", "Read A.5 and A.7 when you need them", "Exercises 1 to 5, on paper"],
          reviews: [{ kind: "idea", prompt: "PMPP App. A: Why can a reduction tree and a sequential sum give different answers, and how does sorting first help?" }],
        },
        {
          ref: "pmpp-app-c",
          name: "Appendix C CUDA memories, address spaces, and pointers",
          short: "PMPP App. C",
          page: 1787,
          hours: 2,
          optional: true,
          notes: "Read C.2 around Chapter 6. Zero-copy is the same choice you face in Vulkan between memory the CPU can see and memory only the GPU can see, and your two GPUs answer it differently.",
          steps: READ_STEPS,
          reviews: [{ kind: "idea", prompt: "PMPP App. C: When is zero-copy access the wrong choice, and what limits it?" }],
        },
      ],
    },
  ],
};
