import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { CENTRE, TWO_HITS } from "@/lib/lab/guide";
import { SCENE, pcgHash, randomSequence } from "@/lib/lab/pathtracer";
import { Arrow, Badge, Box, Figure, Label, Text, TONES } from "./kit";

// The maths inside raytrace.comp, drawn. Every number shown is computed from the
// shader model when the page renders, from the same pixels the guide uses.

const f = (v: number, d = 3) => v.toFixed(d);
const vec = (v: readonly number[], d = 3) => `(${v.map((x) => f(x, d)).join(", ")})`;

/** Seen from above: the eye, the screen one unit ahead, the rays, and where the spheres sit. */
export function Camera() {
  const id = "fig-camera";
  // Top-down: x across, −z up the page. 90 units per scene unit, eye at (230, 330).
  const S = 110;
  const eye = { x: 240, y: 396 };
  const P = (x: number, z: number) => [eye.x + x * S, eye.y + z * S] as const;
  const screenL = P(-4 / 3, -1);
  const screenR = P(4 / 3, -1);
  const mid = P(CENTRE.uv[0], -1);
  const rows: { n: number; label: string; value: string }[] = [
    { n: 1, label: "pixel + jitter", value: `(400, 300) + ${vec(CENTRE.jitter)}` },
    { n: 2, label: "÷ size, 0 to 1", value: vec(CENTRE.uv01, 4) },
    { n: 3, label: "× 2 − 1", value: vec([CENTRE.uv01[0] * 2 - 1, CENTRE.uv01[1] * 2 - 1], 4) },
    { n: 4, label: "x × 800 ÷ 600", value: vec(CENTRE.uv, 4) },
    { n: 5, label: "(u, −v, −1), length 1", value: vec(CENTRE.dir, 4) },
  ];
  return (
    <Figure
      id={id}
      w={1000}
      h={440}
      label="Seen from above, the eye sits at the origin looking down −z at a screen one unit away that runs from −4/3 to 4/3, so the view is about 106 degrees wide. The mirror sphere is straight ahead, the red sphere left, the gold sphere right and nearer. On the right, the centre pixel's numbers at each step from pixel to direction."
    >
      <Text x={20} y={26} className="fill-white text-[14px] font-semibold">
        From above: x across, −z ahead
      </Text>
      {SCENE.slice(0, 3).map((s, i) => {
        const [cx, cy] = P(s.center[0], s.center[2]);
        return (
          <g key={s.name}>
            <circle
              cx={cx}
              cy={cy}
              r={s.radius * S}
              className={
                i === 0
                  ? "fill-white/5 stroke-white/40"
                  : i === 1
                    ? "fill-coral/15 stroke-coral/60"
                    : "fill-sand/15 stroke-sand/60"
              }
              strokeWidth={1.2}
            />
            <Text
              x={cx + (i === 1 ? -s.radius * S - 6 : s.radius * S + 6)}
              y={cy + (i === 1 ? -16 : i === 2 ? 20 : 4)}
              anchor={i === 1 ? "end" : "start"}
              className="fill-neutral-400 text-[11px]"
            >
              {s.name.toLowerCase()}
            </Text>
          </g>
        );
      })}
      <line x1={eye.x} y1={eye.y} x2={screenL[0]} y2={screenL[1]} className="stroke-aqua/50" strokeDasharray="4 4" />
      <line x1={eye.x} y1={eye.y} x2={screenR[0]} y2={screenR[1]} className="stroke-aqua/50" strokeDasharray="4 4" />
      <line x1={screenL[0]} y1={screenL[1]} x2={screenR[0]} y2={screenR[1]} className="stroke-white" strokeWidth={3} />
      {Array.from({ length: 9 }, (_, i) => {
        const x = screenL[0] + ((screenR[0] - screenL[0]) * i) / 8;
        return <line key={i} x1={x} y1={screenL[1] - 4} x2={x} y2={screenL[1] + 4} className="stroke-white/60" />;
      })}
      <Label x={screenR[0] + 8} y={screenR[1] + 4} size={11} anchor="start">
        screen, z = −1
      </Label>
      <Arrow id={id} d={`M ${eye.x} ${eye.y} L ${mid[0]} ${P(0, -1.18)[1]}`} tone="shader" />
      <circle cx={eye.x} cy={eye.y} r={5} className="fill-sand" />
      <Label x={eye.x} y={eye.y + 24} tone="cpu" size={11}>
        eye at (0, 0, 0)
      </Label>
      <path
        d={`M ${eye.x - 34} ${eye.y - 46} A 56 56 0 0 1 ${eye.x + 34} ${eye.y - 46}`}
        fill="none"
        className="stroke-aqua/70"
      />
      <Label x={eye.x + 44} y={eye.y - 40} tone="shader" size={11} anchor="start">
        106° across
      </Label>
      <Badge n={6} x={eye.x - 22} y={eye.y} tone="cpu" />

      <Text x={520} y={26} className="fill-white text-[14px] font-semibold">
        Pixel (400, 300), frame 0
      </Text>
      {rows.map((r, i) => (
        <g key={r.n}>
          <rect
            x={520}
            y={44 + i * 64}
            width={460}
            height={50}
            rx={10}
            className={TONES.shader.box}
            strokeWidth={1.2}
          />
          <Badge n={r.n} x={522} y={46 + i * 64} tone="shader" />
          <Text x={544} y={65 + i * 64} className="fill-neutral-300 text-[12px]">
            {r.label}
          </Text>
          <Text x={544} y={84 + i * 64} className="fill-white text-[14px] font-semibold tabular-nums">
            {r.value}
          </Text>
          {i < rows.length - 1 && <Arrow id={id} d={`M 750 ${94 + i * 64} L 750 ${106 + i * 64}`} tone="shader" />}
        </g>
      ))}
      <Text x={520} y={376} className="fill-neutral-300 text-[12px]">
        y is negated in step 5: pixel rows count down, the scene&apos;s y points up.
      </Text>
      <Text x={520} y={396} className="fill-neutral-300 text-[12px]">
        Jitter moves the sample inside the pixel each frame, which is free anti-aliasing.
      </Text>
      <Text x={520} y={420} className="fill-neutral-400 text-[12px]">
        On the left, the aqua ray is this pixel: straight ahead, into the mirror sphere.
      </Text>
    </Figure>
  );
}

