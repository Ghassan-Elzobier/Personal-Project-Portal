// The Vulkan renderer's road map, starting from what the repo does today: a
// progressive path tracer in one compute shader, with four hardcoded spheres, no
// timing, a fixed camera and no scene buffers. The order is deliberate. Measure
// first, because every later milestone is judged by numbers. BVH comes before
// splats because both depend on GPU sorting, and neural rendering comes last, time
// boxed, because it is the most open-ended.
//
// Several milestones exist to take a PMPP chapter out of CUDA and onto a real GPU:
// the harness, the machine card, divergence, denoise, exposure and wavefront.

import type { PlanUnit, StudyPlan } from "./plan-types.ts";

const BUILD = [
  "Write a short design note: the approach, the book pattern it uses, the checklist items you expect to matter, and how you will measure it",
  "Implement it on a branch",
  "Measure it on the RX 5700 XT, and on the Iris Xe when the contrast teaches something. Record each result with the commit",
  "Save a screenshot or clip, and link it as Evidence",
];
const SPIKE = ["Set the question and a time limit", "Try it", "Write down what you learned and what you decided"];
const PAPER = [
  "Read for the main idea and the results",
  "Explain it out loud, without notes",
  "Write down what you would build first",
];

function build(ref: string, name: string, hours: number, notes: string, extra: Partial<PlanUnit> = {}): PlanUnit {
  return { ref: `r-${ref}`, name, short: name, hours, notes, steps: BUILD, ...extra };
}

