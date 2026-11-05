// Programming Massively Parallel Processors, 5th edition (2026), by Hwu, Kirk and
// El Hajj. Chapter titles and order come from the publisher's contents page. The
// book's text was not available, so the builds and review prompts below are
// suggestions from each chapter's topic. Edit them once you have read the chapter.

import type { PlanUnit, StudyPlan } from "./plan-types.ts";

const STEPS = [
  "Read and run the chapter's examples on LeetGPU",
  "Rebuild the core kernel from a blank file, without looking",
  "Measure it: compare with your last attempt on the same setup, and record the numbers",
  "Exercises: try each one first, and only then check a solution",
];

const READ_STEPS = ["Read with a question in mind", "Explain the main idea out loud, without notes"];

function chapter(
  n: number,
  title: string,
  build: string,
  prompt: string,
  extra: Partial<PlanUnit> = {},
): PlanUnit {
  return {
    ref: `pmpp-${n}`,
    name: `Ch ${n} ${title}`,
    short: `PMPP ${n}`,
    notes: build,
    steps: STEPS,
    reviews: [{ kind: "idea", prompt: `PMPP ${n}: ${prompt}` }],
    ...extra,
  };
}

export const PMPP: StudyPlan = {
  project: "pmpp",
  mode: "book",
  title: "Programming Massively Parallel Processors",
  subtitle: "Hwu, Kirk and El Hajj, 5th edition",
  guidance:
    "A hands-on book, so a chapter is not finished until you have rebuilt its kernel yourself and measured it. Everything is in CUDA, and you will run it on LeetGPU, which emulates a GPU in the browser, so start with the setup task. Its timings are estimates: use them to compare your own attempts. For real numbers, port a kernel to Vulkan compute and measure it on your Iris Xe, since CUDA blocks and warps map loosely to workgroups and subgroups. Solutions online are for the 4th edition at best: attempt first, and expect differences.",
  extraLinks: [{ label: "LeetGPU", url: "https://leetgpu.com" }],
  defaultPerWeek: 2,
  unitLabel: "chapters",
  sections: [
    {
      name: "Before you start",
      units: [
        {
          ref: "pmpp-setup",
          name: "Get set up on LeetGPU",
          short: "CUDA setup",
          notes:
            "This laptop's Iris Xe cannot run CUDA, so LeetGPU is where the exercises happen. It emulates a GPU on a CPU in the browser, which suits learning kernels but not long or heavy runs. If a book example will not compile, suspect the emulator before your code: a user reported this at launch. Training a network needs real hardware, so use a Google Colab GPU runtime or an hourly cloud GPU for those. Done when a small CUDA program runs and you know the current limits.",
          steps: ["Run a small CUDA program on LeetGPU", "Check its current limits on run time and memory", "Try its timing mode, so you know what you can and cannot measure"],
        },
      ],
    },
    {
      name: "Introduction",
      units: [
        chapter(1, "Introduction", "A short read. Write down what you most want from this book: for you, a faster renderer.", "Why have GPUs and CPUs followed different designs, and what does each optimise for?", { steps: READ_STEPS }),
      ],
    },
    {
      name: "Part I: Fundamental Concepts",
      units: [
        chapter(2, "Heterogeneous data parallel computing", "Build: vector addition in CUDA, then run it at several sizes and see how the time grows. Emulated timing cannot tell you where a real GPU beats a CPU, so treat that as a question for later.", "Trace what happens from launching a kernel to reading its result, including where the data lives.", { needs: ["pmpp-setup"] }),
        chapter(3, "Multidimensional grids and data", "Build: generate your renderer's sky gradient as an image in a CUDA kernel, using a 2D grid of threads.", "How do a thread's block and thread indices become a pixel position?"),
        chapter(4, "Compute architecture and scheduling", "Build: port the sphere intersection from raytrace.comp to a CUDA kernel, then measure what bounces that diverge cost.", "What is SIMT, and what does control-flow divergence cost? Why do path tracers suffer from it?"),
        chapter(5, "Memory architecture and data locality", "Build: store the spheres as an array of structs and as a struct of arrays, and compare. Then repeat it in a Vulkan compute shader on your Iris Xe for real numbers, which should decide your BVH node layout.", "Explain coalesced versus uncoalesced access, and how to choose a data layout."),
        chapter(6, "Performance considerations", "Build: profile an earlier kernel and find what actually limits it. Vary the block size and record the results.", "How would you work out what limits a kernel's performance before changing any code?"),
      ],
    },
    {
      name: "Part II: Parallel Patterns",
      units: [
        chapter(7, "Convolution", "Build: a blur over your renderer's output image. It is a first step towards denoising.", "How does a convolution kernel use memory, and what could you precompute or avoid reading?"),
        chapter(8, "Stencil", "Build: a simple stencil over a grid, and compare it with a stencil that reads from its neighbours' previous values.", "Why does a stencil read from one buffer and write to another? How do you reduce what it reads?"),
        chapter(9, "Parallel histogram", "Build: a luminance histogram of the renderer's output, usable later for auto-exposure. Compare a shared histogram with per-block ones.", "Why does a shared histogram slow down under contention, and what are the ways around it?"),
        chapter(10, "Reduction", "Build: the bounding box of a large set of points, using parallel reduction. Your BVH builder needs this.", "How does a reduction tree work, and what property must the operation have?"),
        chapter(11, "Prefix sum (scan)", "Build: a scan, then use it to compact a list of active rays. It is a building block for radix sort.", "Give two ways to do a parallel scan and what each trades off. How does a scan turn a yes-or-no test into a compact output?"),
        chapter(12, "Merge", "Build: a parallel merge of two sorted arrays, and check the output against the standard library.", "How do you split a parallel merge so each thread gets equal work without searching everything?"),
      ],
    },
    {
      name: "Part III: Advanced Patterns and Applications",
      units: [
        chapter(13, "Sorting", "Build: radix-sort 30-bit Morton codes, using as many points as LeetGPU handles comfortably. Both LBVH and Gaussian splat sorting use this, so it is the most directly useful chapter here. The million-key version comes later, in the renderer's radix sort milestone.", "Explain radix sort using scan, and why it suits GPUs better than comparison sorts.", { needs: ["pmpp-11"] }),
        chapter(14, "Filtering", "New in this edition. Build: keep only the splats inside the view frustum, without gaps in the output.", "How can you filter in parallel when you do not know how much output each thread will produce?"),
        chapter(15, "Sparse matrix computation", "Build: sparse matrix times vector in two formats, and compare. Optional for the renderer.", "Compare two sparse formats. What makes each one suit a GPU or not?", { optional: true }),
        chapter(16, "Wavefront algorithms", "New in this edition. Note: this may not mean the same thing as wavefront path tracing, so check what it covers before assuming it applies to the renderer.", "What dependency pattern defines a wavefront algorithm, and how is it scheduled?"),
        chapter(17, "Graph traversal", "Build: breadth-first search with a frontier queue. The queue pattern carries over to BVH traversal and path state.", "Why is a frontier queue on a GPU hard, and how do you handle a queue that grows unevenly?"),
        chapter(18, "Deep learning", "Build: train a small multilayer network from scratch. Training is too heavy for an emulator, so use a Google Colab GPU runtime or an hourly cloud GPU. This prepares you for the tiny NeRF.", "What work in training suits a GPU, and where does memory limit it?"),
        chapter(19, "Multi-GPU API", "New in this edition. Optional unless you get access to several GPUs.", "When does splitting work across GPUs help, and what does it cost?", { optional: true }),
        chapter(20, "Electrostatic potential map", "Build: its spatial binning idea applies directly to ray tracing, as a uniform grid. Compare it with your BVH.", "How does binning by space turn an all-pairs problem into a local one?", { optional: true }),
        chapter(21, "Parallel programming and computational thinking", "Apply it: write a one-page design note for your GPU BVH using this chapter's approach.", "How do you break a new problem down for a parallel machine?", { steps: READ_STEPS }),
      ],
    },
    {
      name: "Part IV: Advanced Practices",
      units: [
        chapter(22, "Programming a heterogeneous computing cluster", "Optional unless you have access to a cluster.", "How do CPUs and GPUs share work across cluster nodes?", { optional: true, steps: READ_STEPS }),
        chapter(23, "Advanced optimizations for matrix multiplication", "New in this edition. Optional, and useful if the neural rendering work takes off.", "What makes matrix multiplication fast beyond the simple loop?", { optional: true }),
        chapter(24, "Advanced practices and future evolution", "A read for ideas about where GPUs are going.", "Which recent GPU capabilities would change how you would write your renderer?", { steps: READ_STEPS }),
        chapter(25, "Conclusion and outlook", "A short read to finish on.", "What would you now do differently in your first kernels?", { steps: READ_STEPS, optional: true }),
      ],
    },
    {
      name: "Appendices (for reference)",
      units: [
        { ref: "pmpp-app-a", name: "Appendix A Numerical considerations", short: "PMPP App. A", notes: "Dip in when floating-point precision causes trouble, such as self-intersection in the path tracer.", steps: READ_STEPS, optional: true },
        { ref: "pmpp-app-b", name: "Appendix B Deep learning basics", short: "PMPP App. B", notes: "Read before Chapter 18 if the terms are new.", steps: READ_STEPS, optional: true },
        { ref: "pmpp-app-c", name: "Appendix C CUDA memories, address spaces and pointers", short: "PMPP App. C", notes: "Keep it open during Parts I and II.", steps: READ_STEPS, optional: true },
      ],
    },
  ],
};