/** The quadratic, three ways a ray meets a sphere, and the numbers for two real pixels. */
export function Intersection() {
  const id = "fig-intersection";
  const C = { x: 190, y: 150, r: 70 };
  const rays = [
    { y: 62, label: "b² − 4ac < 0: misses", tone: "plain" as const },
    { y: C.y - C.r, label: "= 0: touches once", tone: "gpu" as const },
    { y: 172, label: "> 0: in at t₁, out at t₂", tone: "shader" as const },
  ];
  const cross = (y: number) => Math.sqrt(Math.max(0, C.r ** 2 - (y - C.y) ** 2));
  const row = (cells: string[], y: number, head = false, hit = false) => (
    <g key={`${y}-${cells[0]}`}>
      {cells.map((c, i) => (
        <Text
          key={i}
          x={[480, 600, 660, 735, 810, 910][i]}
          y={y}
          className={`${head ? "fill-neutral-400 text-[11.5px]" : hit ? "fill-aqua text-[12.5px] font-semibold" : "fill-neutral-200 text-[12.5px]"} tabular-nums`}
        >
          {c}
        </Text>
      ))}
    </g>
  );
  const table = (title: string, tests: (typeof CENTRE.trips)[0]["tests"], y0: number, n: number) => {
    const nearest = tests.filter((t) => t.t !== null).sort((a, b) => a.t! - b.t!)[0];
    return (
      <g>
        <Text x={480} y={y0} className="fill-white text-[13.5px] font-semibold">
          {title}
        </Text>
        {row(["sphere", "a", "b", "c", "b² − 4ac", "t"], y0 + 22, true)}
        {tests.map((t, i) =>
          row(
            [
              SCENE[t.sphere].name.toLowerCase(),
              f(t.a, 2),
              f(t.b, 3),
              f(t.c, 2),
              f(t.disc, 2),
              t.t === null ? "no hit" : f(t.t, 3),
            ],
            y0 + 42 + i * 20,
            false,
            t === nearest,
          ),
        )}
        <Badge n={n} x={466} y={y0 - 5} tone="shader" />
      </g>
    );
  };
  return (
    <Figure
      id={id}
      w={1000}
      h={470}
      label="A ray meets a sphere where a quadratic in t has a root. Three rays show the discriminant below zero (a miss), zero (a touch) and above zero (two crossings, of which the nearer is kept). Tables give a, b, c, the discriminant and t for each sphere along two real pixels' rays; the nearest hit is highlighted."
    >
      <circle cx={C.x} cy={C.y} r={C.r} className="fill-white/5 stroke-white/40" strokeWidth={1.5} />
      <circle cx={C.x} cy={C.y} r={3} className="fill-neutral-400" />
      <Text x={C.x + 6} y={C.y + 4} className="fill-neutral-400 text-[11px]">
        c
      </Text>
      <line x1={C.x} y1={C.y} x2={C.x - C.r * 0.71} y2={C.y + C.r * 0.71} className="stroke-white/40" />
      <Text x={C.x - 36} y={C.y + 46} className="fill-neutral-400 text-[11px]">
        r
      </Text>
      {rays.map((r, i) => {
        const dx = cross(r.y);
        return (
          <g key={r.label}>
            <Arrow id={id} d={`M 20 ${r.y} L 290 ${r.y}`} tone={r.tone} />
            {dx > 0 && i === 2 && (
              <>
                <circle cx={C.x - dx} cy={r.y} r={4} className="fill-aqua" />
                <circle cx={C.x + dx} cy={r.y} r={4} className="fill-neutral-500" />
                <Label x={C.x - dx - 4} y={r.y + 22} tone="shader" size={11} anchor="end">
                  t₁, kept
                </Label>
                <Label x={C.x + dx + 4} y={r.y + 22} size={11} anchor="start">
                  t₂
                </Label>
              </>
            )}
            {i === 1 && <circle cx={C.x} cy={r.y} r={4} className="fill-lavender" />}
            <Label x={298} y={r.y + 4} tone={r.tone} size={11} anchor="start">
              {r.label}
            </Label>
          </g>
        );
      })}
      <Badge n={4} x={20} y={rays[0].y} tone="shader" />
      <Badge n={5} x={C.x - cross(172)} y={150} tone="shader" />

      <Text x={20} y={276} className="fill-white text-[13.5px] font-semibold">
        Where the quadratic comes from
      </Text>
      <Badge n={1} x={20} y={296} tone="shader" />
      <Text x={40} y={300} className="fill-neutral-200 text-[13px]">
        a point on the ray: p(t) = o + t·d
      </Text>
      <Badge n={2} x={20} y={326} tone="shader" />
      <Text x={40} y={330} className="fill-neutral-200 text-[13px]">
        on the sphere: |p − c|² = r²
      </Text>
      <Badge n={3} x={20} y={356} tone="shader" />
      <Text x={40} y={360} className="fill-neutral-200 text-[13px]">
        put one in the other, with oc = o − c:
      </Text>
      <Text x={40} y={382} className="fill-aqua text-[13px]">
        (d·d) t² + 2(oc·d) t + (oc·oc − r²) = 0
      </Text>
      <Text x={40} y={404} className="fill-neutral-300 text-[12.5px]">
        a t² + b t + c = 0, so t = (−b ± √(b² − 4ac)) ÷ 2a
      </Text>
      <Badge n={6} x={20} y={430} tone="shader" />
      <Text x={40} y={434} className="fill-neutral-300 text-[12.5px]">
        t ≤ 0.001 is ignored: no hitting the surface you left
      </Text>
      <Badge n={7} x={20} y={456} tone="shader" />
      <Text x={40} y={460} className="fill-neutral-300 text-[12.5px]">
        hit point o + t·d; normal (p − c) ÷ r, pointing out
      </Text>

      {table("Pixel (400, 300), first trip: one hit", CENTRE.trips[0].tests, 40, 8)}
      {table("Pixel (240, 370), first trip: two hits, nearest wins", TWO_HITS.trips[0].tests, 200, 8)}
      <Text x={480} y={362} className="fill-neutral-400 text-[12px]">
        a is 1 every time: the direction has length 1, so d·d = 1.
      </Text>
      <Text x={480} y={380} className="fill-neutral-400 text-[12px]">
        The ground is a sphere of radius 100, centred 100.5 below,
      </Text>
      <Text x={480} y={398} className="fill-neutral-400 text-[12px]">
        which is why its c is so large.
      </Text>
    </Figure>
  );
}