export const RENDERING: StudyPlan = {
  project: "rendering",
  mode: "lab",
  title: "Vulkan renderer",
  subtitle: "Compute path tracer, then BVH, Gaussian splats and neural rendering",
  guidance:
    "A milestone counts when its numbers are recorded, not when the code compiles. Log results below with the commit and GPU, because numbers from different GPUs cannot be compared. Your desktop's RX 5700 XT is the main benchmark GPU: discrete memory, far more bandwidth, and enough for every Vulkan milestone here. The laptop's Iris Xe is the useful contrast, since it shares system RAM. Neither runs CUDA or has ray tracing hardware, so anything needing CUDA, such as training, goes to Colab or an hourly cloud GPU.",
  sourceUrl: () => "https://github.com/Ghassan-Elzobier/Vulkan-Renderer",
  extraLinks: [{ label: "Radeon GPU Profiler", url: "https://gpuopen.com/rgp/" }],
  defaultPerWeek: 1,
  defaultHours: 8,
  unitLabel: "milestones",
  sections: [
    {
      name: "Foundations: make progress measurable",
      units: [
        build(
          "baseline",
          "Measure the baseline",
          4,
          "The shader has no timing yet. Add GPU timestamp queries around the dispatch, then record ms per frame and million rays per second at a fixed resolution, sample count and seed, on both GPUs. Done when the current renderer has numbers for each.",
          {
            milestone: true,
            steps: [
              "Add timestamp queries around the dispatch",
              "Fix the resolution, seed and sample count",
              "Record the first benchmark on the RX 5700 XT and on the Iris Xe, with the commit",
            ],
          },
        ),
        build(
          "harness",
          "Build a compute harness",
          6,
          "A small program with no window: load a compiled shader, fill storage buffers, dispatch, time it with timestamps, read back and print one line of results. This is how a PMPP kernel reaches a real GPU, and the Roadmap's CUDA to Vulkan table says what maps to what. Start with the vector addition from PMPP 2. Done when it adds two large vectors correctly on both GPUs, with times.",
          {
            needs: ["pmpp-2"],
            steps: [
              "Create the device, buffers and compute pipeline, with no window or swapchain",
              "Port vector addition to GLSL and check every element of the result",
              "Add timestamps, and print the GPU, size and time as one line",
              "Run it at several sizes on both GPUs",
            ],
          },
        ),
        build(
          "structure",
          "Split main.cpp into modules",
          6,
          "main.cpp is 853 lines and everything after this adds to it. Separate device setup, swapchain, pipelines and the frame loop. Done when the benchmark and output image are unchanged.",
          {
            steps: [
              "List the seams: device, swapchain, pipelines, frame loop",
              "Move the code with no change in behaviour",
              "Check the benchmark and image still match",
            ],
          },
        ),
        build(
          "reference",
          "Repeatable scenes and reference images",
          5,
          "Choose scenes by command line, render a fixed number of samples and save a PNG, then compare images with RMSE. Done when a change that breaks the image is caught by a number.",
          {
            steps: [
              "Add a scene argument and a fixed sample count",
              "Save the output as a PNG",
              "Compare two images and report the RMSE",
            ],
          },
        ),
        build(
          "divergence",
          "Measure divergence in the path tracer",
          5,
          "Chapter 4 predicts your shader's cost, because two of its loops end at different times for different pixels: the bounce loop's break, and the rejection loop in randomUnitVector. Inside each, count active invocations per subgroup using subgroupBallot and subgroupBallotBitCount, and turn that into SIMD efficiency per bounce. Then swap the rejection loop for a direct formula and see what changes. Done when you can show SIMD efficiency falling bounce by bounce.",
          {
            needs: ["pmpp-4", "r-baseline"],
            steps: [
              "Count active invocations per subgroup in the bounce loop, and report SIMD efficiency per bounce",
              "Do the same for the rejection loop in randomUnitVector",
              "Replace rejection sampling with a direct formula, and compare frame time and image",
              "Record the results on both GPUs, noting each one's subgroup size",
            ],
          },
        ),
        build(
          "machine",
          "Measure each GPU's roofline",
          6,
          "Chapter 5's analysis needs two numbers for each GPU, so measure them rather than trusting a spec sheet. The RX 5700 XT's paper figures are 448 GB/s and about 9.75 TFLOPS at reference clocks, a crossover near 21.8 FLOP/B. Find out how close a compute shader gets, and what the Iris Xe really does. Every later kernel gets placed on this chart. Done when each GPU has a measured bandwidth, compute rate, crossover, subgroup range and shared memory limit.",
          {
            needs: ["r-harness", "pmpp-5"],
            milestone: true,
            steps: [
              "Write a copy kernel over a large buffer, to measure memory bandwidth",
              "Write an arithmetic kernel that barely touches memory, to measure compute throughput",
              "Work out each GPU's crossover in FLOP/B and compare it with the paper figures",
              "Save a card for each GPU: bandwidth, compute rate, crossover, subgroup sizes, shared memory limit",
              "Plot vector addition and tiled matrix multiplication on each GPU's roofline",
            ],
          },
        ),
        build(
          "camera",
          "Movable camera",
          4,
          "The ray origin is fixed in the shader. Pass a camera through push constants or a uniform buffer, and restart accumulation when it moves. Done when you can fly through the scene without smearing.",
          {
            steps: [
              "Pass camera data to the shader",
              "Add keyboard and mouse controls with GLFW",
              "Restart accumulation when the camera moves",
            ],
          },
        ),
      ],
    },
    {
      name: "Scene data: from spheres to meshes",
      units: [
        build(
          "scene-buffer",
          "Move the scene into a storage buffer",
          5,
          "The spheres are hardcoded in the shader. Store them and their materials in a storage buffer, trying an array of structs against a struct of arrays. Upload through a staging copy on the RX 5700 XT, and compare with memory the CPU can write directly on the Iris Xe. Done when scenes change without recompiling the shader, and you know which layout and upload path to use on each GPU.",
          { needs: ["pmpp-6"] },
        ),
        build(
          "materials",
          "Add glass and emissive materials",
          6,
          "Only diffuse and fuzzy metal exist. Add dielectric and light-emitting materials. Done when a glass sphere and an area light match a reference render.",
          { optional: true },
        ),
        build(
          "triangles",
          "Triangle meshes, brute force",
          8,
          "Load a mesh and intersect every triangle using Möller–Trumbore, with no acceleration. This slow number is the one the BVH has to beat, so record it on a few mesh sizes.",
          { milestone: true },
        ),
      ],
    },
    {
      name: "Image passes: the book's patterns on your own output",
      units: [
        build(
          "denoise",
          "Blur, then denoise, the output",
          8,
          "Chapters 7 and 8 on your own image. Start with a plain Gaussian blur, then tile it with shared variables and compare the two on each GPU's roofline. Then turn it into an edge-avoiding à-trous filter, using normals and depth to guide it: repeated sweeps with two buffers, exactly like a stencil. Reference: Dammertz et al., 2010. Done when a low-sample image cleans up visibly and you have recorded the cost and the RMSE against a converged render.",
          { needs: ["pmpp-7", "pmpp-8", "r-reference"] },
        ),
        build(
          "exposure",
          "Auto-exposure from a luminance histogram",
          5,
          "Chapter 9's image histogram, on your own output. Compare one shared histogram using atomics in a storage buffer against a private one per workgroup, merged at the end. Done when the exposure adapts to the scene and you have recorded what privatisation saved on each GPU.",
          { needs: ["pmpp-9"] },
        ),
      ],
    },
    {
      name: "BVH traversal",
      units: [
        build(
          "bvh-cpu",
          "Build a BVH on the CPU with binned SAH",
          10,
          "Build in C++, flatten it to an array and upload it. Done when you can report the SAH cost and build time. Reference: Wald, 2007, on fast SAH construction.",
          { needs: ["r-triangles"] },
        ),
        build(
          "bvh-traverse",
          "Traverse the BVH on the GPU",
          10,
          "Traverse with a small stack in the compute shader and add a heat map of steps per ray. Work out the arithmetic intensity first, since this is memory-bound work on paper. Done when million rays per second clearly beats brute force on the same mesh and GPU.",
          { needs: ["r-bvh-cpu", "pmpp-6"], milestone: true },
        ),
        build(
          "bvh-quality",
          "Compare BVH quality across scenes",
          6,
          "Record SAH cost and average traversal steps per ray on at least five scenes, including an awkward one such as a long thin object. Judge by total frame time, since a quick build can cost traversal speed.",
          { needs: ["r-bvh-traverse"] },
        ),
        build(
          "lbvh-cpu",
          "Build an LBVH from Morton codes on the CPU",
          8,
          "Sort by Morton code and build from there, before attempting it on the GPU. Compare traversal speed with the SAH tree. Reference: Lauterbach et al., 2009.",
          { needs: ["r-bvh-traverse"] },
        ),
        build(
          "gpu-sort",
          "Radix sort in a compute shader",
          12,
          "Port what you built for PMPP 14 to GLSL, with scan built on subgroupInclusiveAdd and reduce-scan-scan across workgroups. Avoid the book's lookback scan: it waits on other workgroups, and Vulkan only gives a limited guarantee that they will make progress. Both LBVH and splat sorting use this, so test it alone first. Compare with AMD's FidelityFX Parallel Sort, which is tuned for your card's architecture. Done when it sorts a million keys correctly on both GPUs, with the times recorded.",
          {
            needs: ["pmpp-11", "pmpp-12", "pmpp-14"],
            milestone: true,
            links: [
              { label: "FidelityFX Parallel Sort", url: "https://github.com/GPUOpen-Effects/FidelityFX-ParallelSort" },
            ],
          },
        ),
        build(
          "lbvh-gpu",
          "Build the LBVH on the GPU",
          14,
          "Build the hierarchy in compute shaders so it can be rebuilt every frame. You need the scene bounds first, from a min and max reduction. Done when build time and traversal speed are recorded. Reference: Karras, 2012.",
          { needs: ["r-gpu-sort", "r-lbvh-cpu", "pmpp-10"] },
        ),
        build(
          "hw-rt",
          "Compare with a driver-built BVH",
          6,
          "Neither of your GPUs has ray tracing hardware. On Linux, the RADV driver can emulate VK_KHR_ray_query with RADV_EXPERIMENTAL=emulate_rt, which compares your traversal with the driver's software version. For a comparison with real hardware, you would need access to a newer GPU.",
          { needs: ["r-bvh-quality"], optional: true },
        ),
        build(
          "wide-bvh",
          "Try a wide BVH",
          8,
          "Collapse to four or eight children per node, and measure. Published results vary by scene, so treat this as an experiment.",
          { needs: ["r-bvh-quality"], optional: true },
        ),
        build(
          "grid",
          "Compare a uniform grid with your BVH",
          6,
          "Chapter 21's cutoff binning is a uniform grid with a fixed cell capacity and an overflow list. Try it on a scene of many small, evenly spread objects, and on one with uneven detail. Done when you can say when each wins.",
          { needs: ["r-bvh-quality", "pmpp-21"], optional: true },
        ),
      ],
    },
    {
      name: "Wavefront path tracing",
      units: [
        build(
          "wavefront",
          "Split the path tracer into wavefront passes",
          14,
          "Replace the single large shader with separate passes for generating rays, intersecting and shading, running over a queue of live rays that you compact after each bounce with a filter. Your divergence numbers from earlier are the baseline. Reference: Laine et al., 2013, Megakernels Considered Harmful. Done when the image matches the old renderer's by RMSE and you have compared frame time and SIMD efficiency on both GPUs.",
          { needs: ["r-divergence", "pmpp-12", "pmpp-18", "r-bvh-traverse"], milestone: true },
        ),
      ],
    },
    {
      name: "Gaussian splatting",
      units: [
        {
          ref: "r-gs-paper",
          name: "Read the 3D Gaussian Splatting paper",
          short: "3DGS paper",
          hours: 3,
          notes: "Kerbl et al., 2023. Focus on the representation and how it renders. Training can wait.",
          steps: PAPER,
        },
        build(
          "gs-load",
          "Load a trained splat scene",
          6,
          "Parse a published .ply scene: positions, scales, rotations, opacity and colour coefficients. Start by drawing them as points. Done when the point cloud looks like the scene.",
          { needs: ["r-gs-paper"] },
        ),
        build(
          "gs-raster",
          "Draw splats as blended ellipses",
          14,
          "Use a graphics pipeline with instanced quads. Project each Gaussian's covariance to a 2×2 screen-space matrix, whose eigenvectors and eigenvalues give the ellipse's axes, and blend with premultiplied alpha. It is a different pipeline from your path tracer because it scatters rather than gathers. Sort on the CPU at first. Done when a scene is recognisable.",
          { needs: ["r-gs-load", "axler-7B", "axler-7E", "pmpp-21"], milestone: true },
        ),
        build(
          "gs-sort",
          "Cull and sort splats on the GPU",
          6,
          "Keep only the splats in view, using a filter, then replace the CPU sort with your compute radix sort. Record the cull, sort and frame times at a fixed view. Done when it runs interactively on the RX 5700 XT.",
          { needs: ["r-gs-raster", "r-gpu-sort"] },
        ),
        build(
          "gs-quality",
          "Measure image quality against the dataset",
          6,
          "Render a held-out view from a published scene and compute PSNR against its photo. Done when you have a number to compare with the paper's, and you can explain the gap.",
          { needs: ["r-gs-raster"] },
        ),
        {
          ref: "r-gs-train",
          name: "Spike: train a splat scene of your own",
          short: "Train splats",
          hours: 12,
          notes:
            "Time box this to a week. Training needs a real NVIDIA GPU, so use a cloud one, plus your own photos and published code. The outcome is a decision on whether training belongs in this project.",
          steps: SPIKE,
          needs: ["r-gs-quality"],
          optional: true,
        },
      ],
    },
    {
      name: "Neural rendering",
      units: [
        {
          ref: "r-nerf-paper",
          name: "Read the NeRF paper",
          short: "NeRF paper",
          hours: 3,
          notes:
            "Mildenhall et al., 2020. Focus on volume rendering and positional encoding. Compare with splats: an implicit scene versus an explicit one.",
          steps: PAPER,
          needs: ["pmpp-19", "pmpp-app-b"],
        },
        build(
          "nerf-tiny",
          "Train a tiny NeRF",
          12,
          "Train a small NeRF on a standard synthetic scene using PyTorch and CUDA. This needs a real NVIDIA GPU, so use a Google Colab GPU runtime or an hourly cloud GPU. Done when novel views render and you have recorded the PSNR and training time.",
          { needs: ["r-nerf-paper"], milestone: true },
        ),
        {
          ref: "r-neural-direction",
          name: "Spike: choose a neural rendering direction",
          short: "Neural direction",
          hours: 15,
          notes:
            "Time box this to two weeks. Candidates: run a small network in a Vulkan compute shader on the RX 5700 XT, a learned denoiser measured against your à-trous filter, a regression denoiser such as BMFR (Koskela et al., 2019), or a hybrid of splats and path tracing. The outcome is a decision, and new milestones for this plan.",
          steps: SPIKE,
          needs: ["r-nerf-tiny", "r-gs-sort"],
        },
      ],
    },
  ],
};
