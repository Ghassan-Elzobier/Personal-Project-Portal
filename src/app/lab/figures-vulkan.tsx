import { IRIS_XE } from "@/lib/lab/guide";
import { Arrow, Badge, Box, Figure, Label, Text, TONES } from "./kit";

// The host side in more detail: how the shader reaches the GPU, how it finds
// its images, the swapchain, and the timing. Measured values come from the Iris
// Xe laptop, through vulkaninfo and a copy of the program that prints them.

export function ShaderBuild() {
  const id = "fig-shader-build";
  return (
    <Figure
      id={id}
      w={1000}
      h={330}
      label="raytrace.comp is compiled by glslc into SPIR-V when you build. At startup the program reads that file into a shader module, and creating the pipeline is when the driver compiles it into the GPU's own instructions. The module is then destroyed, and the pipeline is bound every frame."
    >
      <Text x={20} y={24} className="fill-neutral-400 eyebrow text-[12px] tracking-wider uppercase">
        When you build
      </Text>
      <Text x={540} y={24} className="fill-neutral-400 eyebrow text-[12px] tracking-wider uppercase">
        When the program starts
      </Text>
      <line x1={520} y1={10} x2={520} y2={300} className="stroke-white/10" />
      <Box
        x={20}
        y={44}
        w={200}
        h={76}
        tone="shader"
        n={1}
        title="raytrace.comp"
        sub="GLSL, 167 lines"
        note="what you write"
      />
      <Box
        x={290}
        y={44}
        w={210}
        h={76}
        tone="memory"
        n={2}
        title="raytrace.comp.spv"
        sub="SPIR-V 1.0, 13,568 bytes"
        note="first word 0x07230203"
      />
      <Arrow id={id} d="M 220 82 L 286 82" tone="shader" label="glslc" at={[253, 72]} />
      <Box
        x={560}
        y={44}
        w={190}
        h={76}
        tone="gpu"
        n={4}
        title="VkShaderModule"
        sub="the SPIR-V, wrapped"
        note="nothing compiled yet"
      />
      <Arrow id={id} d="M 500 82 L 556 82" tone="memory" />
      <Text x={528} y={110} anchor="middle" className="fill-mint text-[11.5px]">
        readFile
      </Text>
      <Badge n={3} x={528} y={60} tone="memory" />
      <Box
        x={790}
        y={44}
        w={190}
        h={96}
        tone="shader"
        n={5}
        title="VkPipeline"
        sub="the driver compiles here"
        note={`Iris Xe: SIMD${IRIS_XE.subgroup.compiled}, 2,197 instr.`}
      />
      <Arrow id={id} d="M 750 82 L 786 82" tone="gpu" />
      <Text x={790} y={162} className="fill-[#a58bf0] text-[11.5px]">
        vkCreateComputePipelines
      </Text>

      <Box
        x={560}
        y={200}
        w={200}
        h={64}
        tone="plain"
        n={6}
        dashed
        title="Module destroyed"
        sub="line 688: the pipeline"
        note="keeps the compiled code"
      />
      <Arrow id={id} d="M 655 120 L 655 196" tone="plain" dashed />
      <Box x={790} y={220} w={190} h={64} tone="gpu" n={7} title="Every frame" sub="bind it, then dispatch" />
      <Arrow id={id} d="M 885 170 L 885 216" tone="shader" />

      <Text x={20} y={170} className="fill-neutral-300 text-[12.5px]">
        CMake reruns glslc whenever raytrace.comp changes,
      </Text>
      <Text x={20} y={188} className="fill-neutral-300 text-[12.5px]">
        so a build always brings the .spv up to date.
      </Text>
      <Text x={20} y={226} className="fill-neutral-300 text-[12.5px]">
        The program opens build/raytrace.comp.spv by a
      </Text>
      <Text x={20} y={244} className="fill-neutral-300 text-[12.5px]">
        relative path: start it from the project root.
      </Text>
      <Text x={20} y={282} className="fill-neutral-400 text-[12px]">
        Like CUDA: the compiler makes a portable form (PTX there, SPIR-V here),
      </Text>
      <Text x={20} y={300} className="fill-neutral-400 text-[12px]">
        and the driver finishes the job for the exact GPU.
      </Text>
    </Figure>
  );
}