/** reflect(), matte scattering and fuzz, the sky, one path's colour, and gamma. */
export function Bounce() {
  const id = "fig-bounce";
  // Reflection: d comes in at 45°, n points up, r leaves at 45°.
  const R = { x: 150, y: 170, len: 100 };
  const k = R.len / Math.SQRT2;
  // Matte: a unit ball sitting on the hit point; sample points from the shader's own hash.
  const M = { x: 470, y: 170, r: 52 };
  const samples = randomSequence(pcgHash(2024), 64);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < samples.length && pts.length < 14; i += 2) {
    const a = samples[i].value * Math.PI * 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  // Gamma chart with d3.
  const gx = scaleLinear().domain([0, 1]).range([760, 970]);
  const gy = scaleLinear().domain([0, 1]).range([500, 340]);
  const xs = Array.from({ length: 51 }, (_, i) => i / 50);
  const curve = (fn: (x: number) => number) =>
    line<number>()
      .x((x) => gx(x))
      .y((x) => gy(fn(x)))(xs) ?? "";
  const srgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  // The centre pixel's path, colour after each trip.
  const swatches = [[1, 1, 1] as const, ...CENTRE.trips.map((t) => t.color)];
  const css = (c: readonly number[]) =>
    `rgb(${c.map((v) => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 255)).join(",")})`;
  const names = [
    "start",
    ...CENTRE.trips.map((t) => (t.hit ? SCENE[t.hit.sphere].name.split(" ")[0].toLowerCase() : "sky")),
  ];
  return (
    <Figure
      id={id}
      w={1000}
      h={530}
      label="Mirror reflection flips the part of the direction along the normal. Matte scattering adds a random point on a unit ball to the normal, so directions near the normal are most likely. Fuzz adds a small random offset to the mirror direction. The sky colour runs from white to light blue by how far up a ray points. The centre pixel's colour drops at each bounce, and the square-root gamma curve is close to sRGB."
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="rgb(255,255,255)" />
          <stop offset="1" stopColor="rgb(181,214,255)" />
        </linearGradient>
      </defs>
      <Text x={20} y={26} className="fill-white text-[14px] font-semibold">
        Metal: reflect(d, n) = d − 2(d·n)n
      </Text>
      <line x1={30} y1={R.y} x2={270} y2={R.y} className="stroke-white/50" strokeWidth={2} />
      <Arrow id={id} d={`M ${R.x - k} ${R.y - k} L ${R.x - 3} ${R.y - 3}`} tone="plain" />
      <Label x={R.x - k - 8} y={R.y - k - 6} size={11}>
        d, coming in
      </Label>
      <Arrow id={id} d={`M ${R.x} ${R.y} L ${R.x} ${R.y - 80}`} tone="gpu" />
      <Label x={R.x + 6} y={R.y - 84} tone="gpu" size={11} anchor="start">
        n
      </Label>
      <Arrow id={id} d={`M ${R.x} ${R.y} L ${R.x + k} ${R.y - k}`} tone="shader" />
      <Label x={R.x + k + 6} y={R.y - k - 6} tone="shader" size={11} anchor="start">
        r, going out
      </Label>
      <line x1={R.x + k} y1={R.y - k} x2={R.x + k} y2={R.y + k * 0} className="stroke-white/30" strokeDasharray="3 3" />
      <Text x={30} y={R.y + 28} className="fill-neutral-300 text-[12px]">
        Keep the part along the surface,
      </Text>
      <Text x={30} y={R.y + 46} className="fill-neutral-300 text-[12px]">
        flip the part along the normal.
      </Text>
      <Badge n={3} x={20} y={46} tone="shader" />

      <Text x={340} y={26} className="fill-white text-[14px] font-semibold">
        Matte: normal + random unit vector
      </Text>
      <line x1={350} y1={M.y} x2={590} y2={M.y} className="stroke-white/50" strokeWidth={2} />
      <circle cx={M.x} cy={M.y - M.r} r={M.r} className="fill-none stroke-aqua/60" strokeDasharray="3 3" />
      <Arrow id={id} d={`M ${M.x} ${M.y} L ${M.x} ${M.y - M.r + 3}`} tone="gpu" />
      {pts.map(([px, py], i) => {
        const tx = M.x + px * M.r;
        const ty = M.y - M.r + py * M.r;
        return (
          <g key={i}>
            <line x1={M.x} y1={M.y} x2={tx} y2={ty} className="stroke-aqua/40" />
            <circle cx={tx} cy={ty} r={2.5} className="fill-aqua" />
          </g>
        );
      })}
      <Text x={350} y={M.y + 28} className="fill-neutral-300 text-[12px]">
        Points on the ball above the hit:
      </Text>
      <Text x={350} y={M.y + 46} className="fill-neutral-300 text-[12px]">
        directions near the normal win most.
      </Text>
      <Badge n={2} x={340} y={46} tone="shader" />

      <Text x={660} y={26} className="fill-white text-[14px] font-semibold">
        Fuzz blurs the mirror
      </Text>
      {[
        { x: 720, fuzz: 0.01, name: "mirror, 0.01" },
        { x: 880, fuzz: 0.3, name: "gold, 0.3" },
      ].map((m) => (
        <g key={m.name}>
          <line x1={m.x - 60} y1={M.y} x2={m.x + 60} y2={M.y} className="stroke-white/50" strokeWidth={2} />
          <Arrow id={id} d={`M ${m.x} ${M.y} L ${m.x + 50} ${M.y - 80}`} tone="shader" />
          <circle
            cx={m.x + 50}
            cy={M.y - 80}
            r={Math.max(2, m.fuzz * 94)}
            className="fill-aqua/10 stroke-aqua/70"
            strokeDasharray="3 3"
          />
          <Text x={m.x} y={M.y + 24} anchor="middle" className="fill-neutral-300 text-[12px]">
            {m.name}
          </Text>
        </g>
      ))}
      <Text x={660} y={M.y + 46} className="fill-neutral-300 text-[12px]">
        mirror direction + fuzz × a random unit vector
      </Text>
      <Badge n={4} x={660} y={46} tone="shader" />

      <Text x={20} y={270} className="fill-white text-[14px] font-semibold">
        The sky: the only light
      </Text>
      <rect x={30} y={290} width={40} height={210} rx={6} fill={`url(#${id}-sky)`} />
      <Text x={80} y={300} className="fill-neutral-300 text-[12px]">
        straight up: (0.5, 0.7, 1)
      </Text>
      <Text x={80} y={398} className="fill-neutral-300 text-[12px]">
        horizon: halfway
      </Text>
      <Text x={80} y={496} className="fill-neutral-300 text-[12px]">
        straight down: white
      </Text>
      <Text x={80} y={430} className="fill-neutral-400 text-[11.5px]">
        t = (y + 1) ÷ 2,
      </Text>
      <Text x={80} y={446} className="fill-neutral-400 text-[11.5px]">
        mix(white, blue, t)
      </Text>
      <Badge n={5} x={20} y={290} tone="shader" />

      <Text x={290} y={270} className="fill-white text-[14px] font-semibold">
        Pixel (400, 300): colour after each trip
      </Text>
      {swatches.map((c, i) => (
        <g key={i}>
          <rect x={290 + i * 70} y={290} width={56} height={56} rx={8} fill={css(c)} className="stroke-white/20" />
          <Text x={318 + i * 70} y={362} anchor="middle" className="fill-neutral-300 text-[11.5px]">
            {names[i]}
          </Text>
          <Text x={318 + i * 70} y={378} anchor="middle" className="fill-neutral-500 text-[10px] tabular-nums">
            {f(c[0], 2)}
          </Text>
          {i < swatches.length - 1 && (
            <Text x={352 + i * 70} y={322} anchor="middle" className="fill-neutral-500 text-[12px]">
              →
            </Text>
          )}
        </g>
      ))}
      <Text x={290} y={410} className="fill-neutral-300 text-[12px]">
        × mirror (0.91), × ground (0.5), × mirror, × ground, × sky.
      </Text>
      <Text
        x={290}
        y={428}
        className="fill-neutral-300 text-[12px]"
      >{`What comes back: ${vec(CENTRE.result.color)}. Swatches are shown after gamma.`}</Text>
      <Badge n={1} x={290} y={290} tone="memory" />
      <Badge n={6} x={290 + (swatches.length - 1) * 70 + 56} y={290} tone="memory" />

      <Text x={760} y={330} className="fill-white text-[14px] font-semibold">
        Gamma
      </Text>
      <line x1={gx(0)} y1={gy(0)} x2={gx(1)} y2={gy(0)} className="stroke-white/40" />
      <line x1={gx(0)} y1={gy(0)} x2={gx(0)} y2={gy(1)} className="stroke-white/40" />
      <path d={curve((x) => x)} fill="none" className="stroke-white/30" strokeDasharray="3 3" />
      <path d={curve(srgb)} fill="none" className="stroke-sand" strokeWidth={1.5} />
      <path d={curve(Math.sqrt)} fill="none" className="stroke-aqua" strokeWidth={2} />
      <Label x={gx(0.1)} y={gy(srgb(0.1)) - 12} tone="cpu" size={11} anchor="end">
        sRGB
      </Label>
      <Label x={gx(0.4)} y={gy(Math.sqrt(0.4)) + 24} tone="shader" size={11} anchor="start">
        √x, yours
      </Label>
      <Label x={gx(0.82)} y={gy(0.82) + 26} size={11} anchor="start">
        none
      </Label>
      <Text x={gx(0.5)} y={520} anchor="middle" className="fill-neutral-400 text-[11px]">
        light in the sum →
      </Text>
      <Badge n={7} x={760} y={350} tone="shader" />
    </Figure>
  );
}

