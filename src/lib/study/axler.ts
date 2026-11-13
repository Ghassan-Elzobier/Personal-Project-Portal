// Linear Algebra Done Right, 4th edition, by Sheldon Axler. Open access under CC BY-NC.
// Section titles, printed pages, exercise counts and result numbers were read from
// the official PDF. Printed page + 14 = PDF page.

import type { StudyPlan } from "./plan-types.ts";

const PDF_OFFSET = 14;

const READING_STEPS = [
  "Read with a pencil: try each result before reading its proof",
  "Recall: close the book and write the definitions and key results from memory",
  "Exercises: attempt them before looking anything up, and mark each one below",
  "Explain the main idea out loud, without notes",
];

const QUICK_STEPS = [
  "Read quickly, looking for the facts about zeros of polynomials",
  "Recall: state the fundamental theorem of algebra from memory",
  "Exercises: pick a few and mark each one below",
];

const DONE =
  "Done when you can write the key results from a blank page and have worked a mix of the exercises, including some near the end of the set.";

export const AXLER: StudyPlan = {
  project: "axler",
  mode: "book",
  title: "Linear Algebra Done Right",
  subtitle: "Sheldon Axler, 4th edition",
  guidance:
    "Open access, so every section opens at its page. Proof-based, so the work is in writing proofs yourself. Rereading and highlighting feel productive but do little: recalling from a blank page and spacing it out are what the evidence supports. Chapters 6 and 7 feed the renderer directly, and the Roadmap shows where each section meets PMPP and the renderer.",
  sourceUrl: (page) => `https://linear.axler.net/LADR4e.pdf${page ? `#page=${page + PDF_OFFSET}` : ""}`,
  extraLinks: [{ label: "Axler's videos", url: "https://linear.axler.net/LADRvideos.html" }],
  defaultPerWeek: 2,
  defaultHours: 5,
  unitLabel: "sections",
  sections: [
    {
      name: "Chapter 1: Vector Spaces",
      units: [
        {
          ref: "axler-1A",
          name: "1A Rⁿ and Cⁿ",
          short: "Axler 1A",
          page: 2,
          exercises: 15,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [{ kind: "idea", prompt: "Explain from memory what makes Rⁿ and Cⁿ alike and where they differ." }],
        },
        {
          ref: "axler-1B",
          name: "1B Definition of Vector Space",
          short: "Axler 1B",
          page: 12,
          exercises: 8,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "idea",
              prompt: "State the definition of a vector space from memory, then prove the additive identity is unique.",
            },
          ],
        },
        {
          ref: "axler-1C",
          name: "1C Subspaces",
          short: "Axler 1C",
          page: 18,
          exercises: 24,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 1.45: state and prove “condition for a direct sum” on blank paper." },
          ],
        },
      ],
    },
    {
      name: "Chapter 2: Finite-Dimensional Vector Spaces",
      units: [
        {
          ref: "axler-2A",
          name: "2A Span and Linear Independence",
          short: "Axler 2A",
          page: 28,
          exercises: 20,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 2.19: state and prove “linear dependence lemma” on blank paper." },
            {
              kind: "result",
              prompt:
                "Axler 2.22: state and prove “length of a linearly independent list is at most the length of a spanning list” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-2B",
          name: "2B Bases",
          short: "Axler 2B",
          page: 39,
          exercises: 11,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 2.30: state and prove “every spanning list contains a basis” on blank paper.",
            },
            {
              kind: "result",
              prompt:
                "Axler 2.32: state and prove “every linearly independent list extends to a basis” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-2C",
          name: "2C Dimension",
          short: "Axler 2C",
          page: 44,
          exercises: 20,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 2.34: state and prove “basis length does not depend on basis” on blank paper.",
            },
            { kind: "result", prompt: "Axler 2.43: state and prove “dimension of a sum” on blank paper." },
          ],
        },
      ],
    },
    {
      name: "Chapter 3: Linear Maps",
      units: [
        {
          ref: "axler-3A",
          name: "3A Vector Space of Linear Maps",
          short: "Axler 3A",
          page: 52,
          exercises: 17,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [{ kind: "result", prompt: "Axler 3.4: state and prove “linear map lemma” on blank paper." }],
        },
        {
          ref: "axler-3B",
          name: "3B Null Spaces and Ranges",
          short: "Axler 3B",
          page: 59,
          exercises: 33,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 3.21: state and prove “fundamental theorem of linear maps” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-3C",
          name: "3C Matrices",
          short: "Axler 3C",
          page: 69,
          exercises: 17,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 3.43: state and prove “matrix of product of linear maps” on blank paper.",
            },
            { kind: "result", prompt: "Axler 3.57: state and prove “column rank equals row rank” on blank paper." },
          ],
        },
        {
          ref: "axler-3D",
          name: "3D Invertibility and Isomorphisms",
          short: "Axler 3D",
          page: 82,
          exercises: 24,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 3.65: state and prove “injectivity is equivalent to surjectivity when dim V = dim W” on blank paper.",
            },
            {
              kind: "result",
              prompt:
                "Axler 3.70: state and prove “dimension shows whether vector spaces are isomorphic” on blank paper.",
            },
            { kind: "result", prompt: "Axler 3.84: state and prove “change-of-basis formula” on blank paper." },
          ],
        },
        {
          ref: "axler-3E",
          name: "3E Products and Quotients of Vector Spaces",
          short: "Axler 3E",
          page: 96,
          exercises: 19,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 3.94: state and prove “a sum is a direct sum if and only if dimensions add up” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-3F",
          name: "3F Duality",
          short: "Axler 3F",
          page: 105,
          exercises: 33,
          notes: "Axler lists duality among the material to skip on a fast path. Marked optional here. " + DONE,
          steps: READING_STEPS,
          optional: true,
          reviews: [
            { kind: "result", prompt: "Axler 3.125: state and prove “dimension of the annihilator” on blank paper." },
            { kind: "result", prompt: "Axler 3.133: state and prove “column rank equals row rank” on blank paper." },
          ],
        },
      ],
    },
    {
      name: "Chapter 4: Polynomials",
      units: [
        {
          ref: "axler-4",
          name: "Chapter 4 Polynomials",
          short: "Axler 4",
          page: 119,
          exercises: 14,
          hours: 2,
          notes:
            "Axler suggests this chapter can go quickly, about half an hour, if you are pressed for time. It is mostly background you can return to. " +
            DONE,
          steps: QUICK_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 4.13: state and prove “fundamental theorem of algebra, second version” on blank paper.",
            },
          ],
        },
      ],
    },
    {
      name: "Chapter 5: Eigenvalues and Eigenvectors",
      units: [
        {
          ref: "axler-5A",
          name: "5A Invariant Subspaces",
          short: "Axler 5A",
          page: 133,
          exercises: 43,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 5.7: state and prove “equivalent conditions to be an eigenvalue” on blank paper.",
            },
            {
              kind: "result",
              prompt: "Axler 5.11: state and prove “linearly independent eigenvectors” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-5B",
          name: "5B The Minimal Polynomial",
          short: "Axler 5B",
          page: 143,
          exercises: 29,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 5.19: state and prove “existence of eigenvalues” on blank paper." },
            {
              kind: "result",
              prompt:
                "Axler 5.22: state and prove “existence, uniqueness, and degree of minimal polynomial” on blank paper.",
            },
            {
              kind: "result",
              prompt:
                "Axler 5.27: state and prove “eigenvalues are the zeros of the minimal polynomial” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-5C",
          name: "5C Upper-Triangular Matrices",
          short: "Axler 5C",
          page: 154,
          exercises: 14,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 5.44: state and prove “necessary and sufficient condition for an upper-triangular matrix” on blank paper.",
            },
            {
              kind: "result",
              prompt:
                "Axler 5.47: state and prove “over C, every operator has an upper-triangular matrix” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-5D",
          name: "5D Diagonalizable Operators",
          short: "Axler 5D",
          page: 163,
          exercises: 23,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 5.54: state and prove “sum of eigenspaces is a direct sum” on blank paper.",
            },
            {
              kind: "result",
              prompt: "Axler 5.55: state and prove “conditions equivalent to diagonalizability” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-5E",
          name: "5E Commuting Operators",
          short: "Axler 5E",
          page: 175,
          exercises: 10,
          notes: "Axler lists this section as one to skip on a fast path. Marked optional here. " + DONE,
          steps: READING_STEPS,
          optional: true,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 5.76: state and prove “simultaneous diagonalizability ⟺ commutativity” on blank paper.",
            },
          ],
        },
      ],
    },
    {
      name: "Chapter 6: Inner Product Spaces",
      units: [
        {
          ref: "axler-6A",
          name: "6A Inner Products and Norms",
          short: "Axler 6A",
          page: 182,
          exercises: 35,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 6.14: state and prove “Cauchy–Schwarz inequality” on blank paper." },
            { kind: "result", prompt: "Axler 6.17: state and prove “triangle inequality” on blank paper." },
          ],
        },
        {
          ref: "axler-6B",
          name: "6B Orthonormal Bases",
          short: "Axler 6B",
          page: 197,
          exercises: 23,
          notes: "Renderer: orthonormal bases are how a shader builds tangent frames and cameras. " + DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 6.32: state and prove “Gram–Schmidt procedure” on blank paper." },
            { kind: "result", prompt: "Axler 6.38: state and prove “Schur’s theorem” on blank paper." },
            { kind: "result", prompt: "Axler 6.42: state and prove “Riesz representation theorem” on blank paper." },
          ],
        },
        {
          ref: "axler-6C",
          name: "6C Orthogonal Complements and Minimization Problems",
          short: "Axler 6C",
          page: 211,
          exercises: 23,
          notes: "Renderer: orthogonal projection is the idea behind least-squares fitting. " + DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 6.49: state and prove “direct sum of a subspace and its orthogonal complement” on blank paper.",
            },
            {
              kind: "result",
              prompt: "Axler 6.61: state and prove “minimizing distance to a subspace” on blank paper.",
            },
          ],
        },
      ],
    },
    {
      name: "Chapter 7: Operators on Inner Product Spaces",
      units: [
        {
          ref: "axler-7A",
          name: "7A Self-Adjoint and Normal Operators",
          short: "Axler 7A",
          page: 228,
          exercises: 32,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 7.5: state and prove “properties of the adjoint” on blank paper." },
            {
              kind: "result",
              prompt: "Axler 7.22: state and prove “orthogonal eigenvectors for normal operators” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-7B",
          name: "7B Spectral Theorem",
          short: "Axler 7B",
          page: 243,
          exercises: 25,
          notes:
            "Renderer: a Gaussian splat's 3×3 covariance is symmetric, so this theorem gives its axes. See the splat rasterising milestone. " +
            DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 7.29: state and prove “real spectral theorem” on blank paper." },
            { kind: "result", prompt: "Axler 7.31: state and prove “complex spectral theorem” on blank paper." },
          ],
        },
        {
          ref: "axler-7C",
          name: "7C Positive Operators",
          short: "Axler 7C",
          page: 251,
          exercises: 25,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 7.38: state and prove “characterizations of positive operators” on blank paper.",
            },
            {
              kind: "result",
              prompt:
                "Axler 7.39: state and prove “each positive operator has only one positive square root” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-7D",
          name: "7D Isometries, Unitary Operators, and Matrix Factorization",
          short: "Axler 7D",
          page: 258,
          exercises: 20,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 7.49: state and prove “characterizations of isometries” on blank paper." },
            { kind: "result", prompt: "Axler 7.58: state and prove “QR factorization” on blank paper." },
            { kind: "result", prompt: "Axler 7.63: state and prove “Cholesky factorization” on blank paper." },
          ],
        },
        {
          ref: "axler-7E",
          name: "7E Singular Value Decomposition",
          short: "Axler 7E",
          page: 270,
          exercises: 17,
          notes: "Renderer: the SVD turns a splat's linear transform into its axes and scales. " + DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 7.70: state and prove “singular value decomposition” on blank paper." },
          ],
        },
        {
          ref: "axler-7F",
          name: "7F Consequences of Singular Value Decomposition",
          short: "Axler 7F",
          page: 280,
          exercises: 32,
          notes:
            "Renderer: the volume result explains how a transform scales a splat. The best-approximation result is the idea behind low-rank compression. " +
            DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 7.92: state and prove “best approximation by a linear map of rank at most k” on blank paper.",
            },
            { kind: "result", prompt: "Axler 7.93: state and prove “polar decomposition” on blank paper." },
            {
              kind: "result",
              prompt:
                "Axler 7.111: state and prove “volume changes by the product of the singular values” on blank paper.",
            },
          ],
        },
      ],
    },
    {
      name: "Chapter 8: Operators on Complex Vector Spaces",
      units: [
        {
          ref: "axler-8A",
          name: "8A Generalized Eigenvectors and Nilpotent Operators",
          short: "Axler 8A",
          page: 298,
          exercises: 25,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 8.3: state and prove “null spaces stop growing” on blank paper." },
            {
              kind: "result",
              prompt: "Axler 8.9: state and prove “a basis of generalized eigenvectors” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-8B",
          name: "8B Generalized Eigenspace Decomposition",
          short: "Axler 8B",
          page: 308,
          exercises: 23,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 8.22: state and prove “generalized eigenspace decomposition” on blank paper.",
            },
            { kind: "result", prompt: "Axler 8.29: state and prove “Cayley–Hamilton theorem” on blank paper." },
          ],
        },
        {
          ref: "axler-8C",
          name: "8C Consequences of Generalized Eigenspace Decomposition",
          short: "Axler 8C",
          page: 319,
          exercises: 14,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [{ kind: "result", prompt: "Axler 8.46: state and prove “Jordan form” on blank paper." }],
        },
        {
          ref: "axler-8D",
          name: "8D Trace: A Connection Between Matrices and Operators",
          short: "Axler 8D",
          page: 326,
          exercises: 13,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            { kind: "result", prompt: "Axler 8.49: state and prove “trace of AB equals trace of BA” on blank paper." },
            {
              kind: "result",
              prompt:
                "Axler 8.52: state and prove “on complex vector spaces, trace equals sum of eigenvalues” on blank paper.",
            },
          ],
        },
      ],
    },
    {
      name: "Chapter 9: Multilinear Algebra and Determinants",
      units: [
        {
          ref: "axler-9A",
          name: "9A Bilinear Forms and Quadratic Forms",
          short: "Axler 9A",
          page: 333,
          exercises: 10,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 9.12: state and prove “symmetric bilinear forms are diagonalizable” on blank paper.",
            },
            {
              kind: "result",
              prompt: "Axler 9.23: state and prove “diagonalization of quadratic form” on blank paper.",
            },
          ],
        },
        {
          ref: "axler-9B",
          name: "9B Alternating Multilinear Forms",
          short: "Axler 9B",
          page: 346,
          exercises: 7,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "idea",
              prompt:
                "From a blank page, explain what makes a multilinear form alternating and why that leads to determinants.",
            },
          ],
        },
        {
          ref: "axler-9C",
          name: "9C Determinants",
          short: "Axler 9C",
          page: 354,
          exercises: 21,
          notes: DONE,
          steps: READING_STEPS,
          reviews: [
            {
              kind: "result",
              prompt: "Axler 9.46: state and prove “formula for determinant of a matrix” on blank paper.",
            },
            { kind: "result", prompt: "Axler 9.49: state and prove “determinant is multiplicative” on blank paper." },
          ],
        },
        {
          ref: "axler-9D",
          name: "9D Tensor Products",
          short: "Axler 9D",
          page: 370,
          exercises: 13,
          notes: DONE,
          steps: READING_STEPS,
          optional: true,
          reviews: [
            {
              kind: "result",
              prompt:
                "Axler 9.72: state and prove “dimension of the tensor product of two vector spaces” on blank paper.",
            },
            { kind: "result", prompt: "Axler 9.74: state and prove “basis of a tensor product” on blank paper." },
          ],
        },
      ],
    },
  ],
};
