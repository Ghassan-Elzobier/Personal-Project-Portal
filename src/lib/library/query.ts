// Turns a question into search groups for library_search: one group per idea,
// each with every word that can stand for it. PMPP speaks CUDA, and the renderer
// speaks Vulkan and GLSL, so a Vulkan word also searches for the CUDA word the
// book uses. "subgroup ballot" finds the pages on warp votes.

/** Vulkan, GLSL and GPU-vendor words, and the CUDA words PMPP uses for the same thing. */
export const VULKAN_TO_CUDA: Readonly<Record<string, readonly string[]>> = {
  subgroup: ["warp"],
  subgroups: ["warps"],
  "subgroup size": ["warp size"],
  wave: ["warp"],
  waves: ["warps"],
  wavefront: ["warp"],
  wave32: ["warp"],
  wave64: ["warp"],
  workgroup: ["thread block", "block"],
  workgroups: ["thread blocks", "blocks"],
  "work group": ["thread block", "block"],
  "local size": ["block size", "blockdim"],
  local_size_x: ["blockdim"],
  invocation: ["thread"],
  invocations: ["threads"],
  gl_globalinvocationid: ["blockidx", "threadidx"],
  gl_localinvocationid: ["threadidx"],
  gl_workgroupid: ["blockidx"],
  gl_workgroupsize: ["blockdim"],
  gl_numworkgroups: ["griddim"],
  dispatch: ["kernel launch", "grid"],
  vkcmddispatch: ["kernel launch", "grid"],
  shader: ["kernel"],
  "compute shader": ["kernel"],
  shared: ["shared memory"],
  "shared variables": ["shared memory"],
  "workgroup memory": ["shared memory"],
  lds: ["shared memory"],
  barrier: ["__syncthreads", "barrier synchronization"],
  memorybarriershared: ["__syncthreads", "memory fence"],
  subgroupbarrier: ["__syncwarp"],
  subgroupballot: ["ballot", "vote"],
  ballot: ["vote"],
  subgroupshuffle: ["shuffle"],
  subgroupshuffledown: ["shuffle"],
  subgroupadd: ["warp shuffle", "reduction"],
  subgroupinclusiveadd: ["warp shuffle", "scan"],
  "storage buffer": ["global memory"],
  ssbo: ["global memory"],
  "storage image": ["global memory"],
  imagestore: ["global memory"],
  imageload: ["global memory"],
  "uniform buffer": ["constant memory"],
  "push constant": ["constant memory"],
  "push constants": ["constant memory"],
  "device local": ["global memory", "device memory"],
  vram: ["device memory", "global memory"],
  "host visible": ["zero-copy", "pinned memory"],
  "mapped memory": ["zero-copy", "pinned memory"],
  "staging buffer": ["cudamemcpy", "data transfer"],
  vkcmdcopybuffer: ["cudamemcpy"],
  vkcmdcopyimage: ["cudamemcpy"],
  queue: ["stream"],
  "command buffer": ["stream"],
  vkqueuesubmit: ["stream", "kernel launch"],
  fence: ["cudadevicesynchronize", "synchronization"],
  semaphore: ["synchronization", "event"],
  timestamp: ["timing", "cudaevent"],
  "compute unit": ["streaming multiprocessor", "sm"],
  cu: ["streaming multiprocessor", "sm"],
  wgp: ["streaming multiprocessor", "sm"],
  "execution unit": ["streaming multiprocessor", "sm"],
  eu: ["streaming multiprocessor", "sm"],
  vgpr: ["registers"],
  vgprs: ["registers"],
  spill: ["register spilling", "local memory"],
  spills: ["register spilling", "local memory"],
};

/** Words that carry no idea of their own in a question. Postgres drops the usual stop words. */
const FILLER = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "who",
  "does",
  "do",
  "did",
  "is",
  "are",
  "was",
  "explain",
  "describe",
  "tell",
  "me",
  "about",
  "book",
  "pmpp",
  "chapter",
  "section",
  "page",
  "please",
  "mean",
  "means",
  "work",
  "works",
  "use",
  "used",
  "using",
  "i",
  "my",
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "to",
  "and",
  "or",
]);

export type SearchPlan = {
  /** For library_search: one group per idea, each the ways of saying it. */
  groups: string[][];
  /** The Vulkan words that also searched for book words, to show the reader. */
  translated: { from: string; to: string[] }[];
};

const MAX_GROUPS = 12;
const MAX_ALTS = 8;

/** The multi-word keys, longest first, so "compute shader" wins over "shader". */
const PHRASES = Object.keys(VULKAN_TO_CUDA)
  .filter((k) => k.includes(" "))
  .sort((a, b) => b.length - a.length);

export function planSearch(question: string): SearchPlan {
  const groups: string[][] = [];
  const translated: SearchPlan["translated"] = [];
  const seen = new Set<string>();
  const add = (term: string, exact = false) => {
    const key = term.toLowerCase();
    if (!key || seen.has(key) || groups.length >= MAX_GROUPS) return;
    seen.add(key);
    const extra = exact ? [] : (VULKAN_TO_CUDA[key] ?? []);
    if (extra.length) translated.push({ from: term, to: [...extra] });
    groups.push([term, ...extra].slice(0, MAX_ALTS));
  };

  // "Quoted phrases" stay exactly as typed.
  let rest = question.slice(0, 500).replace(/"([^"]{1,80})"/g, (_, phrase: string) => {
    add(phrase.trim(), true);
    return " ";
  });

  let lower = rest.toLowerCase();
  for (const phrase of PHRASES) {
    const at = lower.search(new RegExp(`(^|[^a-z0-9_])${phrase.replace(/ /g, "\\s+")}($|[^a-z0-9_])`));
    if (at < 0) continue;
    add(phrase);
    rest = `${rest.slice(0, at)} ${rest.slice(at + phrase.length + 1)}`;
    lower = rest.toLowerCase();
  }

  for (const word of rest.split(/[^A-Za-z0-9_.+-]+/)) {
    const w = word.replace(/^[.+-]+|[.+-]+$/g, "").replace(/\(\)$/, "");
    if (w.length < 2 && !/^\d$/.test(w)) continue;
    if (FILLER.has(w.toLowerCase())) continue;
    add(w);
  }
  return { groups, translated };
}

export type Excerpt = { text: string; mark: boolean }[];

/** library_search marks matches with \u0001 and \u0002. Split them into plain runs. */
export function splitExcerpt(excerpt: string): Excerpt {
  const out: Excerpt = [];
  for (const [i, part] of excerpt.split(/\u0001|\u0002/).entries()) {
    if (part) out.push({ text: part, mark: i % 2 === 1 });
  }
  return out;
}

/** The excerpt as plain text, with matches in **bold** for Claude. */
export function excerptForClaude(excerpt: string): string {
  return splitExcerpt(excerpt)
    .map((r) => (r.mark ? `**${r.text}**` : r.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