const TYPES = [
  { flags: "L", allowed: true },
  { flags: "L V C", allowed: true },
  { flags: "L V C $", allowed: true },
  { flags: "L P", allowed: false },
  { flags: "L", allowed: false },
  { flags: "L V C", allowed: false },
  { flags: "L V C $", allowed: false },
];

export function MemoryBinding() {
  const id = "fig-memory-binding";
  return (
    <Figure
      id={id}
      w={1000}
      h={520}
      label="Left: an image asks for memory; the driver allows memory types 0 to 2 and findMemoryType picks type 0, which on the Iris Xe is system RAM shared with the CPU. Right: the descriptor set layout, the set and its two slots, and the shader bindings they feed; frameCount goes by push constant instead."
    >
      <Text x={20} y={24} className="fill-neutral-400 eyebrow text-[12px] tracking-wider uppercase">
        Memory for one image
      </Text>
      <Box
        x={20}
        y={40}
        w={430}
        h={60}
        tone="memory"
        n={1}
        title="VkImage: storageImage"
        sub="800 × 600, R8G8B8A8_UNORM, OPTIMAL tiling, no memory yet"
      />
      <Arrow id={id} d="M 235 100 L 235 122" tone="memory" />
      <Box
        x={20}
        y={126}
        w={430}
        h={64}
        tone="plain"
        n={2}
        title="It needs 2,187,616 bytes, 64 KiB aligned"
        sub="800 × 600 × 4 is 1,920,000: the tiled layout pads"
        note="memoryTypeBits = 0x7: types 0, 1 and 2"
      />
      <Arrow id={id} d="M 235 190 L 235 212" tone="memory" />
      {TYPES.map((t, i) => (
        <g key={i}>
          <rect
            x={20 + i * 62}
            y={216}
            width={56}
            height={52}
            rx={6}
            className={
              i === 0
                ? "fill-mint/25 stroke-mint"
                : t.allowed
                  ? "fill-mint/10 stroke-mint/50"
                  : "fill-white/5 stroke-white/15"
            }
            strokeWidth={i === 0 ? 2.5 : 1}
          />
          <Text
            x={48 + i * 62}
            y={236}
            anchor="middle"
            className={t.allowed ? "fill-white text-[12px] font-semibold" : "fill-neutral-500 text-[12px]"}
          >{`type ${i}`}</Text>
          <Text
            x={48 + i * 62}
            y={256}
            anchor="middle"
            className={t.allowed ? "fill-neutral-200 text-[11px]" : "fill-neutral-500 text-[11px]"}
          >
            {t.flags}
          </Text>
        </g>
      ))}
      <Badge n={3} x={20} y={216} tone="memory" />
      <Text x={20} y={286} className="fill-neutral-400 text-[11px]">
        L device-local · V host-visible · C host-coherent · $ host-cached · P protected
      </Text>
      <Text x={20} y={304} className="fill-neutral-300 text-[12px]">
        First type that is allowed and DEVICE_LOCAL: type 0. All 7 are in
      </Text>
      <Text x={20} y={320} className="fill-neutral-300 text-[12px]">
        one 11.5 GiB heap: the laptop&apos;s RAM, shared with the CPU.
      </Text>
      <Box x={20} y={340} w={205} h={60} tone="memory" n={4} title="VkDeviceMemory" sub="2,187,616 bytes of type 0" />
      <Box x={245} y={340} w={205} h={60} tone="memory" n={5} title="VkImageView" sub="2D, colour, 1 level, 1 layer" />
      <Arrow id={id} d="M 225 370 L 241 370" tone="memory" />
      <Text x={20} y={428} className="fill-neutral-400 text-[12px]">
        accumImage is the same, in RGBA32F: 7,812,896 bytes.
      </Text>

      <Text x={520} y={24} className="fill-neutral-400 eyebrow text-[12px] tracking-wider uppercase">
        How binding = 1 finds it
      </Text>
      <Box
        x={520}
        y={40}
        w={460}
        h={60}
        tone="gpu"
        n={6}
        title="Descriptor set layout"
        sub="binding 0: storage image · binding 1: storage image"
      />
      <Arrow id={id} d="M 750 100 L 750 122" tone="gpu" label="shapes" at={[784, 112]} labelAnchor="start" />
      <rect x={520} y={126} width={460} height={124} rx={10} className={TONES.gpu.box} strokeWidth={1.5} />
      <Badge n={7} x={522} y={128} tone="gpu" />
      <Text x={544} y={150} className="fill-white text-[14px] font-semibold">
        Descriptor set, from a pool of 2
      </Text>
      <rect x={540} y={164} width={420} height={34} rx={6} className="fill-primary stroke-white/15" />
      <Text x={556} y={186} className="fill-neutral-300 text-[12.5px]">
        slot 0 →
      </Text>
      <Text x={620} y={186} className="fill-mint text-[12.5px]">
        storageImage&apos;s view, GENERAL
      </Text>
      <rect x={540} y={204} width={420} height={34} rx={6} className="fill-primary stroke-white/15" />
      <Text x={556} y={226} className="fill-neutral-300 text-[12.5px]">
        slot 1 →
      </Text>
      <Text x={620} y={226} className="fill-mint text-[12.5px]">
        accumImage&apos;s view, GENERAL
      </Text>
      <path
        d="M 450 370 C 490 370 490 220 536 220"
        fill="none"
        className="stroke-mint/70"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        markerEnd={`url(#${id}-memory)`}
      />
      <Label x={530} y={276} tone="memory" size={11} anchor="start">
        vkUpdateDescriptorSets
      </Label>

      <Arrow
        id={id}
        d="M 750 250 L 750 286"
        tone="gpu"
        label="vkCmdBindDescriptorSets, each frame"
        at={[760, 270]}
        labelAnchor="start"
      />
      <rect x={520} y={290} width={460} height={84} rx={10} className={TONES.shader.box} strokeWidth={1.5} />
      <Badge n={8} x={522} y={292} tone="shader" />
      <Text x={544} y={314} className="fill-white text-[14px] font-semibold">
        raytrace.comp
      </Text>
      <Text x={544} y={336} className="fill-aqua text-[12.5px]">
        layout(binding = 0, rgba8) outputImage
      </Text>
      <Text x={544} y={356} className="fill-aqua text-[12.5px]">
        layout(binding = 1, rgba32f) accumImage
      </Text>
      <Text x={544} y={404} className="fill-neutral-400 text-[12px]">
        The format in the shader must match the image&apos;s.
      </Text>

      <rect x={520} y={420} width={460} height={76} rx={10} className="fill-white/5 stroke-white/15" />
      <Badge n={9} x={522} y={422} tone="cpu" />
      <Text x={544} y={444} className="fill-white text-[13.5px] font-semibold">
        The short path: a push constant
      </Text>
      <Text x={544} y={466} className="fill-neutral-300 text-[12.5px]">
        frameCount, 4 bytes → vkCmdPushConstants → pc.frameCount
      </Text>
      <Text x={544} y={484} className="fill-neutral-400 text-[12px]">
        Written into the command buffer itself. No descriptor, no memory.
      </Text>
    </Figure>
  );
}

