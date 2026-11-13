import type { ReactNode } from "react";
import { Arrow, Badge, Box, Figure, Label, Text, TONES } from "./kit";

// The host side of the renderer: what main.cpp builds, how a frame moves, and
// how the barriers order it. Each figure numbers the steps listed beside it.

/** One frame, start to finish. On the hub, boxes link to the view that explains them. */
export function FrameMap({ links = false }: { links?: boolean }) {
  const id = "fig-frame";
  const go = (view: string) => (links ? `/lab/${view}` : undefined);
  return (
    <Figure
      id={id}
      w={1000}
      h={470}
      label="One frame: main.cpp records a command buffer, the compute queue runs raytrace.comp over 480,000 pixels into two images, and the result is copied to a swapchain image the display shows."
    >
      <Box
        x={20}
        y={30}
        w={210}
        h={76}
        tone="cpu"
        n={1}
        title="Frame loop"
        sub="main.cpp, once per frame"
        href={go("timeline")}
      />
      <Box
        x={280}
        y={30}
        w={210}
        h={76}
        tone="gpu"
        n={2}
        title="Command buffer"
        sub="recorded fresh every frame"
        href={go("sync")}
      />
      <Box
        x={540}
        y={30}
        w={210}
        h={76}
        tone="gpu"
        n={3}
        title="Compute queue"
        sub="starts commands in order"
        href={go("timeline")}
      />
      <Box
        x={790}
        y={30}
        w={190}
        h={76}
        tone="display"
        n={8}
        title="Display"
        sub="shows one image at a time"
        href={go("timeline")}
      />

      <Arrow id={id} d="M 230 68 L 276 68" tone="cpu" label="records" at={[253, 58]} />
      <Arrow id={id} d="M 490 68 L 536 68" tone="gpu" label="submit" at={[513, 58]} />

      <Box
        x={280}
        y={190}
        w={470}
        h={96}
        tone="shader"
        n={4}
        title="raytrace.comp"
        sub="100 × 75 workgroups × 64 invocations"
        note="= 480,000 runs of main(), one per pixel"
        href={go("dispatch")}
      />
      <Arrow id={id} d="M 645 106 L 645 186" tone="gpu" label="vkCmdDispatch" at={[645, 150]} />
      <Arrow id={id} d="M 385 106 L 385 186" tone="gpu" label="frameCount, 4 bytes" at={[385, 150]} />

      <Box
        x={20}
        y={190}
        w={170}
        h={70}
        tone="gpu"
        title="Query pool"
        sub="2 timestamps a frame"
        href={go("timeline")}
      />
      <Arrow id={id} d="M 280 225 L 194 225" tone="gpu" label="timestamps" at={[237, 214]} />
      <Arrow id={id} d="M 105 190 L 105 110" tone="cpu" dashed label="read next frame" at={[105, 150]} />

      <Box
        x={20}
        y={370}
        w={240}
        h={80}
        tone="memory"
        n={5}
        title="accumImage"
        sub="RGBA32F, sum of every sample"
        href={go("accumulation")}
      />
      <Box
        x={390}
        y={370}
        w={240}
        h={80}
        tone="memory"
        n={6}
        title="storageImage"
        sub="RGBA8, this frame's average"
        href={go("memory")}
      />
      <Box
        x={740}
        y={370}
        w={240}
        h={80}
        tone="display"
        n={7}
        title="Swapchain image"
        sub="borrowed from the display"
        href={go("sync")}
      />

      <Arrow id={id} d="M 330 286 L 170 366" tone="shader" both label="read, add, write" at={[236, 330]} />
      <Arrow id={id} d="M 510 286 L 510 366" tone="shader" label="imageStore" at={[510, 330]} />
      <Arrow id={id} d="M 630 410 L 736 410" tone="gpu" label="vkCmdCopyImage" at={[683, 400]} />
      <Arrow id={id} d="M 885 370 L 885 110" tone="display" label="present" at={[885, 240]} />
    </Figure>
  );
}

