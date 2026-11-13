import { scaleLinear, scaleLog } from "d3-scale";
import { area, line } from "d3-shape";
import { tracePixel } from "@/lib/lab/pathtracer";
import { achieved, type GpuResult } from "@/lib/lab/results";
import { Arrow, Badge, Box, Figure, Label, Text, TONES } from "./kit";

// The GPU side of the renderer: how the dispatch is cut up, what one invocation
// does, where its bytes go and how frames add up. Numbers come from guide.ts or
// are computed here from the shader model, never typed in by hand.

/** 800 × 600 pixels to 7,500 workgroups, one workgroup to 4 subgroups, one subgroup to 16 lanes. */
export function Dispatch() {
  const id = "fig-dispatch";
  const img = { x: 20, y: 70, w: 300, h: 225 }; // 0.375 units per pixel, 3 per workgroup
  const wg = { gx: 50, gy: 37 };
  const hx = img.x + wg.gx * 3;
  const hy = img.y + wg.gy * 3;
  const tile = { x: 390, y: 70, cell: 24 };
  const lanes = { x: 712, y: 112, cell: 16.5 };
  return (
    <Figure
      id={id}
      w={1000}
      h={470}
      label="The 800 by 600 image is a grid of 100 by 75 workgroups. Workgroup (50, 37) has 64 invocations numbered x + 8y; at 16 wide they form four subgroups of two rows each, and each subgroup is 16 lanes running one instruction stream."
    >
      <Text x={img.x} y={50} className="fill-white text-sm font-semibold">
        The image: 100 × 75 workgroups
      </Text>
      <rect x={img.x} y={img.y} width={img.w} height={img.h} className="fill-white/5 stroke-white/30" strokeWidth={1} />
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={img.x + (i + 1) * 30}
          y1={img.y}
          x2={img.x + (i + 1) * 30}
          y2={img.y + img.h}
          className="stroke-white/10"
        />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <line
          key={`h${i}`}
          x1={img.x}
          y1={img.y + (i + 1) * 30}
          x2={img.x + img.w}
          y2={img.y + (i + 1) * 30}
          className="stroke-white/10"
        />
      ))}
      <rect x={hx - 1.5} y={hy - 1.5} width={6} height={6} className="fill-aqua stroke-aqua" />
      <line x1={hx + 4.5} y1={hy - 1.5} x2={tile.x} y2={tile.y} className="stroke-aqua/50" strokeDasharray="3 3" />
      <line
        x1={hx + 4.5}
        y1={hy + 4.5}
        x2={tile.x}
        y2={tile.y + 8 * tile.cell}
        className="stroke-aqua/50"
        strokeDasharray="3 3"
      />
      <Text x={img.x} y={img.y + img.h + 20} className="fill-muted text-xs">
        Lines every 10 workgroups. Highlighted: (50, 37).
      </Text>
      <Text x={img.x} y={img.y + img.h + 38} className="fill-muted text-xs">
        (800 + 7) / 8 rounds up, so no edge is missed;
      </Text>
      <Text x={img.x} y={img.y + img.h + 54} className="fill-muted text-xs">
        invocations past it return at line 123.
      </Text>
      <Badge n={1} x={img.x} y={img.y} tone="gpu" />
      <Badge n={4} x={img.x + img.w} y={img.y + img.h} tone="shader" />

      <Text x={tile.x} y={50} className="fill-white text-sm font-semibold">
        One workgroup: 8 × 8 = 64 invocations
      </Text>
      {Array.from({ length: 64 }, (_, i) => {
        const cx = i % 8;
        const cy = Math.floor(i / 8);
        const sub = Math.floor(i / 16);
        return (
          <g key={i}>
            <rect
              x={tile.x + cx * tile.cell}
              y={tile.y + cy * tile.cell}
              width={tile.cell - 2}
              height={tile.cell - 2}
              rx={3}
              className={sub % 2 ? "fill-lavender/25 stroke-lavender/60" : "fill-aqua/15 stroke-aqua/60"}
              strokeWidth={1}
            />
            <Text
              x={tile.x + cx * tile.cell + 11}
              y={tile.y + cy * tile.cell + 15}
              anchor="middle"
              className="fill-bright text-3xs tabular-nums"
            >
              {String(i)}
            </Text>
          </g>
        );
      })}
      {[0, 1, 2, 3].map((s) => (
        <Text
          key={s}
          x={tile.x + 8 * tile.cell + 8}
          y={tile.y + s * 2 * tile.cell + tile.cell + 4}
          className={s % 2 ? `${TONES.gpu.text} text-2xs` : "fill-aqua text-2xs"}
        >{`subgroup ${s}`}</Text>
      ))}
      <Text x={tile.x} y={tile.y + 8 * tile.cell + 20} className="fill-muted text-xs">
        The number in each cell is x + 8y,
      </Text>
      <Text x={tile.x} y={tile.y + 8 * tile.cell + 36} className="fill-muted text-xs">
        the order subgroups fill in.
      </Text>
      <Badge n={2} x={tile.x} y={tile.y} tone="shader" />
      <Badge n={5} x={tile.x + 8 * tile.cell + 4} y={tile.y + 8 * tile.cell + 8} tone="gpu" />

      <Text x={lanes.x} y={50} className="fill-white text-sm font-semibold">
        One subgroup: 16 lanes
      </Text>
      <Text x={lanes.x} y={70} className="fill-muted text-xs">
        as Mesa compiled it for the Iris Xe
      </Text>
      {Array.from({ length: 16 }, (_, i) => (
        <g key={i}>
          <rect
            x={lanes.x + i * lanes.cell}
            y={lanes.y}
            width={lanes.cell - 2}
            height={30}
            rx={3}
            className="fill-aqua/15 stroke-aqua/70"
            strokeWidth={1}
          />
          <Text
            x={lanes.x + i * lanes.cell + 8}
            y={lanes.y + 19}
            anchor="middle"
            className="fill-bright text-3xs tabular-nums"
          >
            {String(i)}
          </Text>
        </g>
      ))}
      <path
        d={`M ${lanes.x} ${lanes.y + 38} l 0 6 l ${8 * lanes.cell - 4} 0 l 0 -6 M ${lanes.x + 8 * lanes.cell} ${lanes.y + 38} l 0 6 l ${8 * lanes.cell - 4} 0 l 0 -6`}
        fill="none"
        className="stroke-muted"
      />
      <Text x={lanes.x + 4 * lanes.cell} y={lanes.y + 60} anchor="middle" className="fill-body text-2xs">
        tile row 0
      </Text>
      <Text x={lanes.x + 12 * lanes.cell} y={lanes.y + 60} anchor="middle" className="fill-body text-2xs">
        tile row 1
      </Text>
      <Text x={lanes.x} y={lanes.y + 92} className="fill-bright text-xs">
        One instruction stream for all 16.
      </Text>
      <Text x={lanes.x} y={lanes.y + 110} className="fill-bright text-xs">
        Each lane keeps its own seed, ray
      </Text>
      <Text x={lanes.x} y={lanes.y + 128} className="fill-bright text-xs">
        and colour, for its own pixel.
      </Text>
      <Badge n={6} x={lanes.x - 16} y={lanes.y + 15} tone="shader" />

      <Text x={lanes.x} y={lanes.y + 168} className="fill-white text-sm font-semibold">
        On the RX 5700 XT (Linux driver)
      </Text>
      {[
        { rows: 8, label: "64: what it compiles" },
        { rows: 4, label: "32: if you ask" },
      ].map((m, k) => (
        <g key={m.label}>
          {Array.from({ length: 64 }, (_, i) => (
            <rect
              key={i}
              x={lanes.x + k * 140 + (i % 8) * 9}
              y={lanes.y + 182 + Math.floor(i / 8) * 9}
              width={8}
              height={8}
              rx={1}
              className={Math.floor(i / 8) < m.rows ? "fill-aqua/50" : "fill-white/10"}
            />
          ))}
          <Text x={lanes.x + k * 140} y={lanes.y + 272} className="fill-body text-2xs">
            {m.label}
          </Text>
        </g>
      ))}

      <rect x={20} y={414} width={960} height={36} rx={8} className="fill-white/5 stroke-white/15" />
      <Text x={44} y={437} className="fill-white text-xs">
        gl_GlobalInvocationID = gl_WorkGroupID × 8 + gl_LocalInvocationID
      </Text>
      <Text x={560} y={437} className={`${TONES.shader.text} text-xs`}>
        CUDA: blockIdx.x × blockDim.x + threadIdx.x
      </Text>
      <Badge n={3} x={20} y={414} tone="shader" />
    </Figure>
  );
}

