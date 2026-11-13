---
paths:
  - "src/lib/study/**"
  - "src/lib/library/**"
  - "src/lib/lab/**"
  - "src/app/study/**"
  - "src/app/lab/**"
  - "src/app/library/**"
  - "scripts/load-book.mjs"
  - "scripts/lab-anchors.mjs"
---

# Study, Lab and book rules

- PMPP is copyrighted: notes are in our own words, never passages from the book,
  and the PDF never enters the repository. `page` values are the PDF's pages.
- The book never mentions ray tracing or Vulkan; links to the renderer are our
  own reading and must say so.
- Lab numbers say where they came from (measured, computed by the shader model,
  from the code, or published). Line links are pinned to a renderer commit:
  after changing the commit, run `npm run lab:anchors`.
- Neither of the owner's GPUs runs CUDA: kernels run on LeetGPU or Colab, and
  timings come from Vulkan ports on the RX 5700 XT and the Iris Xe.
