// A line-by-line model of the renderer's compute shader (shaders/raytrace.comp at
// the commit in guide.ts), so the Lab pages can show what each invocation does:
// how many bounces it runs, where it ends, and how that spreads across a subgroup.
//
// Same scene, same hash, same branches. Random numbers are rounded to 32-bit
// floats as the GPU does, but the geometry runs in double precision, so a path
// can part ways with the GPU's after a few bounces. Counts over many pixels hold.

export const LAMBERTIAN = 0;
export const METAL = 1;

export type Vec3 = [number, number, number];
type Sphere = { center: Vec3; radius: number; albedo: Vec3; material: number; fuzz: number; name: string };

/** hitScene's four spheres, in the shader's order. */
export const SCENE: readonly Sphere[] = [
  { name: "Mirror sphere", center: [0, 0.4, -2], radius: 0.9, albedo: [0.913, 0.921, 0.925], material: METAL, fuzz: 0.01 },
  { name: "Red sphere", center: [-0.6, -0.28, -1], radius: 0.22, albedo: [0.8, 0.25, 0.25], material: LAMBERTIAN, fuzz: 0 },
  { name: "Gold sphere", center: [0.55, -0.32, -0.85], radius: 0.18, albedo: [0.85, 0.65, 0.2], material: METAL, fuzz: 0.3 },
  { name: "Ground", center: [0, -100.5, -1], radius: 100, albedo: [0.5, 0.5, 0.5], material: LAMBERTIAN, fuzz: 0 },
];

export const MAX_BOUNCES = 8;
export const WORKGROUP = 8;

/** The shader's pcgHash, in uint32 arithmetic. */
export function pcgHash(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

class Rng {
  seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = pcgHash(this.seed);
    // float(seed) / 4294967296.0 in 32-bit floats, which can round up to exactly 1.0.
    return Math.fround(Math.fround(this.seed) / 4294967296);
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** randomUnitVector: up to 16 tries at a point inside the unit ball. */
  unitVector(stats?: { tries: number }): Vec3 {
    for (let i = 0; i < 16; i++) {
      const p: Vec3 = [this.range(-1, 1), this.range(-1, 1), this.range(-1, 1)];
      if (stats) stats.tries++;
      const lenSq = dot(p, p);
      if (lenSq > 0.0001 && lenSq <= 1) {
        const s = 1 / Math.sqrt(lenSq);
        return [p[0] * s, p[1] * s, p[2] * s];
      }
    }
    return [0, 1, 0];
  }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const s = 1 / Math.sqrt(dot(a, a));
  return [a[0] * s, a[1] * s, a[2] * s];
};

/** One sphere test, with every number hitSphere works out on the way. */
export type SphereTest = { sphere: number; a: number; b: number; c: number; disc: number; t: number | null };

function hitSphere(origin: Vec3, dir: Vec3, s: Sphere, index: number): { test: SphereTest; point?: Vec3; normal?: Vec3 } {
  const oc: Vec3 = [origin[0] - s.center[0], origin[1] - s.center[1], origin[2] - s.center[2]];
  const a = dot(dir, dir);
  const b = 2 * dot(oc, dir);
  const c = dot(oc, oc) - s.radius * s.radius;
  const disc = b * b - 4 * a * c;
  const test: SphereTest = { sphere: index, a, b, c, disc, t: null };
  if (disc < 0) return { test };
  // Only the nearer root, as in the shader.
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0.001) return { test };
  test.t = t;
  const point: Vec3 = [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]];
  return { test, point, normal: normalize([point[0] - s.center[0], point[1] - s.center[1], point[2] - s.center[2]]) };
}

export type Bounce = { sphere: number; material: number };

export type PathResult = {
  /** Trips through the bounce loop, 1 to 8. */
  iterations: number;
  /** Each hit, in order. A path that escapes has iterations = hits.length + 1. */
  hits: Bounce[];
  /** sky: the ray escaped and picked up the sky colour. limit: still bouncing after 8 hits. */
  ended: "sky" | "limit";
  /** Metal bounces whose new direction pointed into the surface. */
  inward: number;
  /** Points tried by randomUnitVector's rejection loop, over the whole path. */
  unitTries: number;
  /** The colour this sample adds to accumImage, before averaging and sqrt. */
  color: Vec3;
};

/** One trip through the bounce loop, in full. */
export type Trip = {
  origin: Vec3;
  dir: Vec3;
  tests: SphereTest[];
  hit: { sphere: number; t: number; point: Vec3; normal: Vec3 } | null;
  /** On a hit: how the next direction was made. */
  scatter?: { kind: "diffuse" | "metal"; random: Vec3; reflected?: Vec3; next: Vec3; inward: boolean };
  /** On a miss: the sky colour multiplied in. */
  sky?: Vec3;
  /** The path's colour after this trip. */
  color: Vec3;
};

/** Everything main() works out for one pixel, for the worked examples. */
export type Explained = {
  seed: number;
  jitter: [number, number];
  /** (pixel + jitter) / size: 0 to 1 across the image. */
  uv01: [number, number];
  /** Moved to −1..1, then x stretched by the aspect ratio. */
  uv: [number, number];
  dir: Vec3;
  trips: Trip[];
  result: PathResult;
};