export function Swapchain() {
  const id = "fig-swapchain";
  const C = { x: 230, y: 230 };
  const pos = [
    { x: C.x, y: C.y - 130, title: "Free", sub: "the display let go", tone: "plain" as const },
    { x: C.x + 160, y: C.y, title: "Yours", sub: "you copy into it", tone: "gpu" as const },
    { x: C.x, y: C.y + 130, title: "Presented", sub: "waiting to be shown", tone: "display" as const },
    { x: C.x - 160, y: C.y, title: "On screen", sub: "being shown", tone: "display" as const },
  ];
  const red = [0.8, 0.25, 0.25].map((v) => Math.round(Math.sqrt(v) * 255));
  return (
    <Figure
      id={id}
      w={1000}
      h={500}
      label="Each swapchain image goes round a loop: free, acquired by you, presented, on screen, then free again. Through X11 the program ends up with a BGRA format, so the RGBA bytes it copies in come out with red and blue swapped; through Wayland it gets the RGBA format it asked for."
    >
      <Text x={20} y={26} className="fill-white text-[14px] font-semibold">
        One image&apos;s trip round the loop
      </Text>
      {pos.map((p) => (
        <Box
          key={p.title}
          x={p.x - 70}
          y={p.y - 30}
          w={140}
          h={60}
          tone={p.tone}
          title={p.title}
          sub={p.sub}
          align="middle"
        />
      ))}
      <Arrow id={id} d={`M ${C.x + 70} ${C.y - 130} Q ${C.x + 160} ${C.y - 130} ${C.x + 160} ${C.y - 34}`} tone="gpu" />
      <Label x={C.x + 150} y={C.y - 120} tone="gpu" size={11} anchor="start">
        vkAcquireNextImageKHR
      </Label>
      <Label x={C.x + 150} y={C.y - 104} tone="gpu" size={11} anchor="start">
        imageAvailable signals
      </Label>
      <Badge n={6} x={C.x + 160} y={C.y - 70} tone="gpu" />
      <Arrow
        id={id}
        d={`M ${C.x + 160} ${C.y + 30} Q ${C.x + 160} ${C.y + 130} ${C.x + 74} ${C.y + 130}`}
        tone="display"
      />
      <Label x={C.x + 172} y={C.y + 92} tone="display" size={11} anchor="start">
        vkQueuePresentKHR
      </Label>
      <Label x={C.x + 172} y={C.y + 108} tone="display" size={11} anchor="start">
        waits renderFinished[i]
      </Label>
      <Badge n={7} x={C.x + 160} y={C.y + 70} tone="display" />
      <Arrow
        id={id}
        d={`M ${C.x - 70} ${C.y + 130} Q ${C.x - 160} ${C.y + 130} ${C.x - 160} ${C.y + 34}`}
        tone="display"
      />
      <Label x={C.x - 130} y={C.y + 156} tone="display" size={11}>
        next refresh
      </Label>
      <Arrow
        id={id}
        d={`M ${C.x - 160} ${C.y - 30} Q ${C.x - 160} ${C.y - 130} ${C.x - 74} ${C.y - 130}`}
        tone="plain"
      />
      <Label x={C.x - 130} y={C.y - 148} size={11}>
        let go
      </Label>
      <Text x={C.x} y={C.y - 6} anchor="middle" className="fill-neutral-300 text-[12px]">
        4 images (X11)
      </Text>
      <Text x={C.x} y={C.y + 12} anchor="middle" className="fill-neutral-300 text-[12px]">
        5 images (Wayland)
      </Text>
      <Text x={20} y={480} className="fill-neutral-400 text-[12px]">
        MAILBOX: a newer present replaces one still waiting, so nothing waits for the refresh.
      </Text>
      <Badge n={8} x={C.x + 186} y={C.y + 128} tone="display" />

      <Text x={540} y={26} className="fill-white text-[14px] font-semibold">
        What your code chose on this laptop
      </Text>
      {[
        { n: 1, k: "Formats offered", x11: "2, both BGRA", wl: "14" },
        { n: 2, k: "Format chosen", x11: "B8G8R8A8_SRGB (fallback)", wl: "R8G8B8A8_UNORM" },
        { n: 3, k: "Present mode", x11: "MAILBOX", wl: "MAILBOX" },
        { n: 4, k: "Images", x11: "4 (minimum 3)", wl: "5 (minimum 4)" },
        { n: 5, k: "Usage", x11: "TRANSFER_DST only", wl: "TRANSFER_DST only" },
      ].map((r, i) => (
        <g key={r.k}>
          <Badge n={r.n} x={548} y={70 + i * 34} tone="display" />
          <Text x={566} y={74 + i * 34} className="fill-neutral-300 text-[12.5px]">
            {r.k}
          </Text>
          <Text
            x={680}
            y={74 + i * 34}
            className={i === 1 ? "fill-coral text-[12.5px] font-semibold" : "fill-white text-[12.5px]"}
          >
            {r.x11}
          </Text>
          <Text x={862} y={74 + i * 34} className="fill-white text-[12.5px]">
            {r.wl}
          </Text>
        </g>
      ))}
      <Text x={680} y={48} className="fill-neutral-400 text-[11.5px]">
        X11
      </Text>
      <Text x={862} y={48} className="fill-neutral-400 text-[11.5px]">
        Wayland
      </Text>

      <rect x={540} y={250} width={440} height={220} rx={12} className="fill-coral/5 stroke-coral/40" />
      <Text x={560} y={276} className="fill-coral text-[13.5px] font-semibold">
        Why the red sphere turns blue through X11
      </Text>
      {["R", "G", "B", "A"].map((ch, i) => (
        <g key={ch}>
          <rect x={560 + i * 40} y={292} width={36} height={36} rx={5} className="fill-mint/10 stroke-mint/60" />
          <Text x={578 + i * 40} y={315} anchor="middle" className="fill-white text-[13px] font-semibold">
            {ch}
          </Text>
        </g>
      ))}
      <Text x={560} y={346} className="fill-neutral-300 text-[11.5px]">
        storageImage: R8G8B8A8
      </Text>
      <Arrow id={id} d="M 724 310 L 788 310" tone="gpu" />
      <Text x={756} y={300} anchor="middle" className="fill-[#a58bf0] text-[11px]">
        a plain copy
      </Text>
      {["B", "G", "R", "A"].map((ch, i) => (
        <g key={ch}>
          <rect x={796 + i * 40} y={292} width={36} height={36} rx={5} className="fill-fuchsia/10 stroke-fuchsia/60" />
          <Text x={814 + i * 40} y={315} anchor="middle" className="fill-white text-[13px] font-semibold">
            {ch}
          </Text>
        </g>
      ))}
      <Text x={796} y={346} className="fill-neutral-300 text-[11.5px]">
        swapchain: B8G8R8A8
      </Text>
      <rect x={560} y={366} width={60} height={60} rx={8} fill={`rgb(${red.join(",")})`} />
      <Text x={590} y={444} anchor="middle" className="fill-neutral-300 text-[11.5px]">
        what you wrote
      </Text>
      <Arrow id={id} d="M 630 396 L 700 396" tone="problem" />
      <rect x={710} y={366} width={60} height={60} rx={8} fill={`rgb(${[...red].reverse().join(",")})`} />
      <Text x={740} y={444} anchor="middle" className="fill-neutral-300 text-[11.5px]">
        what X11 shows
      </Text>
      <Text x={790} y={386} className="fill-neutral-300 text-[12px]">
        A copy never converts.
      </Text>
      <Text x={790} y={404} className="fill-neutral-300 text-[12px]">
        The bytes stay put, and
      </Text>
      <Text x={790} y={422} className="fill-neutral-300 text-[12px]">
        their meaning changes.
      </Text>
    </Figure>
  );
}