/** What setup builds, in three columns, with CUDA's name for each piece. */
export function Objects() {
  const id = "fig-objects";
  const col = [20, 355, 690];
  const row = (i: number) => 52 + i * 104;
  return (
    <Figure
      id={id}
      w={1000}
      h={600}
      label="Setup builds three groups of objects: the device chain, the display chain and the shader's bindings, plus per-frame tools. Each box gives its CUDA counterpart."
    >
      <Text x={col[0]} y={28} className="fill-muted eyebrow text-[12px] tracking-wider uppercase">
        Talk to the GPU
      </Text>
      <Text x={col[1]} y={28} className="fill-muted eyebrow text-[12px] tracking-wider uppercase">
        Show pixels
      </Text>
      <Text x={col[2]} y={28} className="fill-muted eyebrow text-[12px] tracking-wider uppercase">
        Tell the shader where its data is
      </Text>

      <Box x={col[0]} y={row(0)} w={290} h={64} tone="cpu" n={1} title="Instance" sub="loader + validation in Debug" />
      <Box
        x={col[0]}
        y={row(1)}
        w={290}
        h={64}
        tone="gpu"
        n={3}
        title="Physical device"
        sub="first suitable: the Iris Xe"
        note="CUDA: cudaGetDeviceProperties"
      />
      <Box x={col[0]} y={row(2)} w={290} h={64} tone="gpu" n={4} title="Logical device" sub="queues from one family" />
      <Box
        x={col[0]}
        y={row(3)}
        w={290}
        h={64}
        tone="gpu"
        title="Compute queue"
        sub="takes every submit"
        note="CUDA: a stream"
      />
      <Arrow
        id={id}
        d={`M 165 ${row(0) + 64} L 165 ${row(1) - 4}`}
        tone="gpu"
        label="lists"
        at={[176, row(1) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 165 ${row(1) + 64} L 165 ${row(2) - 4}`}
        tone="gpu"
        label="opens"
        at={[176, row(2) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 165 ${row(2) + 64} L 165 ${row(3) - 4}`}
        tone="gpu"
        label="hands out"
        at={[176, row(3) - 16]}
        labelAnchor="start"
      />

      <Box x={col[1]} y={row(0)} w={290} h={64} tone="plain" title="GLFW window" sub="800 × 600, no OpenGL" />
      <Box x={col[1]} y={row(1)} w={290} h={64} tone="display" n={2} title="Surface" sub="the window, for Vulkan" />
      <Box
        x={col[1]}
        y={row(2)}
        w={290}
        h={64}
        tone="display"
        n={5}
        title="Swapchain"
        sub="the display's images, copy-in only"
      />
      <Box x={col[1]} y={row(3)} w={290} h={64} tone="gpu" title="Semaphores" sub="imageAvailable + one per image" />
      <Arrow
        id={id}
        d={`M 500 ${row(0) + 64} L 500 ${row(1) - 4}`}
        tone="display"
        label="wrapped as"
        at={[511, row(1) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 500 ${row(1) + 64} L 500 ${row(2) - 4}`}
        tone="display"
        label="images for"
        at={[511, row(2) - 16]}
        labelAnchor="start"
      />
      <Arrow id={id} d={`M 310 ${row(0) + 32} L 351 ${row(1) + 20}`} tone="cpu" />

      <Box
        x={col[2]}
        y={row(0)}
        w={290}
        h={64}
        tone="memory"
        n={6}
        title="Two storage images"
        sub="image + memory + view, each"
        note="CUDA: cudaMalloc"
      />
      <Box
        x={col[2]}
        y={row(1)}
        w={290}
        h={64}
        tone="gpu"
        n={7}
        title="Descriptor set"
        sub="points at both views"
        note="CUDA: the pointer arguments"
      />
      <Box
        x={col[2]}
        y={row(2)}
        w={290}
        h={64}
        tone="gpu"
        title="Descriptor set layout"
        sub="bindings 0 and 1: storage images"
      />
      <Box
        x={col[2]}
        y={row(3)}
        w={290}
        h={64}
        tone="gpu"
        n={8}
        title="Pipeline layout"
        sub="set layout + 4-byte push constant"
        note="CUDA: the kernel's signature"
      />
      <Box
        x={col[2]}
        y={row(4)}
        w={290}
        h={64}
        tone="shader"
        title="Pipeline"
        sub="layout + SPIR-V from build/"
        note="CUDA: the compiled kernel"
      />
      <Arrow
        id={id}
        d={`M 835 ${row(0) + 64} L 835 ${row(1) - 4}`}
        tone="memory"
        label="views"
        at={[846, row(1) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 835 ${row(2)} L 835 ${row(1) + 68}`}
        tone="gpu"
        label="gives its shape"
        at={[846, row(2) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 835 ${row(2) + 64} L 835 ${row(3) - 4}`}
        tone="gpu"
        label="part of"
        at={[846, row(3) - 16]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 835 ${row(3) + 64} L 835 ${row(4) - 4}`}
        tone="gpu"
        label="part of"
        at={[846, row(4) - 16]}
        labelAnchor="start"
      />

      <Box
        x={col[0]}
        y={row(4)}
        w={290}
        h={64}
        tone="gpu"
        n={9}
        title="Command pool and buffer"
        sub="one buffer, re-recorded"
        note="CUDA: work queued on a stream"
      />
      <Box x={col[1]} y={row(4)} w={140} h={64} tone="gpu" title="Query pool" sub="2 timestamps" />
      <Box x={col[1] + 150} y={row(4)} w={140} h={64} tone="cpu" title="Fence" sub="starts signalled" />
      <Text x={20} y={584} className="fill-muted text-[12px]">
        Everything below the logical device is created from it. Arrows show what each object is made from or points at.
      </Text>
    </Figure>
  );
}

/** Two frames on three lanes: what the CPU, the GPU and the display do, and who waits for whom. */
export function Timeline() {
  const id = "fig-timeline";
  const lane = { cpu: 60, gpu: 170, display: 280 };
  const H = 44;
  const block = (x: number, w: number, y: number, tone: keyof typeof TONES, text: string, faint = false) => (
    <g key={`${x}-${y}`}>
      <rect
        x={x}
        y={y}
        width={w}
        height={H}
        rx={6}
        className={faint ? "fill-white/5 stroke-white/15" : TONES[tone].box}
        strokeWidth={1.2}
      />
      {w > 34 && (
        <Text
          x={x + w / 2}
          y={y + 27}
          anchor="middle"
          className={faint ? "fill-muted text-[12px]" : "fill-white text-[12px]"}
        >
          {text}
        </Text>
      )}
    </g>
  );
  const frame = (x0: number, label: string) => (
    <g key={label}>
      {block(x0, 40, lane.cpu, "cpu", "wait")}
      {block(x0 + 40, 30, lane.cpu, "cpu", "")}
      {block(x0 + 70, 30, lane.cpu, "cpu", "")}
      {block(x0 + 100, 70, lane.cpu, "cpu", "record")}
      {block(x0 + 170, 36, lane.cpu, "cpu", "")}
      {block(x0 + 206, 214, lane.cpu, "cpu", "sleeps on the fence", true)}
      {block(x0 + 180, 20, lane.gpu, "gpu", "")}
      {block(x0 + 200, 196, lane.gpu, "shader", `dispatch, ${label}`)}
      {block(x0 + 396, 30, lane.gpu, "gpu", "")}
    </g>
  );
  return (
    <Figure
      id={id}
      w={1000}
      h={360}
      label="Two frames on three lanes. The CPU records and submits, then sleeps on the fence while the GPU runs the dispatch and copy; the display shows each frame once the GPU signals renderFinished."
    >
      <Text x={20} y={lane.cpu + 27} className="fill-sand text-[13px] font-semibold">
        CPU
      </Text>
      <Text x={20} y={lane.gpu + 27} className={`${TONES.gpu.text} text-[13px] font-semibold`}>
        GPU queue
      </Text>
      <Text x={20} y={lane.display + 27} className={`${TONES.display.text} text-[13px] font-semibold`}>
        Display
      </Text>
      {frame(110, "frame N")}
      {frame(540, "frame N+1")}

      {block(110, 430, lane.display, "display", "shows frame N−1", true)}
      {block(540, 430, lane.display, "display", "shows frame N")}

      <Badge n={1} x={130} y={lane.cpu - 14} tone="cpu" />
      <Badge n={2} x={165} y={lane.cpu - 14} tone="cpu" />
      <Badge n={3} x={195} y={lane.cpu - 14} tone="cpu" />
      <Badge n={4} x={245} y={lane.cpu - 14} tone="cpu" />
      <Badge n={5} x={408} y={lane.gpu - 14} tone="shader" />
      <Badge n={6} x={298} y={lane.cpu - 14} tone="cpu" />
      <Text x={165} y={lane.cpu + 60} anchor="end" className="fill-muted text-[11px]">
        read
      </Text>
      <Text x={182} y={lane.cpu + 74} anchor="start" className="fill-muted text-[11px]">
        acquire
      </Text>
      <Text x={316} y={lane.cpu + 60} anchor="end" className="fill-muted text-[11px]">
        present
      </Text>
      <Text x={284} y={lane.gpu + 27} anchor="end" className="fill-muted text-[11px]">
        barriers
      </Text>
      <Text x={521} y={lane.gpu + 62} anchor="middle" className="fill-muted text-[11px]">
        copy
      </Text>

      <Arrow
        id={id}
        d={`M 290 ${lane.cpu + H} L 290 ${lane.gpu - 4}`}
        tone="cpu"
        label="vkQueueSubmit"
        at={[298, 146]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 536 ${lane.gpu} L 548 ${lane.cpu + H + 4}`}
        tone="gpu"
        label="fence"
        at={[555, 136]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 536 ${lane.gpu + H} L 548 ${lane.display - 4}`}
        tone="gpu"
        label="renderFinished"
        at={[555, 246]}
        labelAnchor="start"
      />
      <Arrow
        id={id}
        d={`M 300 ${lane.display} L 312 ${lane.gpu + H + 4}`}
        tone="display"
        dashed
        label="imageAvailable"
        at={[318, 246]}
        labelAnchor="start"
      />
      <Text x={20} y={348} className="fill-muted text-[12px]">
        Not to scale, except that the dispatch is most of the GPU&apos;s time. The CPU&apos;s own work takes
        microseconds.
      </Text>
    </Figure>
  );
}

/** Where each of the sync view's eight steps sits across the figure, for the walkthrough. */
export const SYNC_X = {
  wait: 160,
  b1: 245,
  b2: 320,
  dispatch: 420,
  b3: 525,
  b4: 615,
  copy: 735,
  b5: 830,
  signal: 925,
} as const;
export const SYNC_STEP_X = [
  SYNC_X.wait,
  SYNC_X.b1,
  SYNC_X.b2,
  SYNC_X.dispatch,
  SYNC_X.b3,
  SYNC_X.b4,
  SYNC_X.copy,
  SYNC_X.b5,
] as const;

/**
 * Three images through one command buffer: their layouts, the five barriers, and
 * the chain the semaphore starts. children draws on top, for the walkthrough.
 */
export function SyncLanes({ children }: { children?: ReactNode }) {
  const id = "fig-sync";
  const lanes = [
    { name: "storageImage", y: 150, tone: "memory" as const },
    { name: "accumImage", y: 230, tone: "memory" as const },
    { name: "Swapchain image", y: 310, tone: "display" as const },
  ];
  const X = SYNC_X;
  const seg = (
    y: number,
    from: number,
    to: number,
    text: string,
    tone: "memory" | "display" | "plain",
    faint = false,
  ) => (
    <g key={`${y}-${from}`}>
      <rect
        x={from}
        y={y - 13}
        width={to - from}
        height={26}
        rx={5}
        className={faint ? "fill-white/5 stroke-white/15" : TONES[tone].box}
        strokeWidth={1}
      />
      <Text x={from + 10} y={y + 4} className={faint ? "fill-muted text-[11px]" : "fill-white text-[11px]"}>
        {text}
      </Text>
    </g>
  );
  const tick = (x: number, y: number, label: string, problem = false) => (
    <g key={`${x}-${y}`}>
      <line
        x1={x}
        y1={y - 22}
        x2={x}
        y2={y + 22}
        className={problem ? "stroke-coral" : "stroke-lavender"}
        strokeWidth={3}
      />
      <Label x={x} y={y - 27} tone={problem ? "problem" : "gpu"} size={10.5}>
        {label}
      </Label>
    </g>
  );
  const use = (x: number, y: number, text: string) => (
    <g key={`u-${x}-${y}`}>
      <circle cx={x} cy={y} r={11} className="fill-primary stroke-aqua" strokeWidth={1.5} />
      <Text x={x} y={y + 4} anchor="middle" className="fill-aqua text-[10px] font-semibold">
        {text}
      </Text>
    </g>
  );
  return (
    <Figure
      id={id}
      w={1000}
      h={440}
      label="Command order left to right. The acquire semaphore starts a chain through the dispatch, the storage barrier and the copy. The swapchain image's first barrier uses TOP_OF_PIPE as its source stage, so it is not on that chain: its layout transition can run before the display has released the image."
    >
      {lanes.map((l) => (
        <Text key={l.name} x={20} y={l.y + 4} className="fill-white text-[13px] font-semibold">
          {l.name}
        </Text>
      ))}
      {seg(150, 130, X.b1, "TRANSFER_SRC", "memory", true)}
      {seg(150, X.b1, X.b3, "GENERAL", "memory")}
      {seg(150, X.b3, 990, "TRANSFER_SRC", "memory")}
      {seg(230, 130, X.b2, "GENERAL", "memory", true)}
      {seg(230, X.b2, 990, "GENERAL", "memory")}
      {seg(310, 130, X.b4, "the display's, UNDEFINED to you", "display", true)}
      {seg(310, X.b4, X.b5, "TRANSFER_DST", "display")}
      {seg(310, X.b5, 990, "PRESENT_SRC", "display")}

      {tick(X.b1, 150, "TRANSFER → COMPUTE")}
      {tick(X.b2, 230, "COMPUTE → COMPUTE")}
      {tick(X.b3, 150, "COMPUTE → TRANSFER")}
      {tick(X.b4, 310, "TOP_OF_PIPE → TRANSFER", true)}
      {tick(X.b5, 310, "TRANSFER → BOTTOM")}
      <rect
        x={X.dispatch - 42}
        y={120}
        width={84}
        height={140}
        rx={8}
        className="fill-aqua/5 stroke-aqua/50"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {use(X.dispatch, 150, "W")}
      {use(X.dispatch, 230, "RW")}
      <rect
        x={X.copy - 24}
        y={120}
        width={48}
        height={220}
        rx={8}
        className="fill-lavender/5 stroke-lavender/50"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {use(X.copy, 150, "R")}
      {use(X.copy, 310, "W")}

      <path
        d={`M ${X.wait} 70 L ${X.wait} 92 L ${X.copy} 92 L ${X.copy} 116`}
        fill="none"
        className="stroke-aqua"
        strokeWidth={2.5}
        markerEnd={`url(#${id}-shader)`}
      />
      <circle cx={X.wait} cy={60} r={9} className="fill-fuchsia/20 stroke-fuchsia" strokeWidth={1.5} />
      <Label x={X.wait} y={40} tone="display">
        imageAvailable, at COMPUTE_SHADER
      </Label>
      <Label x={(X.dispatch + X.b3) / 2} y={86} tone="shader">
        chained: dispatch → barrier → copy
      </Label>
      <path
        d={`M ${X.b4} 286 L ${X.b4} 100`}
        fill="none"
        className="stroke-coral"
        strokeWidth={1.5}
        strokeDasharray="3 4"
      />
      <circle cx={X.b4} cy={92} r={8} className="fill-primary stroke-coral" strokeWidth={2} />
      <path
        d={`M ${X.b4 - 4} 88 L ${X.b4 + 4} 96 M ${X.b4 + 4} 88 L ${X.b4 - 4} 96`}
        className="stroke-coral"
        strokeWidth={2}
      />

      <Badge n={1} x={X.wait - 22} y={60} tone="display" />
      <Badge n={2} x={X.b1} y={176} tone="gpu" />
      <Badge n={3} x={X.b2} y={256} tone="gpu" />
      <Badge n={4} x={X.dispatch} y={276} tone="shader" />
      <Badge n={5} x={X.b3} y={176} tone="gpu" />
      <Badge n={6} x={X.b4} y={336} tone="problem" />
      <Badge n={7} x={X.copy} y={356} tone="gpu" />
      <Badge n={8} x={X.b5} y={336} tone="gpu" />

      <rect
        x={X.b4 - 160}
        y={372}
        width={360}
        height={52}
        rx={8}
        className="fill-coral/10 stroke-coral"
        strokeWidth={1.2}
      />
      <Text x={X.b4 + 20} y={393} anchor="middle" className="fill-coral text-[12.5px] font-semibold">
        Not on the chain: can start before the display lets go
      </Text>
      <Text x={X.b4 + 20} y={412} anchor="middle" className="fill-bright text-[12px]">
        Fix: source stage COMPUTE_SHADER at line 804
      </Text>
      <circle cx={X.signal} cy={60} r={9} className="fill-fuchsia/20 stroke-fuchsia" strokeWidth={1.5} />
      <Label x={X.signal - 14} y={40} tone="display" anchor="end">
        then signal renderFinished
      </Label>
      <path
        d={`M ${X.b5} 286 L ${X.b5} 92 L ${X.signal - 12} 66`}
        fill="none"
        className="stroke-lavender/50"
        strokeWidth={1.2}
        strokeDasharray="3 3"
      />
      {children}
    </Figure>
  );
}