function run(x: number, y: number, width: number, height: number, frame: number, record: Trip[] | null) {
  const seed = pcgHash((x + Math.imul(y, width) + Math.imul(frame, 719393)) >>> 0);
  const rng = new Rng(seed);
  const jx = rng.next();
  const jy = rng.next();
  const uv01: [number, number] = [(x + jx) / width, (y + jy) / height];
  const u = (uv01[0] * 2 - 1) * (width / height);
  const v = uv01[1] * 2 - 1;

  let origin: Vec3 = [0, 0, 0];
  let dir = normalize([u, -v, -1]);
  const firstDir = dir;
  const color: Vec3 = [1, 1, 1];
  const hits: Bounce[] = [];
  const stats = { tries: 0 };
  let inward = 0;
  const done = (result: PathResult) => ({ seed, jitter: [jx, jy] as [number, number], uv01, uv: [u, v] as [number, number], dir: firstDir, result });

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    let best: { t: number; point: Vec3; normal: Vec3 } | null = null;
    let index = -1;
    const tests: SphereTest[] = [];
    SCENE.forEach((s, i) => {
      const h = hitSphere(origin, dir, s, i);
      if (record) tests.push(h.test);
      if (h.test.t !== null && (!best || h.test.t < best.t)) {
        best = { t: h.test.t, point: h.point!, normal: h.normal! };
        index = i;
      }
    });
    if (!best) {
      const t = 0.5 * (dir[1] + 1);
      const sky: Vec3 = [1 - t + t * 0.5, 1 - t + t * 0.7, 1];
      color[0] *= sky[0];
      color[1] *= sky[1];
      color[2] *= sky[2];
      record?.push({ origin, dir, tests, hit: null, sky, color: [...color] });
      return done({ iterations: bounce + 1, hits, ended: "sky", inward, unitTries: stats.tries, color });
    }
    const hit = best as { t: number; point: Vec3; normal: Vec3 };
    const s = SCENE[index];
    hits.push({ sphere: index, material: s.material });
    color[0] *= s.albedo[0];
    color[1] *= s.albedo[1];
    color[2] *= s.albedo[2];
    const from = origin;
    const into = dir;
    origin = hit.point;
    const r = rng.unitVector(stats);
    let reflected: Vec3 | undefined;
    let wentIn = false;
    if (s.material === LAMBERTIAN) {
      dir = normalize([hit.normal[0] + r[0], hit.normal[1] + r[1], hit.normal[2] + r[2]]);
    } else {
      const d = dot(dir, hit.normal);
      reflected = [dir[0] - 2 * d * hit.normal[0], dir[1] - 2 * d * hit.normal[1], dir[2] - 2 * d * hit.normal[2]];
      dir = normalize([reflected[0] + s.fuzz * r[0], reflected[1] + s.fuzz * r[1], reflected[2] + s.fuzz * r[2]]);
      wentIn = dot(dir, hit.normal) < 0;
      if (wentIn) inward++;
    }
    record?.push({
      origin: from,
      dir: into,
      tests,
      hit: { sphere: index, ...hit },
      scatter: { kind: s.material === LAMBERTIAN ? "diffuse" : "metal", random: r, reflected, next: dir, inward: wentIn },
      color: [...color],
    });
  }
  return done({ iterations: MAX_BOUNCES, hits, ended: "limit", inward, unitTries: stats.tries, color });
}

/** One invocation of main() for pixel (x, y) of a width × height image on a given frame. */
export function tracePixel(x: number, y: number, width: number, height: number, frame = 0): PathResult {
  return run(x, y, width, height, frame, null).result;
}

/** The same invocation with every intermediate value kept, for the worked examples. */
export function explainPixel(x: number, y: number, width: number, height: number, frame = 0): Explained {
  const trips: Trip[] = [];
  return { ...run(x, y, width, height, frame, trips), trips };
}

/** The first n numbers randomFloat would hand out from a seed. */
export function randomSequence(seed: number, n: number): { state: number; value: number }[] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => {
    const value = rng.next();
    return { state: rng.seed, value };
  });
}

/** The workgroup a pixel falls in, from vkCmdDispatch's (w + 7) / 8 by (h + 7) / 8 grid. */
export function workgroupOf(x: number, y: number) {
  return { gx: Math.floor(x / WORKGROUP), gy: Math.floor(y / WORKGROUP), lx: x % WORKGROUP, ly: y % WORKGROUP };
}

/**
 * The pixels that share a subgroup with (x, y), assuming invocations fill subgroups
 * in gl_LocalInvocationIndex order (lx + 8·ly), which is the usual arrangement. A
 * subgroup of 16 is two rows of the 8×8 tile, 32 is four rows, 64 the whole tile.
 */