/** From pixel index to seed to draws, the hash itself, and rejection sampling. */
export function RandomNumbers() {
  const id = "fig-random";
  const chain = (frame: number, y: number) => {
    const index = 400 + 300 * 800 + frame * 719393;
    const seed = pcgHash(index >>> 0);
    const draws = randomSequence(seed, 3);
    const boxes = [
      { title: `index ${index.toLocaleString("en-GB")}`, sub: frame ? "240,400 + 719,393" : "400 + 300 × 800" },
      { title: `seed ${seed.toLocaleString("en-GB")}`, sub: "pcgHash(index)" },
      ...draws.map((d, i) => ({
        title: f(d.value, 4),
        sub: i === 0 ? "jitter x" : i === 1 ? "jitter y" : "next draw",
      })),
    ];
    return (
      <g key={frame}>
        <Text x={20} y={y - 12} className="fill-neutral-300 text-[12.5px]">{`Pixel (400, 300), frame ${frame}`}</Text>
        {boxes.map((b, i) => {
          const xs = [20, 186, 382, 488, 594];
          const ws = [150, 180, 92, 92, 92];
          return (
            <g key={i}>
              <Box
                x={xs[i]}
                y={y}
                w={ws[i]}
                h={52}
                tone={i < 2 ? "cpu" : "shader"}
                title={b.title}
                sub={b.sub}
                align="middle"
              />
              {i < boxes.length - 1 && (
                <Arrow id={id} d={`M ${xs[i] + ws[i]} ${y + 26} L ${xs[i + 1] - 4} ${y + 26}`} tone="plain" />
              )}
            </g>
          );
        })}
      </g>
    );
  };
  // Rejection sampling, drawn in 2D with the shader's own hash.
  const sq = { x: 724, y: 60, s: 250 };
  const draws = randomSequence(pcgHash(7), 160);
  const points = Array.from(
    { length: 70 },
    (_, i) => [draws[2 * i].value * 2 - 1, draws[2 * i + 1].value * 2 - 1] as const,
  );
  return (
    <Figure
      id={id}
      w={1000}
      h={430}
      label="A pixel's index and the frame number are hashed into a seed, and each draw hashes it again, so frames 0 and 1 of the same pixel get unrelated numbers. pcgHash is a multiply-add, a data-dependent shift and a multiply. On the right, points drawn in a square are kept only inside the circle, as randomUnitVector keeps points inside the ball."
    >
      {chain(0, 50)}
      {chain(1, 150)}
      <Badge n={1} x={20} y={50} tone="cpu" />
      <Badge n={3} x={382} y={50} tone="shader" />
      <Text x={20} y={232} className="fill-neutral-400 text-[12px]">
        Each arrow is one pcgHash. Same pixel, next frame: a completely different sequence.
      </Text>

      <Text x={20} y={276} className="fill-white text-[13.5px] font-semibold">
        pcgHash, line by line
      </Text>
      <rect x={20} y={290} width={600} height={100} rx={10} className="fill-white/5 stroke-white/15" />
      <Text x={36} y={316} className="fill-neutral-200 text-[13px]">
        state = v × 747796405 + 2891336453
      </Text>
      <Text x={36} y={342} className="fill-neutral-200 text-[13px]">
        word = ((state ≫ ((state ≫ 28) + 4)) ^ state) × 277803737
      </Text>
      <Text x={36} y={368} className="fill-neutral-200 text-[13px]">
        return (word ≫ 22) ^ word
      </Text>
      <Text x={36} y={410} className="fill-neutral-400 text-[12px]">
        All in 32-bit unsigned maths, so every overflow wraps. The shift amount depends on the value.
      </Text>
      <Badge n={2} x={20} y={290} tone="shader" />

      <Text x={sq.x - 20} y={36} className="fill-white text-[13.5px] font-semibold">
        Rejection sampling, drawn in 2D
      </Text>
      <rect x={sq.x} y={sq.y} width={sq.s} height={sq.s} className="fill-white/5 stroke-white/30" />
      <circle cx={sq.x + sq.s / 2} cy={sq.y + sq.s / 2} r={sq.s / 2} className="fill-aqua/5 stroke-aqua/70" />
      {points.map(([px, py], i) => {
        const inside = px * px + py * py <= 1;
        return (
          <circle
            key={i}
            cx={sq.x + ((px + 1) / 2) * sq.s}
            cy={sq.y + ((py + 1) / 2) * sq.s}
            r={3}
            className={inside ? "fill-aqua" : "fill-coral"}
          />
        );
      })}
      <Text x={sq.x} y={sq.y + sq.s + 22} className="fill-neutral-300 text-[12px]">
        Aqua: kept. Coral: outside, try again.
      </Text>
      <Text x={sq.x} y={sq.y + sq.s + 40} className="fill-neutral-300 text-[12px]">
        In 2D the circle fills π/4 of the square;
      </Text>
      <Text x={sq.x} y={sq.y + sq.s + 58} className="fill-neutral-300 text-[12px]">
        in 3D the ball fills π/6 ≈ 52% of the cube.
      </Text>
      <Badge n={5} x={sq.x} y={sq.y} tone="shader" />
    </Figure>
  );
}
