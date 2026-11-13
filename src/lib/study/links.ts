// Where the three plans meet, and why. A unit's `needs` says what to finish first;
// a link says what the two have to do with each other, whichever comes first. Links
// always cross from one plan to another, and show on both units.
//
// Axler's result numbers come from axler.ts, which read them from the official PDF.
// The book never discusses ray tracing, and rarely proof, so most of these are our
// own connections rather than the authors'. Each is meant to be checked by doing.

export type PlanLink = { a: string; b: string; why: string };

export const LINKS: readonly PlanLink[] = [
  // PMPP and the renderer
  {
    a: "pmpp-2",
    b: "r-harness",
    why: "The same steps in a different API: cudaMalloc becomes a buffer, cudaMemcpy a staging copy, and the kernel launch a dispatch.",
  },
  {
    a: "pmpp-3",
    b: "r-baseline",
    why: "Your shader's 8×8 local size is one of this chapter's 2D blocks. gl_GlobalInvocationID is the block index times the block size, plus the thread index.",
  },
  {
    a: "pmpp-4",
    b: "r-divergence",
    why: "Two loops in your shader exit on per-pixel data, which is what 4.5 says causes divergence. The lab measures on real hardware what the chapter has you count by hand.",
  },
  {
    a: "pmpp-5",
    b: "r-machine",
    why: "5.1 needs a GPU's peak compute rate and bandwidth. The lab replaces spec-sheet numbers with measured ones for both of your GPUs.",
  },
  {
    a: "pmpp-5",
    b: "r-bvh-traverse",
    why: "Testing a node's two child boxes is roughly 40 FLOP for 64 bytes, under 1 FLOP/B and far below your crossover. Ignoring caches, traversal is memory-bound, so node layout should matter more than faster maths. Test that claim.",
  },
  {
    a: "pmpp-6",
    b: "r-scene-buffer",
    why: "An array of structs against a struct of arrays is the data-layout strategy from the checklist (6.8), and your own test of whether coalescing matters on these GPUs.",
  },
  {
    a: "pmpp-app-c",
    b: "r-scene-buffer",
    why: "Zero-copy (C.2) is the same question as mapping memory in Vulkan. The Iris Xe shares RAM with the CPU and the RX 5700 XT sits across PCIe, so the book's warning applies far more to one than the other.",
  },
  {
    a: "pmpp-7",
    b: "r-denoise",
    why: "The blur is this chapter's kernel. Your image borders are its ghost cells, and shared variables in GLSL hold its tiles.",
  },
  {
    a: "pmpp-8",
    b: "r-denoise",
    why: "À-trous filtering sweeps the image several times, reading one buffer and writing another. It is the double-buffered stencil, with a pattern that spreads out on each pass.",
  },
  {
    a: "pmpp-9",
    b: "r-exposure",
    why: "The chapter's running example is an image histogram, so the lab is the same kernel. atomicAdd replaces cuda::atomic_ref, and a private histogram in shared variables is its privatisation.",
  },
  {
    a: "pmpp-9",
    b: "r-bvh-cpu",
    why: "Binned SAH counts primitives into bins along each axis, which is a histogram. It is the natural place to start if you later build on the GPU.",
  },
  {
    a: "pmpp-10",
    b: "r-lbvh-gpu",
    why: "Morton codes need the scene's bounds first, and that is a min and max reduction. Exercise 4 is half of it, and subgroupMin and subgroupMax give you the warp-level step.",
  },
  {
    a: "pmpp-11",
    b: "r-gpu-sort",
    why: "Each radix pass needs a scan. subgroupInclusiveAdd scans inside a subgroup, and reduce-scan-scan (11.9) joins the workgroups across dispatches.",
  },
  {
    a: "pmpp-12",
    b: "r-wavefront",
    why: "After each bounce, the queue of live rays is filtered. Compare the unstable filter using atomics with the stable one: keeping order may help coherence, so measure it.",
  },
  {
    a: "pmpp-12",
    b: "r-gs-sort",
    why: "Culling splats outside the view is a filter, and the sort then has less to do.",
  },
  {
    a: "pmpp-13",
    b: "r-lbvh-gpu",
    why: "Co-rank lets each thread find its own range by binary search over sorted data, with no coordination. Karras's LBVH does the same: each internal node finds its range in the sorted Morton codes on its own.",
  },
  {
    a: "pmpp-14",
    b: "r-gpu-sort",
    why: "The same kernel in GLSL. The choice of radix in 14.7 becomes a real decision: how many passes for 30-bit Morton codes, measured on each GPU.",
  },
  {
    a: "pmpp-17",
    b: "r-bvh-cpu",
    why: "A flat BVH leaf stores a first triangle and a count, which is a CSR row. Fixed-size leaves are the ELL trade-off: wasted padding in exchange for regular access.",
  },
  {
    a: "pmpp-18",
    b: "r-wavefront",
    why: "Both have a queue of work that changes size every step. The frontier is your list of live rays, and the book's fixes for contention and load balance apply.",
  },
  {
    a: "pmpp-21",
    b: "r-gs-raster",
    why: "Your path tracer gathers: each invocation owns a pixel, so it needs no atomics. Splats scatter: each one writes many pixels, which is why this milestone uses blending hardware rather than a compute shader.",
  },
  {
    a: "pmpp-21",
    b: "r-grid",
    why: "Cutoff binning is a uniform grid with a fixed cell capacity, and its overflow list is one answer to what you do with a crowded cell.",
  },
  {
    a: "pmpp-22",
    b: "r-gs-sort",
    why: "Amdahl's law with your own numbers: if the sort takes 20% of a frame, making it infinitely fast gains 25% at most. Measure its share before optimising.",
  },
  {
    a: "pmpp-19",
    b: "r-neural-direction",
    why: "A convolutional layer is your tiled convolution with more channels, so a small denoising network could run as a Vulkan compute shader. That makes it a real candidate here.",
  },
  {
    a: "pmpp-app-b",
    b: "r-nerf-paper",
    why: "NeRF's network is fully connected layers trained by gradient descent, which B.2 and B.4 cover.",
  },
  {
    a: "pmpp-app-a",
    b: "r-triangles",
    why: "Your shader already guards against hitting the surface a ray just left, with t <= 0.001. A.1 to A.4 explain why, and it matters more on meshes.",
  },

  // PMPP and Axler
  {
    a: "pmpp-3",
    b: "axler-3A",
    why: "A blur is a linear map on images, so blur(a·x + b·y) = a·blur(x) + b·blur(y). Axler's definition doubles as a cheap test for your kernel.",
  },
  {
    a: "pmpp-3",
    b: "axler-3C",
    why: "The kernel computes each output as a row times a column. Axler 3.43 explains why that rule is the right one: a matrix product is the matrix of a composition of maps.",
  },
  {
    a: "pmpp-5",
    b: "axler-3C",
    why: "Tiling relies on matrix products working on blocks: multiply submatrices by the same rule and the answer does not change. Check it on paper for 2×2 blocks.",
  },
  {
    a: "pmpp-8",
    b: "axler-5A",
    why: "A sweep applies one linear operator over and over, so eigenvectors only get scaled. The book's sin x on a grid (Fig. 8.1) is one: with zero boundaries, the second-difference stencil multiplies it by (2cos h − 2)/h², about −0.98 at h = π/6. Check it by hand.",
  },
  {
    a: "pmpp-7",
    b: "axler-7F",
    why: "A filter that is a rank-one matrix splits into a horizontal and a vertical pass, cutting the multiplies per pixel from (2r+1)² to 2(2r+1). Axler 7.92 gives the closest rank-one filter to any other. The book does not cover this, so try it on your blur.",
  },
  {
    a: "pmpp-17",
    b: "axler-3C",
    why: "CSR computes each output from a row, and CSC adds up scaled columns. They are the same product, read in the two ways Axler 3C describes.",
  },
  {
    a: "pmpp-17",
    b: "axler-5D",
    why: "Repeated SpMV is power iteration: when one eigenvalue dominates, the vector turns towards its eigenvector. A diagonalisable matrix shows why in a few lines, and a short loop around your kernel lets you watch it.",
  },
  {
    a: "pmpp-17",
    b: "axler-7C",
    why: "17.1 uses conjugate gradients on positive-definite matrices, with one line on what that means. Axler 7C gives the whole idea, including self-adjointness, which conjugate gradients also needs.",
  },
  {
    a: "pmpp-19",
    b: "axler-3C",
    why: "19.3 writes the same linear map as a different matrix product so that it can use fast matrix code. Only the way it is written changes.",
  },
  {
    a: "pmpp-20",
    b: "axler-6A",
    why: "An attention score is an inner product between a query and a key, and S = QKᵀ computes them all at once.",
  },
  {
    a: "pmpp-20",
    b: "axler-7F",
    why: "20.7 shrinks the KV cache with low-rank projections, learned during training. Axler 7.92 says how much any map of rank k can keep.",
  },
  {
    a: "pmpp-app-a",
    b: "axler-7D",
    why: "A.7 needs pivoting to keep Gaussian elimination stable. QR and Cholesky (Axler 7.58 and 7.63) are factorisations often used where stability matters.",
  },

  // Axler and the renderer
  {
    a: "axler-3D",
    b: "r-camera",
    why: "Moving between world and camera coordinates is a change of basis, Axler 3.84.",
  },
  {
    a: "axler-6A",
    b: "r-reference",
    why: "RMSE is the length of the difference between two images, using the norm from Axler 6A, divided by the square root of the pixel count.",
  },
  {
    a: "axler-6B",
    b: "r-camera",
    why: "A look-at camera builds an orthonormal basis from a direction and an up vector, the same idea as Gram–Schmidt, Axler 6.32. Shading frames are built the same way.",
  },
  {
    a: "axler-6C",
    b: "r-materials",
    why: "Your shader's reflect() removes twice the normal part of a direction, and refraction splits a ray into normal and tangent parts. Both are orthogonal decomposition, Axler 6.49.",
  },
  {
    a: "axler-6C",
    b: "r-neural-direction",
    why: "Least squares is orthogonal projection (Axler 6.61). BMFR, a candidate here, fits a small regression per block using QR factorisation (Axler 7.58).",
  },
  {
    a: "axler-7B",
    b: "r-gs-raster",
    why: "A splat's screen-space shape is a symmetric 2×2 matrix. The real spectral theorem (7.29) promises orthonormal eigenvectors, and those are the ellipse's axes.",
  },
  {
    a: "axler-7C",
    b: "r-gs-load",
    why: "A covariance must be a positive operator. Writing it as Σ = AAᵀ guarantees that (7.38), which helps explain why 3DGS stores a rotation and scales rather than Σ itself.",
  },
  {
    a: "axler-7E",
    b: "r-gs-raster",
    why: "The SVD says a linear map sends a sphere to an ellipsoid, with the singular values as its axis lengths. A splat's rotation and scales are that factorisation, already written out.",
  },
  {
    a: "axler-9A",
    b: "r-gs-raster",
    why: "The exponent of a Gaussian is a quadratic form, and a splat's ellipsoid is one of its level sets. Axler 9.23 diagonalises it, long after you have drawn one.",
  },
  {
    a: "axler-9C",
    b: "r-triangles",
    why: "Möller–Trumbore solves a 3×3 system by Cramer's rule, with each determinant written as a scalar triple product. Axler 9C is where determinants are properly defined, long after you have used them.",
  },
];

/** The other end of each link that touches this unit. */
export function linksFor(ref: string): { ref: string; why: string }[] {
  return LINKS.flatMap((l) =>
    l.a === ref ? [{ ref: l.b, why: l.why }] : l.b === ref ? [{ ref: l.a, why: l.why }] : [],
  );
}
