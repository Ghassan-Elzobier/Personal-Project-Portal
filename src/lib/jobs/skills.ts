// The skills the tracker looks for in adverts, and which study units teach them.
//
// This is a hand-kept list rather than a published taxonomy, because none of the
// public ones cover this field: ESCO has no Vulkan, CUDA or BVH at all. A skill not
// listed here cannot be seen in an advert, so the Skills page also shows the terms
// adverts keep asking for that are not on this list.
//
// Who you are does not belong here. This file is public, so your evidence lives in
// the database. plans.test.ts-style checks in skills.test.ts hold every unit ref to
// a real unit.

export type SkillGroup =
  | "Graphics"
  | "GPU and performance"
  | "Engines and tools"
  | "Maths"
  | "Machine learning"
  | "3D vision and simulation"
  | "Languages"
  | "Web and data"
  | "Engineering practice";

export type Skill = {
  key: string;
  name: string;
  group: SkillGroup;
  match: RegExp[];
  /** Text that looks like this skill but is not, checked against the same sentence. */
  not?: RegExp;
  /** Units that teach it, earliest first. */
  taughtBy?: string[];
  /** Knowing one of these makes this one much quicker to pick up. Never counts as having it. */
  near?: string[];
  /** Specialist enough that an unknown employer mentioning it is worth a look. */
  core?: boolean;
};

/** Whole words, allowing for names like C++ and C#. Case-insensitive. */
const term = (...words: string[]) => words.map((w) => new RegExp(`(?<![A-Za-z0-9+#])(?:${w})(?![A-Za-z0-9+#])`, "i"));
/** The same, for names that are also ordinary words when not capitalised. */
const exact = (...words: string[]) => words.map((w) => new RegExp(`(?<![A-Za-z0-9+#])(?:${w})(?![A-Za-z0-9+#])`));