export function Timing() {
  const id = "fig-timing";
  const ms = 0.812072;
  const ticks = Math.round((ms * 1e6) / IRIS_XE.timestampNs);
  const paths = 480000 / (ms / 1000) / 1e6;
  const bar = (x: number, w: number, tone: keyof typeof TONES, text: string) => (
    <g key={`${x}-${text}`}>
      <rect x={x} y={70} width={w} height={46} rx={6} className={TONES[tone].box} strokeWidth={1.2} />
      {text && (
        <Text x={x + w / 2} y={98} anchor="middle" className="fill-white text-[12px]">
          {text}
        </Text>
      )}
    </g>
  );
  return (
    <Figure
      id={id}
      w={1000}
      h={380}
      label="Inside one frame's command buffer, a timestamp is written before and after the dispatch. The difference in ticks times 52.08 nanoseconds gives milliseconds; after 100 warm-up frames, 1,000 frames are averaged and turned into paths per second."
    >
      <Text x={20} y={34} className="fill-white text-[14px] font-semibold">
        One frame on the GPU
      </Text>
      {bar(20, 90, "gpu", "reset queries")}
      {bar(116, 100, "gpu", "barriers")}
      {bar(280, 420, "shader", `dispatch: ${ms.toFixed(3)} ms through X11`)}
      {bar(764, 216, "gpu", "barrier, copy, barrier")}
      {[
        { x: 248, label: "t0 at TOP_OF_PIPE", n: 3 },
        { x: 732, label: "t1 at BOTTOM_OF_PIPE", n: 5 },
      ].map((t) => (
        <g key={t.label}>
          <line x1={t.x} y1={58} x2={t.x} y2={128} className="stroke-sand" strokeWidth={3} />
          <Label x={t.x} y={146} tone="cpu" size={11}>
            {t.label}
          </Label>
          <Badge n={t.n} x={t.x} y={52} tone="cpu" />
        </g>
      ))}
      <path d="M 248 162 L 248 170 L 732 170 L 732 162" fill="none" className="stroke-sand" />
      <Text x={490} y={188} anchor="middle" className="fill-sand text-[12px]">
        what the benchmark measures
      </Text>
      <Badge n={2} x={20} y={70} tone="gpu" />
      <Badge n={4} x={280} y={70} tone="shader" />
      <Badge n={1} x={232} y={29} tone="gpu" />
      <Text x={250} y={34} className="fill-neutral-400 text-[12px]">
        a query pool with room for 2, made once
      </Text>

      <rect x={20} y={214} width={470} height={140} rx={10} className="fill-white/5 stroke-white/15" />
      <Badge n={7} x={40} y={286} tone="cpu" />
      <Text x={60} y={240} className="fill-white text-[13.5px] font-semibold">
        The maths
      </Text>
      <Text
        x={60}
        y={266}
        className="fill-neutral-200 text-[13px]"
      >{`t1 − t0 ≈ ${ticks.toLocaleString("en-GB")} ticks`}</Text>
      <Text
        x={60}
        y={290}
        className="fill-neutral-200 text-[13px]"
      >{`× ${IRIS_XE.timestampNs} ns a tick = ${ms.toFixed(3)} ms`}</Text>
      <Text
        x={60}
        y={314}
        className="fill-neutral-200 text-[13px]"
      >{`480,000 paths ÷ ${(ms / 1000).toFixed(6)} s ≈ ${Math.round(paths)} million a second`}</Text>
      <Badge n={9} x={40} y={310} tone="cpu" />
      <Text x={60} y={340} className="fill-neutral-400 text-[12px]">
        One path is up to 8 rays, so rays a second are about twice that.
      </Text>

      <Text x={520} y={240} className="fill-white text-[13.5px] font-semibold">
        Over the whole run
      </Text>
      <rect x={520} y={256} width={46} height={30} rx={4} className="fill-white/10" />
      <rect x={570} y={256} width={410} height={30} rx={4} className="fill-aqua/20 stroke-aqua/50" />
      <Text x={543} y={276} anchor="middle" className="fill-neutral-300 text-[11px]">
        100
      </Text>
      <Text x={775} y={276} anchor="middle" className="fill-white text-[12px]">
        1,000 frames timed: mean, min, max
      </Text>
      <Text x={520} y={306} className="fill-neutral-400 text-[12px]">
        Warm-up frames are skipped while clocks rise.
      </Text>
      <Badge n={8} x={506} y={271} tone="shader" />
      <Text x={520} y={332} className="fill-neutral-300 text-[12px]">
        Each frame reads the previous frame&apos;s pair, after the fence:
      </Text>
      <Text x={520} y={350} className="fill-neutral-300 text-[12px]">
        by then the GPU has certainly written them.
      </Text>
      <Badge n={6} x={506} y={328} tone="cpu" />
    </Figure>
  );
}