/** main() as a flow, beside hitSphere drawn to scale. */
export function Invocation() {
  const id = "fig-invocation";
  // A ray from O meeting a circle of radius 100 at C, solved exactly like hitSphere.
  const O = [610, 110];
  const C = [830, 250];
  const R = 95;
  const len = Math.hypot(1, 0.45);
  const d = [1 / len, 0.45 / len];
  const oc = [O[0] - C[0], O[1] - C[1]];
  const b = 2 * (oc[0] * d[0] + oc[1] * d[1]);
  const c = oc[0] ** 2 + oc[1] ** 2 - R * R;
  const disc = Math.sqrt(b * b - 4 * c);
  const t1 = (-b - disc) / 2;
  const t2 = (-b + disc) / 2;
  const P1 = [O[0] + t1 * d[0], O[1] + t1 * d[1]];
  const P2 = [O[0] + t2 * d[0], O[1] + t2 * d[1]];
  const n = [(P1[0] - C[0]) / R, (P1[1] - C[1]) / R];
  const dn = d[0] * n[0] + d[1] * n[1];
  const refl = [d[0] - 2 * dn * n[0], d[1] - 2 * dn * n[1]];
  const lobe = [P1[0] + n[0] * 34, P1[1] + n[1] * 34];
  const p = (v: number[]) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`;
  const flow = 40;
  const fw = 300;
  return (
    <Figure
      id={id}
      w={1000}
      h={600}
      label="main() as a flow: pick the pixel, seed, cast a jittered camera ray, then up to eight trips that test four spheres, multiply in a colour and scatter, and finally add to the running sum and show the average. Beside it, hitSphere solves a quadratic and keeps only the nearer root."
    >
      <Box x={flow} y={20} w={fw} h={42} tone="shader" n={1} title="Which pixel? Leave if outside" />
      <Box x={flow} y={82} w={fw} h={42} tone="shader" n={2} title="Seed from pixel and frame" />
      <Box x={flow} y={144} w={fw} h={42} tone="shader" n={3} title="Ray through a random point in the pixel" />
      <Arrow id={id} d={`M 190 62 L 190 78`} tone="shader" />
      <Arrow id={id} d={`M 190 124 L 190 140`} tone="shader" />
      <Arrow id={id} d={`M 190 186 L 190 226`} tone="shader" />

      <rect
        x={14}
        y={206}
        width={546}
        height={244}
        rx={12}
        className="fill-none stroke-white/25"
        strokeDasharray="5 4"
      />
      <Label x={548} y={222} anchor="end" tone="plain">
        bounce loop, up to 8 trips
      </Label>
      <Box x={flow} y={230} w={fw} h={42} tone="shader" n={4} title="hitScene: 4 spheres, nearest hit" />
      <Box x={380} y={230} w={164} h={42} tone="display" n={5} title="Miss: × sky, leave" />
      <Arrow id={id} d="M 340 251 L 376 251" tone="display" />
      <Text x={358} y={290} anchor="middle" className="fill-orchid text-2xs">
        no hit
      </Text>
      <Box x={flow} y={300} w={fw} h={42} tone="shader" n={6} title="Hit: × the sphere's colour" />
      <Arrow id={id} d="M 190 272 L 190 296" tone="shader" />
      <Box
        x={flow}
        y={366}
        w={142}
        h={64}
        tone="shader"
        title="Diffuse"
        sub="normal + random"
        note="red sphere, ground"
        align="middle"
      />
      <Box
        x={flow + 158}
        y={366}
        w={142}
        h={64}
        tone="shader"
        title="Metal"
        sub="mirror + fuzz × random"
        note="mirror, gold"
        align="middle"
      />
      <Arrow id={id} d="M 150 342 L 111 362" tone="shader" />
      <Arrow id={id} d="M 230 342 L 269 362" tone="shader" />
      <Box
        x={380}
        y={370}
        w={164}
        h={56}
        tone="shader"
        n={7}
        title="Random unit vector"
        sub="1.91 tries on average"
        dashed
      />
      <path d="M 380 398 L 340 398" className="stroke-aqua/60" strokeDasharray="3 3" />
      <path
        d="M 111 430 L 111 440 L 28 440 L 28 251 L 36 251"
        fill="none"
        className="stroke-aqua"
        strokeWidth={1.6}
        markerEnd={`url(#${id}-shader)`}
      />
      <path d="M 269 430 L 269 440 L 111 440" fill="none" className="stroke-aqua" strokeWidth={1.6} />
      <Label x={28} y={340} tone="shader" size={11}>
        next
      </Label>

      <Box x={flow} y={476} w={fw} h={42} tone="memory" n={8} title="Add to the running sum" />
      <Box x={flow} y={540} w={fw} h={42} tone="memory" n={9} title="Show √(sum ÷ frames)" />
      <Arrow id={id} d="M 544 251 L 578 251 L 578 497 L 344 497" tone="display" />
      <Arrow id={id} d="M 190 450 L 190 472" tone="shader" label="after the 8th" at={[250, 462]} />
      <Arrow id={id} d="M 190 518 L 190 536" tone="memory" />

      <Text x={600} y={30} className="fill-white text-sm font-semibold">
        hitSphere, to scale
      </Text>
      <Text x={600} y={50} className="fill-muted text-xs">
        t solves |o + t·d − c|² = r², a quadratic in t
      </Text>
      <circle cx={C[0]} cy={C[1]} r={R} className="fill-white/5 stroke-white/40" strokeWidth={1.5} />
      <line x1={O[0]} y1={O[1]} x2={P1[0]} y2={P1[1]} className="stroke-aqua" strokeWidth={2} />
      <line
        x1={P1[0]}
        y1={P1[1]}
        x2={P2[0]}
        y2={P2[1]}
        className="stroke-white/30"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <circle cx={O[0]} cy={O[1]} r={4} className="fill-sand" />
      <Label x={O[0] + 4} y={O[1] - 12} tone="cpu" size={11} anchor="start">
        ray in
      </Label>
      <circle cx={P1[0]} cy={P1[1]} r={5} className="fill-aqua" />
      <circle cx={P2[0]} cy={P2[1]} r={4} className="fill-faint" />
      <Label x={P1[0] + 14} y={P1[1] + 30} tone="shader" size={11} anchor="start">
        nearer root: used
      </Label>
      <Label x={P2[0] - 8} y={P2[1] + 28} tone="plain" size={11} anchor="end">
        further root: never tested
      </Label>
      <Arrow id={id} d={`M ${p(P1)} L ${p([P1[0] + n[0] * 78, P1[1] + n[1] * 78])}`} tone="plain" />
      <Label x={P1[0] + n[0] * 78 - 6} y={P1[1] + n[1] * 78 - 4} size={11} anchor="end">
        normal
      </Label>
      <Arrow id={id} d={`M ${p(P1)} L ${p([P1[0] + refl[0] * 82, P1[1] + refl[1] * 82])}`} tone="gpu" />
      <Label x={P1[0] + refl[0] * 82 + 8} y={P1[1] + refl[1] * 82 + 2} tone="gpu" size={11} anchor="start">
        mirror
      </Label>
      <circle cx={lobe[0]} cy={lobe[1]} r={34} className="fill-none stroke-aqua/70" strokeDasharray="3 3" />
      <Text x={600} y={372} className="fill-body text-xs">
        Diffuse: normal + a random point on the dashed ball.
      </Text>
      <Text x={600} y={390} className="fill-body text-xs">
        b² − 4ac &lt; 0 means a miss. A hit nearer than 0.001 is ignored.
      </Text>

      <Text x={600} y={436} className="fill-coral text-xs font-semibold">
        A ray that starts inside
      </Text>
      <Text x={600} y={454} className="fill-body text-xs">
        Its nearer root is ≤ 0.001, so it never
      </Text>
      <Text x={600} y={472} className="fill-body text-xs">
        hits this sphere and passes through.
      </Text>
      <Text x={600} y={490} className="fill-body text-xs">
        Fuzzy metal sends 506 rays a frame
      </Text>
      <Text x={600} y={508} className="fill-body text-xs">
        this way, 466 of them at the gold sphere.
      </Text>
      <circle cx={910} cy={530} r={50} className="fill-white/5 stroke-white/40" strokeWidth={1.5} />
      <line
        x1={874.6}
        y1={494.6}
        x2={990}
        y2={581}
        className="stroke-coral"
        strokeWidth={2}
        strokeDasharray="5 4"
        markerEnd={`url(#${id}-problem)`}
      />
      <circle cx={874.6} cy={494.6} r={4} className="fill-coral" />
    </Figure>
  );
}