export const SKILLS: readonly Skill[] = [
  // Graphics
  { key: "vulkan", name: "Vulkan", group: "Graphics", match: term("vulkan"), taughtBy: ["r-harness", "r-scene-buffer", "r-gs-raster"], near: ["d3d12", "metal", "opengl", "webgpu"], core: true },
  { key: "d3d12", name: "Direct3D 12", group: "Graphics", match: term("d3d1[12]", "dx1[12]", "direct3d", "directx(?: ?1[12])?"), near: ["vulkan", "metal"], core: true },
  { key: "metal", name: "Metal", group: "Graphics", match: exact("Metal"), not: /sheet metal|heavy metal|Metal Gear|Metal (?:fabrication|work)/i, near: ["vulkan", "d3d12"], core: true },
  { key: "opengl", name: "OpenGL", group: "Graphics", match: term("opengl(?: ?es)?"), near: ["vulkan", "webgl"], core: true },
  { key: "webgl", name: "WebGL", group: "Graphics", match: term("webgl2?"), near: ["webgpu", "opengl", "threejs"], core: true },
  { key: "webgpu", name: "WebGPU", group: "Graphics", match: term("webgpu", "wgsl"), near: ["vulkan", "webgl"], core: true },
  { key: "threejs", name: "Three.js", group: "Graphics", match: term("three\\.?js", "babylon\\.?js"), near: ["webgl", "webgpu"], core: true },
  { key: "graphics-apis", name: "Modern graphics APIs", group: "Graphics", match: term("graphics apis?", "rendering apis?", "modern graphics"), taughtBy: ["r-harness", "r-gs-raster"], near: ["vulkan"], core: true },
  { key: "shaders", name: "Shader programming", group: "Graphics", match: term("shaders?", "shading languages?"), taughtBy: ["r-harness", "r-scene-buffer"], core: true },
  { key: "glsl", name: "GLSL", group: "Graphics", match: term("glsl"), taughtBy: ["r-harness"], near: ["hlsl"], core: true },
  { key: "hlsl", name: "HLSL", group: "Graphics", match: term("hlsl"), near: ["glsl"], core: true },
  { key: "real-time-rendering", name: "Real-time rendering", group: "Graphics", match: term("real[- ]?time (?:computer )?(?:graphics|rendering)", "rendering (?:engineer|techniques?|engine|code|algorithms?)", "computer graphics", "graphics programming", "3d graphics"), taughtBy: ["r-gs-raster"], core: true },
  { key: "raster-pipeline", name: "Rasterisation pipeline", group: "Graphics", match: term("rasteri[sz]\\w*", "graphics pipelines?", "render(?:ing)? pipelines?", "render graphs?", "frame graphs?", "gpu[- ]driven"), core: true },
  { key: "deferred", name: "Deferred and forward shading", group: "Graphics", match: term("deferred (?:shading|rendering|lighting)", "forward\\+", "clustered (?:shading|forward)"), near: ["raster-pipeline"], core: true },
  { key: "pbr", name: "Physically based rendering", group: "Graphics", match: term("pbr", "physically[- ]based"), near: ["path-tracing"], core: true },
  { key: "shadows", name: "Shadows and lighting", group: "Graphics", match: term("shadow(?:s| map\\w*)", "lighting (?:models?|systems?|techniques?)"), near: ["raster-pipeline"], core: true },
  { key: "global-illumination", name: "Global illumination", group: "Graphics", match: term("global illumination", "lumen", "ddgi", "restir"), near: ["path-tracing"], core: true },
  { key: "path-tracing", name: "Path tracing", group: "Graphics", match: term("path[- ]?trac\\w*", "monte carlo render\\w*"), taughtBy: ["r-baseline", "r-reference", "r-wavefront"], near: ["ray-tracing"], core: true },
  { key: "ray-tracing", name: "Ray tracing", group: "Graphics", match: term("ray[- ]?trac\\w*", "dxr", "rtx"), taughtBy: ["r-triangles", "r-bvh-traverse", "r-hw-rt"], near: ["path-tracing"], core: true },
  { key: "bvh", name: "BVH and acceleration structures", group: "Graphics", match: term("bvhs?", "bounding volume hierarch\\w*", "acceleration structures?"), taughtBy: ["r-bvh-cpu", "r-bvh-traverse", "r-lbvh-gpu"], core: true },
  { key: "denoising", name: "Denoising and image filters", group: "Graphics", match: term("denois\\w*", "image filter\\w*", "post[- ]processing", "anti[- ]?aliasing", "temporal upscal\\w*"), taughtBy: ["pmpp-7", "r-denoise"], core: true },
  { key: "volumetric", name: "Volumetric rendering", group: "Graphics", match: term("volumetric\\w*", "volume rendering"), taughtBy: ["r-nerf-tiny"], core: true },

  // GPU and performance
  { key: "compute-shaders", name: "Compute shaders", group: "GPU and performance", match: term("compute shaders?", "compute pipelines?", "gpu compute", "async compute"), taughtBy: ["r-harness", "r-gpu-sort", "r-wavefront"], near: ["cuda"], core: true },
  { key: "cuda", name: "CUDA", group: "GPU and performance", match: exact("CUDA"), taughtBy: ["pmpp-setup", "pmpp-2", "pmpp-3", "pmpp-4"], near: ["compute-shaders", "opencl"], core: true },
  { key: "opencl", name: "OpenCL or SYCL", group: "GPU and performance", match: term("opencl", "sycl", "rocm"), near: ["cuda", "compute-shaders"], core: true },
  { key: "gpu-programming", name: "GPU programming", group: "GPU and performance", match: term("gpu (?:programming|development|acceleration|kernels?|architecture|hardware|software)", "gpgpu", "gpu[- ]accelerated", "low[- ]level graphics"), taughtBy: ["pmpp-2", "pmpp-4", "r-harness"], core: true },
  { key: "gpu-performance", name: "GPU performance analysis", group: "GPU and performance", match: term("gpu (?:performance|profiling|optimi[sz]\\w*)", "roofline", "bandwidth analysis"), taughtBy: ["pmpp-5", "pmpp-6", "r-machine"], near: ["profilers"], core: true },
  { key: "parallel-algorithms", name: "Parallel algorithms", group: "GPU and performance", match: term("parallel (?:algorithms?|programming|computing|patterns?)", "data[- ]parallel", "massively parallel"), taughtBy: ["pmpp-3", "pmpp-11", "pmpp-14", "r-gpu-sort"], core: true },
  { key: "simd", name: "SIMD and vectorisation", group: "GPU and performance", match: term("simd", "vectori[sz]ation", "avx(?:2|-?512)?", "neon intrinsics"), taughtBy: ["pmpp-4", "r-divergence"], core: true },
  { key: "hpc", name: "High-performance computing", group: "GPU and performance", match: term("hpc", "high[- ]performance computing", "slurm", "mpi"), taughtBy: ["pmpp-23"], core: true },
  { key: "compilers", name: "GPU compilers", group: "GPU and performance", match: term("llvm", "spir-?v", "shader compilers?", "gpu compilers?"), core: true },
  { key: "profilers", name: "GPU debuggers and profilers", group: "GPU and performance", match: term("renderdoc", "nsight", "radeon gpu profiler", "razor", "gpu capture", "graphics debug\\w*"), taughtBy: ["r-baseline", "r-machine"], core: true },
  { key: "multithreading", name: "Multi-threaded C++", group: "GPU and performance", match: term("multi[- ]?thread\\w*", "concurren\\w*", "lock[- ]free", "parallelism"), core: false },
  { key: "performance", name: "Performance optimisation", group: "GPU and performance", match: term("performance (?:optimi[sz]\\w*|tuning|critical|analysis|engineering)", "optimi[sz]e? (?:for )?performance", "profiling", "low[- ]latency", "high[- ]performance (?:code|systems?|software)"), taughtBy: ["pmpp-6", "r-machine", "r-bvh-quality"] },
  { key: "systems", name: "Low-level systems programming", group: "GPU and performance", match: term("low[- ]level (?:systems?|programming|code|software|engineering)", "memory management", "data[- ]oriented", "cache[- ]friendly", "systems programming", "embedded"), taughtBy: ["pmpp-5", "r-scene-buffer"] },

  // Engines and tools
  { key: "unreal", name: "Unreal Engine", group: "Engines and tools", match: term("unreal(?: engine)?(?: ?[345])?", "ue[45]"), near: ["unity", "engine-dev"], core: true },
  { key: "unity", name: "Unity", group: "Engines and tools", match: exact("Unity(?:3D)?"), near: ["unreal"], core: true },
  { key: "engine-dev", name: "Game engine development", group: "Engines and tools", match: term("(?:game )?engine (?:development|programming|architecture|programmer)", "game engines?", "proprietary engines?", "custom engines?"), near: ["unreal"], core: true },
  { key: "console", name: "Console development", group: "Engines and tools", match: term("console (?:development|programming|profiling|debugging|platforms?|hardware|sdks?)", "playstation", "xbox", "nintendo switch", "rendering code on console"), core: true },
  { key: "blender", name: "Blender", group: "Engines and tools", match: term("blender"), core: true },
  { key: "houdini", name: "Houdini", group: "Engines and tools", match: exact("Houdini"), core: true },
  { key: "dcc-tools", name: "3D content tools", group: "Engines and tools", match: term("3ds? ?max", "maya", "cinema 4d", "dcc tools?", "openusd", "universal scene description"), near: ["blender"], core: true },

  // Maths
  { key: "linear-algebra", name: "Linear algebra", group: "Maths", match: term("linear algebra", "matrix (?:algebra|maths?|theory|computations?)", "eigen(?:values?|vectors?|decomposition)", "singular value decomposition"), taughtBy: ["axler-1A", "axler-3C", "axler-5A", "axler-7E"] },
  { key: "maths-3d", name: "3D maths", group: "Maths", match: term("3d (?:math|maths|mathematics)", "vector (?:math|maths)", "quaternions?", "strong math\\w*", "transformations? and"), taughtBy: ["axler-3A", "axler-6A", "r-camera"], near: ["linear-algebra"] },
  { key: "numerical", name: "Numerical methods", group: "Maths", match: term("numerical (?:methods?|analysis|computing|simulation)", "floating[- ]point"), taughtBy: ["pmpp-app-a", "pmpp-17"] },
  { key: "statistics", name: "Statistics and probability", group: "Maths", match: term("statistic\\w*", "probabilit\\w*", "bayesian") },

  // Machine learning
  { key: "machine-learning", name: "Machine learning", group: "Machine learning", match: term("machine learning", "ml (?:engineering|models?|systems?|research|fundamentals?|pipelines?|infrastructure|frameworks?)"), taughtBy: ["pmpp-app-b", "pmpp-19"], core: true },
  { key: "deep-learning", name: "Deep learning", group: "Machine learning", match: term("deep learning", "neural networks?", "deep neural"), taughtBy: ["pmpp-app-b", "pmpp-19", "r-nerf-tiny"], core: true },
  { key: "pytorch", name: "PyTorch", group: "Machine learning", match: term("pytorch"), taughtBy: ["r-nerf-tiny", "r-gs-train"], near: ["tensorflow"], core: true },
  { key: "tensorflow", name: "TensorFlow or JAX", group: "Machine learning", match: term("tensorflow", "jax"), near: ["pytorch"], core: true },
  { key: "cnn", name: "Convolutional networks", group: "Machine learning", match: term("cnns?", "convolutional(?: neural)?(?: networks?)?"), taughtBy: ["pmpp-19"], core: true },
  { key: "transformers", name: "Transformers", group: "Machine learning", match: term("transformers?"), not: /(?:power|voltage|distribution) transformers?/i, taughtBy: ["pmpp-20"], core: true },
  { key: "diffusion", name: "Diffusion models", group: "Machine learning", match: term("diffusion(?: models?)?"), core: true },
  { key: "generative", name: "Generative models", group: "Machine learning", match: term("generative (?:models?|methods?|3d|modelling)", "gans?"), near: ["diffusion"], core: true },
  { key: "llm", name: "Large language models", group: "Machine learning", match: term("llms?", "large language models?"), taughtBy: ["pmpp-20"], core: true },
  { key: "model-training", name: "Training models", group: "Machine learning", match: term("model training", "training (?:pipelines?|loops?|models?)", "train(?:ing)? (?:and|,)? ?optimi[sz]\\w* models?", "distributed training", "loss functions?"), taughtBy: ["r-nerf-tiny", "r-gs-train"], core: true },
  { key: "ml-inference", name: "ML inference on GPUs", group: "Machine learning", match: term("inference (?:engine|optimi[sz]\\w*|serving|stack|runtime)", "ml inference", "onnx", "tensorrt", "quanti[sz]ation", "model optimi[sz]ation"), taughtBy: ["pmpp-19"], near: ["gpu-performance"], core: true },
  { key: "mlops", name: "MLOps", group: "Machine learning", match: term("mlops", "model (?:serving|deployment|registry)", "experiment tracking"), core: true },
  { key: "papers", name: "Implementing research papers", group: "Machine learning", match: term("research papers?", "implement\\w* (?:research|papers?|state[- ]of[- ]the[- ]art)", "publications?", "published (?:at|in)", "cvpr", "siggraph", "neurips"), taughtBy: ["r-gs-paper", "r-nerf-paper"], core: true },

  // 3D vision and simulation
  { key: "nerf", name: "NeRF and neural rendering", group: "3D vision and simulation", match: term("nerfs?", "neural radiance fields?", "neural rendering", "novel view synthesis"), taughtBy: ["r-nerf-paper", "r-nerf-tiny"], core: true },
  { key: "gaussian-splatting", name: "Gaussian splatting", group: "3D vision and simulation", match: term("(?:3d )?gaussian splat\\w*", "3dgs", "gaussian splats?"), taughtBy: ["r-gs-paper", "r-gs-load", "r-gs-raster", "r-gs-quality"], core: true },
  { key: "reconstruction", name: "3D reconstruction", group: "3D vision and simulation", match: term("3d reconstruction", "structure[- ]from[- ]motion", "sfm", "photogrammetry", "multi[- ]view (?:geometry|stereo)"), near: ["gaussian-splatting"], core: true },
  { key: "camera-geometry", name: "Camera geometry", group: "3D vision and simulation", match: term("camera (?:geometry|models?|calibration)", "epipolar", "depth estimation"), taughtBy: ["r-camera"], near: ["maths-3d"], core: true },
  { key: "geometry", name: "3D geometry and meshes", group: "3D vision and simulation", match: term("point clouds?", "meshes", "mesh processing", "voxels?", "implicit surfaces?", "geometry processing", "3d (?:data|representations?|geometry|processing)", "computational geometry"), taughtBy: ["r-triangles"], core: true },
  { key: "computer-vision", name: "Computer vision", group: "3D vision and simulation", match: term("computer vision", "opencv", "object detection", "image processing", "visual tracking"), taughtBy: ["pmpp-7"], core: true },
  { key: "slam", name: "SLAM", group: "3D vision and simulation", match: exact("SLAM", "visual odometry"), core: true },
  { key: "simulation", name: "Simulation", group: "3D vision and simulation", match: term("simulation (?:software|engine|systems?|environments?)", "physics (?:engine|simulation|based simulation)", "digital twins?", "high[- ]fidelity simulation", "molecular dynamics", "scientific simulation"), taughtBy: ["pmpp-8", "pmpp-21"], core: true },
  { key: "robotics", name: "Robotics", group: "3D vision and simulation", match: term("robotics", "ros2?"), core: true },
  { key: "xr", name: "XR, AR and VR", group: "3D vision and simulation", match: term("xr", "ar/vr", "virtual reality", "augmented reality", "mixed reality", "openxr", "visionos", "arkit"), core: true },
  { key: "geospatial", name: "Mapping and geospatial", group: "3D vision and simulation", match: term("geospatial", "gis", "digital maps?", "mapping (?:software|data|platform)"), core: true },

  // Languages
  { key: "cpp", name: "C++", group: "Languages", match: term("c\\+\\+(?:1[147]|20|23)?", "modern c\\+\\+", "cpp"), taughtBy: ["r-structure", "r-bvh-cpu"], near: ["rust"] },
  { key: "python", name: "Python", group: "Languages", match: term("python"), taughtBy: ["r-nerf-tiny"] },
  { key: "rust", name: "Rust", group: "Languages", match: exact("Rust"), near: ["cpp"] },
  { key: "typescript", name: "TypeScript", group: "Languages", match: term("typescript"), near: ["javascript"] },
  { key: "javascript", name: "JavaScript", group: "Languages", match: term("javascript"), near: ["typescript"] },
  { key: "csharp", name: "C#", group: "Languages", match: term("c#", "\\.net") },
  { key: "java", name: "Java or Kotlin", group: "Languages", match: exact("Java", "Kotlin") },
  { key: "go", name: "Go", group: "Languages", match: exact("Golang", "Go(?= (?:or|and)\\b)", "(?<=(?:or|and|, ) ?)Go") },
  { key: "sql", name: "SQL", group: "Languages", match: term("sql", "postgres(?:ql)?", "relational databases?") },

  // Web and data
  { key: "react", name: "React", group: "Web and data", match: term("react(?:\\.?js)?", "next\\.?js"), not: /react (?:to|quickly|fast)|(?:and|to) react\b/i },
  { key: "node", name: "Node.js", group: "Web and data", match: term("node\\.?js") },
  { key: "python-web", name: "Python web services", group: "Web and data", match: term("fastapi", "django", "flask", "streamlit"), near: ["python"] },
  { key: "apis", name: "Building APIs", group: "Web and data", match: term("rest(?:ful)? apis?", "graphql", "web services?") },
  { key: "data-pipelines", name: "Data pipelines", group: "Web and data", match: term("data (?:pipelines?|workflows?|engineering)", "etl", "airflow", "spark"), near: ["python"] },
  { key: "data-analysis", name: "Data analysis", group: "Web and data", match: term("data analysis", "pandas", "numpy", "scipy", "data visuali[sz]ation", "jupyter") },
  { key: "research-software", name: "Research software", group: "Web and data", match: term("research software", "scientific (?:software|computing|programming)") },

  // Engineering practice
  { key: "git", name: "Git and code review", group: "Engineering practice", match: term("git", "github", "version control", "code reviews?") },
  { key: "testing", name: "Automated testing", group: "Engineering practice", match: term("unit tests?", "automated test\\w*", "test[- ]driven", "ci/cd", "continuous integration", "testing frameworks?") },
  { key: "cloud", name: "Cloud and containers", group: "Engineering practice", match: term("aws", "gcp", "azure", "docker", "kubernetes", "terraform", "cloud (?:infrastructure|platforms?)") },
  { key: "linux", name: "Linux", group: "Engineering practice", match: term("linux", "unix") },
  { key: "build-systems", name: "Build systems", group: "Engineering practice", match: term("cmake", "bazel", "build systems?") },
];

const BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

export function skillByKey(key: string): Skill | undefined {
  return BY_KEY.get(key);
}

/** The skills a stretch of text mentions, in the order they appear. */
export function findSkills(text: string): { skill: Skill; index: number }[] {
  const found: { skill: Skill; index: number }[] = [];
  for (const skill of SKILLS) {
    if (skill.not?.test(text)) continue;
    let best = -1;
    for (const re of skill.match) {
      const at = text.search(re);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best >= 0) found.push({ skill, index: best });
  }
  return found.sort((a, b) => a.index - b.index);
}

export const LEVELS: Record<number, { name: string; meaning: string }> = {
  0: { name: "None yet", meaning: "Nothing to show for this." },
  1: { name: "Studied", meaning: "A unit that teaches it is done, with no practice recorded." },
  2: { name: "Practised", meaning: "Exercises solved, or built in something that is not public." },
  3: { name: "Measured", meaning: "Built, with a recorded result tied to a commit." },
  4: { name: "Public", meaning: "Anyone can see it in your public work." },
};

/**
 * The next big fork in the plan. After phase 3 you choose where to go beyond the
 * fundamentals, and the Skills page shows how many of the roles you care about each
 * way would open up.
 */
export const BRANCHES: readonly { key: string; name: string; why: string; skills: string[] }[] = [
  {
    key: "real-time",
    name: "A real-time raster pipeline in Vulkan",
    why: "What games and engine roles test first. It pairs with your path tracer, which can check its results.",
    skills: ["real-time-rendering", "raster-pipeline", "deferred", "pbr", "shadows", "global-illumination", "multithreading", "engine-dev", "unreal", "d3d12"],
  },
  {
    key: "ml-3d",
    name: "PyTorch and generative 3D, much earlier",
    why: "Brings the neural work forward from phase 8, with training your own splats as the first project.",
    skills: ["pytorch", "deep-learning", "machine-learning", "model-training", "diffusion", "generative", "transformers", "reconstruction", "papers"],
  },
  {
    key: "gpu-compute",
    name: "Stay on the plan: GPU compute and performance",
    why: "The plan's own direction. It needs no new units, and makes the case for compute, HPC and simulation roles.",
    skills: ["gpu-programming", "cuda", "compute-shaders", "parallel-algorithms", "gpu-performance", "hpc", "simd", "simulation"],
  },
];