export function subgroupPixels(x: number, y: number, size: 8 | 16 | 32 | 64): { x: number; y: number; lane: number }[] {
  const { gx, gy, lx, ly } = workgroupOf(x, y);
  const index = lx + WORKGROUP * ly;
  const first = Math.floor(index / size) * size;
  const out: { x: number; y: number; lane: number }[] = [];
  for (let lane = 0; lane < size; lane++) {
    const i = first + lane;
    out.push({ x: gx * WORKGROUP + (i % WORKGROUP), y: gy * WORKGROUP + Math.floor(i / WORKGROUP), lane });
  }
  return out;
}

export type SubgroupRun = {
  lanes: { x: number; y: number; lane: number; inside: boolean; path: PathResult | null }[];
  /** Trips the subgroup makes through the bounce loop: its slowest lane's. */
  trips: number;
  /** For each trip, the lanes still in the loop, and whether both material branches ran. */
  perTrip: { active: number; lambertian: number; metal: number; both: boolean }[];
  /** Lane-trips that did work, over lanes × trips. PMPP 4.5's SIMD efficiency, for this loop. */
  efficiency: number;
};

/** What one subgroup does in the bounce loop. Lanes past the image edge return at once. */
export function runSubgroup(x: number, y: number, size: 8 | 16 | 32 | 64, width: number, height: number, frame = 0): SubgroupRun {
  const lanes = subgroupPixels(x, y, size).map((p) => {
    const inside = p.x < width && p.y < height;
    return { ...p, inside, path: inside ? tracePixel(p.x, p.y, width, height, frame) : null };
  });
  const trips = Math.max(0, ...lanes.map((l) => l.path?.iterations ?? 0));
  const perTrip = Array.from({ length: trips }, (_, k) => {
    const active = lanes.filter((l) => l.path && l.path.iterations > k);
    // On trip k a lane either escapes (no material branch) or shades hit k.
    const shading = active.map((l) => l.path!.hits[k]).filter(Boolean);
    const lambertian = shading.filter((h) => h.material === LAMBERTIAN).length;
    const metal = shading.filter((h) => h.material === METAL).length;
    return { active: active.length, lambertian, metal, both: lambertian > 0 && metal > 0 };
  });
  const work = lanes.reduce((sum, l) => sum + (l.path?.iterations ?? 0), 0);
  return { lanes, trips, perTrip, efficiency: trips ? work / (size * trips) : 1 };
}

export type FrameStats = {
  pixels: number;
  meanIterations: number;
  meanHits: number;
  /** Share of paths by loop trips, index 0 = 1 trip. */
  histogram: number[];
  hitLimit: number;
  inwardMetal: number;
  meanUnitTries: number;
  /** Mean SIMD efficiency of the bounce loop, per subgroup size. */
  efficiency: Record<8 | 16 | 32 | 64, number>;
};

/** Every pixel of one frame, or every step-th row and column for speed. */
export function frameStats(width: number, height: number, frame = 0, step = 1): FrameStats {
  const sizes = [8, 16, 32, 64] as const;
  const histogram = new Array(MAX_BOUNCES).fill(0);
  let pixels = 0, iterations = 0, hits = 0, limit = 0, inward = 0, tries = 0;
  const eff: Record<number, { sum: number; n: number }> = { 8: { sum: 0, n: 0 }, 16: { sum: 0, n: 0 }, 32: { sum: 0, n: 0 }, 64: { sum: 0, n: 0 } };
  const groupsX = Math.ceil(width / WORKGROUP);
  const groupsY = Math.ceil(height / WORKGROUP);
  for (let gy = 0; gy < groupsY; gy += step) {
    for (let gx = 0; gx < groupsX; gx += step) {
      // Trace the tile once, then group it four ways.
      const tile: (PathResult | null)[] = [];
      for (let i = 0; i < WORKGROUP * WORKGROUP; i++) {
        const x = gx * WORKGROUP + (i % WORKGROUP);
        const y = gy * WORKGROUP + Math.floor(i / WORKGROUP);
        const p = x < width && y < height ? tracePixel(x, y, width, height, frame) : null;
        tile.push(p);
        if (!p) continue;
        pixels++;
        iterations += p.iterations;
        hits += p.hits.length;
        histogram[p.iterations - 1]++;
        if (p.ended === "limit") limit++;
        inward += p.inward;
        tries += p.unitTries;
      }
      for (const size of sizes) {
        for (let first = 0; first < tile.length; first += size) {
          const lanes = tile.slice(first, first + size);
          const trips = Math.max(0, ...lanes.map((p) => p?.iterations ?? 0));
          if (!trips) continue;
          eff[size].sum += lanes.reduce((s, p) => s + (p?.iterations ?? 0), 0) / (size * trips);
          eff[size].n++;
        }
      }
    }
  }
  return {
    pixels,
    meanIterations: iterations / pixels,
    meanHits: hits / pixels,
    histogram: histogram.map((h) => h / pixels),
    hitLimit: limit / pixels,
    inwardMetal: inward,
    meanUnitTries: hits ? tries / hits : 0,
    efficiency: { 8: eff[8].sum / eff[8].n, 16: eff[16].sum / eff[16].n, 32: eff[32].sum / eff[32].n, 64: eff[64].sum / eff[64].n },
  };
}