/** Where each value lives, and the kernel on a roofline, with your recorded results on it. */
export function Memory({ results }: { results?: Record<"iris" | "rx", GpuResult> }) {
  const points = (["iris", "rx"] as const).flatMap((g) => {
    const d = results?.[g].dispatch;
    return d ? [{ g, ms: d.ms, a: achieved(d.ms) }] : [];
  });
  const id = "fig-memory";
  // Both axes are log scales: FLOP per byte across, GFLOP/s up.
  const X = scaleLog().domain([0.1, 100]).range([560, 960]);
  const Y = scaleLog().domain([10, 20000]).range([380, 60]);
  const ridge = 9750 / 448;
  const k = 9;
  const roof =
    line<[number, number]>()
      .x(([i]) => X(i))
      .y(([, perf]) => Y(perf))([
      [0.1, 448 * 0.1],
      [ridge, 9750],
      [100, 9750],
    ]) ?? "";
  return (
    <Figure
      id={id}
      w={1000}
      h={430}
      label="Registers hold each path and instructions hold the scene, so the only memory traffic is the two images, 36 bytes per pixel. On a roofline the kernel sits at about 9 FLOP per byte, and the Iris Xe's measured rates sit far below what either roof allows."
    >
      <Box
        x={20}
        y={30}
        w={220}
        h={70}
        tone="shader"
        n={1}
        title="Registers"
        sub="seed, ray, colour, hit"
        note="per lane, no spills"
      />
      <Box
        x={20}
        y={118}
        w={220}
        h={70}
        tone="shader"
        n={2}
        title="Instructions"
        sub="the 4 spheres, as constants"
        note="0 bytes read for the scene"
      />
      <Box x={20} y={206} w={220} h={64} tone="gpu" n={3} title="Push constant" sub="frameCount: 4 B a frame" />

      <rect
        x={270}
        y={20}
        width={210}
        height={330}
        rx={12}
        className="fill-mint/5 stroke-mint/50"
        strokeDasharray="5 4"
      />
      <Text x={285} y={42} className="fill-mint text-xs font-semibold">
        Device memory
      </Text>
      <Box
        x={285}
        y={56}
        w={180}
        h={84}
        tone="memory"
        n={4}
        title="accumImage"
        sub="16 B read, 16 B written"
        note="per pixel"
      />
      <Box x={285} y={160} w={180} h={70} tone="memory" n={5} title="storageImage" sub="4 B written per pixel" />
      <Box
        x={285}
        y={250}
        w={180}
        h={84}
        tone="display"
        n={6}
        title="Swapchain image"
        sub="copy: 4 B in, 4 B out"
        note="not in the timed dispatch"
      />
      <Arrow id={id} d="M 240 62 L 281 92" tone="shader" both />
      <Arrow id={id} d="M 240 80 L 281 190" tone="shader" />
      <Arrow id={id} d="M 375 230 L 375 246" tone="gpu" />

      <Text x={20} y={306} className="fill-white text-sm font-semibold">
        36 bytes per pixel, timed
      </Text>
      <Text x={20} y={324} className="fill-body text-xs">
        × 480,000 pixels = 17.3 MB a frame
      </Text>
      <Text x={20} y={342} className="fill-body text-xs">
        ≈ 324 FLOP per path ÷ 36 B ≈ 9 FLOP/B
      </Text>

      <Text x={560} y={30} className="fill-white text-sm font-semibold">
        Roofline (both axes log)
      </Text>
      <line x1={560} y1={380} x2={965} y2={380} className="stroke-white/40" />
      <line x1={560} y1={380} x2={560} y2={60} className="stroke-white/40" />
      {[0.1, 1, 10, 100].map((v) => (
        <g key={v}>
          <line x1={X(v)} y1={380} x2={X(v)} y2={385} className="stroke-white/40" />
          <Text x={X(v)} y={400} anchor="middle" className="fill-muted text-2xs">
            {String(v)}
          </Text>
        </g>
      ))}
      {[10, 100, 1000, 10000].map((v) => (
        <g key={v}>
          <line x1={555} y1={Y(v)} x2={560} y2={Y(v)} className="stroke-white/40" />
          <line x1={560} y1={Y(v)} x2={965} y2={Y(v)} className="stroke-white/5" />
          <Text x={550} y={Y(v) + 4} anchor="end" className="fill-muted text-2xs">
            {v.toLocaleString("en-GB")}
          </Text>
        </g>
      ))}
      <Text x={760} y={420} anchor="middle" className="fill-muted text-2xs">
        FLOP per byte of memory traffic
      </Text>
      <Text x={548} y={52} anchor="end" className="fill-muted text-2xs">
        GFLOP/s
      </Text>

      <path d={roof} fill="none" className="stroke-sand" strokeWidth={2} />
      <Label x={X(0.35)} y={Y(500)} tone="cpu" size={11} anchor="start">
        RX 5700 XT on paper
      </Label>
      <Label x={X(0.35)} y={Y(500) + 16} tone="cpu" size={11} anchor="start">
        448 GB/s, 9.75 TFLOP/s
      </Label>
      <circle cx={X(ridge)} cy={Y(9750)} r={3.5} className="fill-sand" />
      <Label x={X(ridge) - 6} y={Y(9750) - 12} tone="cpu" size={11}>
        ridge 21.8
      </Label>

      <line x1={X(k)} y1={Y(9750)} x2={X(k)} y2={380} className="stroke-aqua/60" strokeDasharray="4 4" />
      <circle cx={X(k)} cy={Y(448 * k)} r={4} className="fill-none stroke-sand" strokeWidth={1.5} />
      <Label x={X(k) - 10} y={Y(448 * k) + 4} tone="cpu" size={11} anchor="end">
        its roof here: 4.0 TFLOP/s
      </Label>
      {points.map(({ g, ms, a }) => (
        <g key={g}>
          <circle
            cx={X(k)}
            cy={Y(a.gflops)}
            r={5.5}
            className={g === "rx" ? "fill-lilac stroke-primary" : "fill-aqua stroke-primary"}
            strokeWidth={1.5}
          />
          <Label x={X(k) + 12} y={Y(a.gflops) + 4} tone={g === "rx" ? "gpu" : "shader"} size={11} anchor="start">
            {`${g === "rx" ? "RX 5700 XT" : "Iris Xe"}: ${Math.round(a.gflops).toLocaleString("en-GB")}${g === "rx" ? `, ${Math.round(a.ofRxRoof * 100)}% of roof` : ""}`}
          </Label>
          <Text x={X(k) + 12} y={Y(a.gflops) + 20} className="fill-faint text-3xs">{`${ms} ms, recorded`}</Text>
        </g>
      ))}
      {!points.length && (
        <Text x={X(k) + 12} y={Y(100)} className="fill-muted text-2xs">
          Record a frame time to place it here
        </Text>
      )}
      <Badge n={7} x={X(k)} y={Y(9750) - 4} tone="shader" />
      <Text x={X(k) - 14} y={Y(30)} anchor="end" className="fill-aqua text-2xs">
        this kernel ≈ 9
      </Text>
      <Text x={965} y={Y(15)} anchor="end" className="fill-muted text-2xs">
        Iris Xe roofs: measure them
      </Text>
    </Figure>
  );
}

