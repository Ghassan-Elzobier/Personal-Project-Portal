// The Vulkan renderer's road map, starting from what the repo does today: a
// progressive path tracer in one compute shader, with four hardcoded spheres, no
// timing, a fixed camera and no scene buffers. The order is deliberate. Measure
// first, because every later milestone is judged by numbers. BVH comes before
// splats because both depend on GPU sorting, and neural rendering comes last, time
// boxed, because it is the most open-ended.

import type { PlanUnit, StudyPlan } from "./plan-types.ts";

const BUILD = [
  "Write a short design note: the approach, and how you will measure it",
  "Implement it on a branch",
  "Measure it on the standard scenes and record a benchmark with the commit",
  "Save a screenshot or clip, and link it as Evidence",
];
const SPIKE = ["Set the question and a time limit", "Try it", "Write down what you learned and what you decided"];
const PAPER = ["Read for the main idea and the results", "Explain it out loud, without notes", "Write down what you would build first"];

function build(ref: string, name: string, notes: string, extra: Partial<PlanUnit> = {}): PlanUnit {
  return { ref: `r-${ref}`, name, short: name, notes, steps: BUILD, ...extra };
}

export const RENDERING: StudyPlan = {
  project: "rendering",
  mode: "lab",
  title: "Vulkan renderer",
  subtitle: "Compute path tracer, then BVH, Gaussian splats and neural rendering",
  guidance:
    "A milestone counts when its numbers are recorded, not when the code compiles. Log results below with the commit and GPU, because numbers from different GPUs cannot be compared. Your laptop's Iris Xe can run all of the Vulkan work, though the heavy milestones may need a stronger GPU.",
  sourceUrl: () => "https://github.com/Ghassan-Elzobier/Vulkan-Renderer",
  defaultPerWeek: 1,
  unitLabel: "milestones",
  sections: [
    {
      name: "Foundations: make progress measurable",
      units: [
        build("baseline", "Measure the baseline", "The shader has no timing yet. Add GPU timestamp queries around the dispatch, then record ms per frame and million rays per second at a fixed resolution, sample count and seed. Done when the current renderer has numbers.", { milestone: true, steps: ["Add timestamp queries around the dispatch", "Fix the resolution, seed and sample count", "Record the first benchmark with the commit"] }),
        build("structure", "Split main.cpp into modules", "main.cpp is 853 lines and everything after this adds to it. Separate device setup, swapchain, pipelines and the frame loop. Done when the benchmark and output image are unchanged.", { steps: ["List the seams: device, swapchain, pipelines, frame loop", "Move the code with no change in behaviour", "Check the benchmark and image still match"] }),
        build("reference", "Repeatable scenes and reference images", "Choose scenes by command line, render a fixed number of samples and save a PNG, then compare images with RMSE. Done when a change that breaks the image is caught by a number.", { steps: ["Add a scene argument and a fixed sample count", "Save the output as a PNG", "Compare two images and report the RMSE"] }),
        build("camera", "Movable camera", "The ray origin is fixed in the shader. Pass a camera through push constants or a uniform buffer, and restart accumulation when it moves. Done when you can fly through the scene without smearing.", { steps: ["Pass camera data to the shader", "Add keyboard and mouse controls with GLFW", "Restart accumulation when the camera moves"] }),
      ],
    },
    {
      name: "Scene data: from spheres to meshes",
      units: [
        build("scene-buffer", "Move the scene into a storage buffer", "The spheres are hardcoded in the shader. Store them and their materials in a storage buffer. Done when scenes change without recompiling the shader, and timing has not regressed.", { needs: ["pmpp-5"] }),
        build("materials", "Add glass and emissive materials", "Only diffuse and fuzzy metal exist. Add dielectric and light-emitting materials. Done when a glass sphere and an area light match a reference render.", { optional: true }),
        build("triangles", "Triangle meshes, brute force", "Load a mesh and intersect every triangle using Möller–Trumbore, with no acceleration. This slow number is the one the BVH has to beat, so record it on a few mesh sizes.", { milestone: true }),
      ],
    },
    {
      name: "BVH traversal",
      units: [
        build("bvh-cpu", "Build a BVH on the CPU with binned SAH", "Build in C++, flatten it to an array and upload it. Done when you can report the SAH cost and build time. Reference: Wald, 2007, on fast SAH construction.", { needs: ["r-triangles", "pmpp-10"] }),
        build("bvh-traverse", "Traverse the BVH on the GPU", "Traverse with a small stack in the compute shader and add a heat map of steps per ray. Done when million rays per second clearly beats brute force on the same mesh and GPU.", { needs: ["r-bvh-cpu", "pmpp-5"], milestone: true }),
        build("bvh-quality", "Compare BVH quality across scenes", "Record SAH cost and average traversal steps per ray on at least five scenes, including an awkward one such as a long thin object. Judge by total frame time, since a quick build can cost traversal speed.", { needs: ["r-bvh-traverse"] }),
        build("lbvh-cpu", "Build an LBVH from Morton codes on the CPU", "Sort by Morton code and build from there, before attempting it on the GPU. Compare traversal speed with the SAH tree. Reference: Lauterbach et al., 2009.", { needs: ["r-bvh-traverse", "pmpp-13"] }),
        build("gpu-sort", "Radix sort in a compute shader", "Port what you built for PMPP 13 to GLSL. Both LBVH and splat sorting use it, so test it alone first. Done when it sorts a million keys correctly, with the time recorded.", { needs: ["pmpp-11", "pmpp-13"], milestone: true }),
        build("lbvh-gpu", "Build the LBVH on the GPU", "Build the hierarchy in compute shaders so it can be rebuilt every frame. Done when build time and traversal speed are recorded. Reference: Karras, 2012.", { needs: ["r-gpu-sort", "r-lbvh-cpu"] }),
        build("hw-rt", "Compare with hardware ray tracing", "If your GPU supports it, render the same scene with VK_KHR_ray_query. It shows how far your BVH is from the driver's.", { needs: ["r-bvh-quality"], optional: true }),
        build("wide-bvh", "Try a wide BVH", "Collapse to four or eight children per node, and measure. Published results vary by scene, so treat this as an experiment.", { needs: ["r-bvh-quality"], optional: true }),
      ],
    },
    {
      name: "Gaussian splatting",
      units: [
        { ref: "r-gs-paper", name: "Read the 3D Gaussian Splatting paper", short: "3DGS paper", notes: "Kerbl et al., 2023. Focus on the representation and how it renders. Training can wait.", steps: PAPER },
        build("gs-load", "Load a trained splat scene", "Parse a published .ply scene: positions, scales, rotations, opacity and colour coefficients. Start by drawing them as points. Done when the point cloud looks like the scene.", { needs: ["r-gs-paper"] }),
        build("gs-raster", "Draw splats as blended ellipses", "Use a graphics pipeline with instanced quads. Project each Gaussian's covariance to a screen-space ellipse, blending with premultiplied alpha. It is a different pipeline from your path tracer. Sort on the CPU at first. Done when a scene is recognisable.", { needs: ["r-gs-load", "axler-7B", "axler-7E"], milestone: true }),
        build("gs-sort", "Sort splats on the GPU", "Replace the CPU sort with your compute radix sort. Record the sort time and frame time at a fixed view. Done when it runs interactively on your target GPU.", { needs: ["r-gs-raster", "r-gpu-sort"] }),
        build("gs-quality", "Measure image quality against the dataset", "Render a held-out view from a published scene and compute PSNR against its photo. Done when you have a number to compare with the paper's, and you can explain the gap.", { needs: ["r-gs-raster"] }),
        { ref: "r-gs-train", name: "Spike: train a splat scene of your own", short: "Train splats", notes: "Time box this to a week. Training needs a real NVIDIA GPU, so use a cloud one, plus your own photos and published code. The outcome is a decision on whether training belongs in this project.", steps: SPIKE, needs: ["r-gs-quality"], optional: true },
      ],
    },
    {
      name: "Neural rendering",
      units: [
        { ref: "r-nerf-paper", name: "Read the NeRF paper", short: "NeRF paper", notes: "Mildenhall et al., 2020. Focus on volume rendering and positional encoding. Compare with splats: an implicit scene versus an explicit one.", steps: PAPER, needs: ["pmpp-18"] },
        build("nerf-tiny", "Train a tiny NeRF", "Train a small NeRF on a standard synthetic scene using PyTorch and CUDA. This needs a real NVIDIA GPU, so use a Google Colab GPU runtime or an hourly cloud GPU. Done when novel views render and you have recorded the PSNR and training time.", { needs: ["r-nerf-paper"], milestone: true }),
        { ref: "r-neural-direction", name: "Spike: choose a neural rendering direction", short: "Neural direction", notes: "Time box this to two weeks. Candidates: run a small network in a Vulkan compute shader, a learned denoiser for the path tracer, or a hybrid of splats and path tracing. The outcome is a decision, and new milestones for this plan.", steps: SPIKE, needs: ["r-nerf-tiny", "r-gs-sort"] },
      ],
    },
  ],
};
