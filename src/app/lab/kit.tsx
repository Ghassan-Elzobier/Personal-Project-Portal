import type { ReactNode } from "react";

// Drawing pieces for the Lab's figures: inline SVG in the portal's palette, with no
// library and no script. One colour per part of the system, used the same way in
// every figure, so the legend on /lab holds for all of them.

export type Tone = "cpu" | "gpu" | "shader" | "memory" | "display" | "problem" | "plain";

export const TONES: Record<Tone, { label: string; box: string; line: string; text: string; dot: string; hex: string }> =
  {
    cpu: {
      label: "CPU and main.cpp",
      box: "fill-sand/10 stroke-sand/70",
      line: "stroke-sand",
      text: "fill-sand",
      dot: "bg-sand",
      hex: "#d6995c",
    },
    gpu: {
      label: "GPU commands and queues",
      box: "fill-lavender/15 stroke-lavender",
      line: "stroke-lavender",
      text: "fill-lilac",
      dot: "bg-lavender",
      hex: "#a58bf0",
    },
    shader: {
      label: "The shader and its lanes",
      box: "fill-aqua/10 stroke-aqua/80",
      line: "stroke-aqua",
      text: "fill-aqua",
      dot: "bg-aqua",
      hex: "#33c2cc",
    },
    memory: {
      label: "Images and memory",
      box: "fill-mint/10 stroke-mint/70",
      line: "stroke-mint",
      text: "fill-mint",
      dot: "bg-mint",
      hex: "#57db96",
    },
    display: {
      label: "The display and swapchain",
      box: "fill-fuchsia/10 stroke-fuchsia/80",
      line: "stroke-fuchsia",
      text: "fill-[#e05aa8]",
      dot: "bg-fuchsia",
      hex: "#e05aa8",
    },
    problem: {
      label: "A problem found",
      box: "fill-coral/15 stroke-coral",
      line: "stroke-coral",
      text: "fill-coral",
      dot: "bg-coral",
      hex: "#ea4884",
    },
    plain: {
      label: "Other",
      box: "fill-white/5 stroke-white/30",
      line: "stroke-muted",
      text: "fill-body",
      dot: "bg-neutral-400",
      hex: "#a3a3a3",
    },
  };

const ARROW_TONES: Tone[] = ["cpu", "gpu", "shader", "memory", "display", "problem", "plain"];

/** A figure: scrolls sideways on a phone rather than shrinking its text away. */
export function Figure({
  id,
  w,
  h,
  label,
  caption,
  children,
  minWidth = 720,
}: {
  id: string;
  w: number;
  h: number;
  label: string;
  caption?: ReactNode;
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <figure className="space-y-3">
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="h-auto w-full" style={{ minWidth }}>
          <defs>
            {ARROW_TONES.map((t) => (
              <marker
                key={t}
                id={`${id}-${t}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={TONES[t].hex} />
              </marker>
            ))}
          </defs>
          {children}
        </svg>
      </div>
      {caption && <figcaption className="max-w-3xl text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}

/** A step marker. Inside a view page it links to the step with the same number. */
export function Badge({ n, x, y, tone = "plain" }: { n: number; x: number; y: number; tone?: Tone }) {
  return (
    <a href={`#step-${n}`} aria-label={`Step ${n}`}>
      <circle cx={x} cy={y} r={11} className="fill-primary" stroke={TONES[tone].hex} strokeWidth={1.5} />
      <text x={x} y={y + 4} textAnchor="middle" className="fill-white text-[12px] font-semibold">
        {n}
      </text>
    </a>
  );
}

export function Box({
  x,
  y,
  w,
  h,
  tone = "plain",
  title,
  sub,
  note,
  n,
  href,
  dashed,
  align = "start",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: Tone;
  title: string;
  sub?: string;
  note?: string;
  n?: number;
  href?: string;
  dashed?: boolean;
  align?: "start" | "middle";
}) {
  const tx = align === "middle" ? x + w / 2 : x + (n ? 26 : 14);
  const lines = [sub, note].filter(Boolean).length;
  const top = y + h / 2 - (lines * 16) / 2 + 4;
  const body = (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        className={TONES[tone].box}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      <text x={tx} y={top} textAnchor={align} className="fill-white text-[14px] font-semibold">
        {title}
      </text>
      {sub && (
        <text x={tx} y={top + 17} textAnchor={align} className="fill-body text-[12px]">
          {sub}
        </text>
      )}
      {note && (
        <text x={tx} y={top + (sub ? 33 : 17)} textAnchor={align} className={`${TONES.shader.text} text-[11.5px]`}>
          {note}
        </text>
      )}
    </g>
  );
  return (
    <g>
      {href ? <a href={href}>{body}</a> : body}
      {n !== undefined && <Badge n={n} x={x + 2} y={y + 2} tone={tone} />}
    </g>
  );
}

/** A label that stays legible over lines, with the page colour behind it. */
export function Label({
  x,
  y,
  children,
  tone = "plain",
  anchor = "middle",
  size = 12,
}: {
  x: number;
  y: number;
  children: string;
  tone?: Tone;
  anchor?: "start" | "middle" | "end";
  size?: number;
}) {
  const width = children.length * size * 0.56 + 10;
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width + 5 : x - 5;
  return (
    <g>
      <rect x={left} y={y - size + 1} width={width} height={size + 6} rx={4} className="fill-primary" />
      <text
        x={x}
        y={y + 2}
        textAnchor={anchor}
        className={`${TONES[tone].text} text-[12px]`}
        style={{ fontSize: size }}
      >
        {children}
      </text>
    </g>
  );
}

/** An arrow along a path, with an optional label at a point of your choosing. */
export function Arrow({
  id,
  d,
  tone = "plain",
  label,
  at,
  dashed,
  both,
  labelAnchor,
}: {
  id: string;
  d: string;
  tone?: Tone;
  label?: string;
  at?: [number, number];
  dashed?: boolean;
  both?: boolean;
  labelAnchor?: "start" | "middle" | "end";
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        className={TONES[tone].line}
        strokeWidth={1.6}
        strokeDasharray={dashed ? "5 4" : undefined}
        markerEnd={`url(#${id}-${tone})`}
        markerStart={both ? `url(#${id}-${tone})` : undefined}
      />
      {label && at && (
        <Label x={at[0]} y={at[1]} tone={tone} anchor={labelAnchor}>
          {label}
        </Label>
      )}
    </g>
  );
}

export function Text({
  x,
  y,
  children,
  className = "fill-muted text-[12px]",
  anchor = "start",
}: {
  x: number;
  y: number;
  children: ReactNode;
  className?: string;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={className}>
      {children}
    </text>
  );
}

/** The colour key, shown once on /lab and above each figure. */
export function Legend({ tones = ["cpu", "gpu", "shader", "memory", "display", "problem"] }: { tones?: Tone[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-body" aria-label="Colour key">
      {tones.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <span className={`inline-block size-2.5 rounded-sm ${TONES[t].dot}`} aria-hidden />
          {TONES[t].label}
        </li>
      ))}
    </ul>
  );
}