/** One noisy pixel over 256 frames: every sample, the running average and its shrinking error. */
export function Accumulation() {
  const id = "fig-accumulation";
  const pixel = { x: 600, y: 430 };
  const frames = 256;
  const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const samples = Array.from({ length: frames }, (_, f) => lum(tracePixel(pixel.x, pixel.y, 800, 600, f).color));
  const means: number[] = [];
  samples.reduce((sum, s, i) => {
    means.push((sum + s) / (i + 1));
    return sum + s;
  }, 0);
  const mean = means.at(-1)!;
  const sd = Math.sqrt(samples.reduce((a, s) => a + (s - mean) ** 2, 0) / frames);
  const X = scaleLinear()
    .domain([0, frames - 1])
    .range([430, 970]);
  const Y = scaleLinear().domain([0, 1]).range([330, 50]);
  const error = (i: number) => sd / Math.sqrt(i + 1);
  const band =
    area<number>()
      .x((_, i) => X(i))
      .y0((_, i) => Y(Math.max(0, mean - error(i))))
      .y1((_, i) => Y(Math.min(1, mean + error(i))))(means) ?? "";
  const average =
    line<number>()
      .x((_, i) => X(i))
      .y((m) => Y(m))(means) ?? "";
  return (
    <Figure
      id={id}
      w={1000}
      h={380}
      label={`Pixel (${pixel.x}, ${pixel.y}) over ${frames} frames: single samples scatter widely, while their running average settles, with an error band that narrows as one over the square root of the frame count.`}
    >
      <Box
        x={20}
        y={24}
        w={340}
        h={50}
        tone="memory"
        n={1}
        title="Frame 0: sum = sample"
        sub="no read: the image starts undefined"
      />
      <Box
        x={20}
        y={94}
        w={340}
        h={50}
        tone="memory"
        n={2}
        title="Frame N: sum += sample"
        sub="read, add, write the same pixel"
      />
      <Box x={20} y={164} w={340} h={50} tone="memory" n={3} title="Average: sum ÷ (N + 1)" />
      <Box
        x={20}
        y={234}
        w={340}
        h={50}
        tone="memory"
        n={4}
        title="Gamma: √ of the average"
        sub="written as 8-bit colour"
      />
      <Box x={20} y={304} w={340} h={50} tone="cpu" n={5} title="Never reset" sub="frameCount only grows" />
      <Arrow id={id} d="M 190 74 L 190 90" tone="memory" />
      <Arrow id={id} d="M 190 144 L 190 160" tone="memory" />
      <Arrow id={id} d="M 190 214 L 190 230" tone="memory" />

      <Text
        x={430}
        y={28}
        className="fill-white text-sm font-semibold"
      >{`Pixel (${pixel.x}, ${pixel.y}), brightness of each sample`}</Text>
      <line x1={430} y1={330} x2={975} y2={330} className="stroke-white/40" />
      <line x1={430} y1={330} x2={430} y2={44} className="stroke-white/40" />
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={426} y1={Y(v)} x2={975} y2={Y(v)} className="stroke-white/5" />
          <Text x={420} y={Y(v) + 4} anchor="end" className="fill-muted text-2xs">
            {String(v)}
          </Text>
        </g>
      ))}
      {[0, 64, 128, 192, 255].map((f) => (
        <Text key={f} x={X(f)} y={348} anchor="middle" className="fill-muted text-2xs">
          {String(f)}
        </Text>
      ))}
      <Text x={702} y={368} anchor="middle" className="fill-muted text-2xs">
        frame
      </Text>
      <path d={band} className="fill-lavender/20" />
      {samples.map((s, i) => (
        <circle key={i} cx={X(i)} cy={Y(s)} r={2} className="fill-aqua/60" />
      ))}
      <path d={average} fill="none" className="stroke-mint" strokeWidth={2.2} />
      <Label x={X(150)} y={Y(mean) - 14} tone="memory" size={11}>
        running average: what you see
      </Label>
      <Label x={X(40)} y={Y(Math.max(...samples.slice(30, 50))) - 10} tone="shader" size={11}>
        one sample per frame
      </Label>
      <Label x={X(16)} y={Y(mean + sd / 4) - 8} tone="gpu" size={11} anchor="start">
        ± error, as 1/√N
      </Label>
    </Figure>
  );
}
