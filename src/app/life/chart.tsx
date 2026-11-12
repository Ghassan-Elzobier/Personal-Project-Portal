import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";

// A small line chart drawn on the server: points, an optional smoothed line and
// an optional goal. It scales to the width of its card, so it never pushes a
// phone screen sideways.

type Point = { x: string; y: number };

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 40 };

export function LineChart({ points, smooth, goal, unit, label }: { points: Point[]; smooth?: Point[]; goal?: number; unit: string; label: string }) {
  const all = [...points, ...(smooth ?? [])];
  if (!all.length) return null;
  const t = (d: string) => new Date(`${d}T12:00:00Z`);
  const xs = all.map((p) => t(p.x).getTime());
  const ys = all.map((p) => p.y);
  const lo = Math.min(...ys, goal !== undefined && goal < Math.min(...ys) + 25 ? goal : Infinity);
  const hi = Math.max(...ys, goal !== undefined && goal - Math.max(...ys) < 25 ? goal : -Infinity);
  const span = Math.max(1, hi - lo);
  const x = scaleTime()
    .domain([new Date(Math.min(...xs) - 86_400_000), new Date(Math.max(...xs) + 86_400_000)])
    .range([PAD.left, W - PAD.right]);
  const y = scaleLinear()
    .domain([lo - span * 0.15, hi + span * 0.15])
    .nice(4)
    .range([H - PAD.bottom, PAD.top]);
  const path = line<Point>()
    .x((p) => x(t(p.x)))
    .y((p) => y(p.y));
  const ticks = y.ticks(4);
  const xticks = x.ticks(4);
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const last = points[points.length - 1];
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}. Latest ${last ? `${last.y} ${unit}` : "none"}.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="rgb(255 255 255 / 0.06)" />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="12" fill="rgb(163 163 163)">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {xticks.map((d) => (
          <text key={d.toISOString()} x={x(d)} y={H - 6} textAnchor="middle" fontSize="12" fill="rgb(115 115 115)">
            {fmt.format(d)}
          </text>
        ))}
        {goal !== undefined && y(goal) >= PAD.top && y(goal) <= H - PAD.bottom && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(goal)} y2={y(goal)} stroke="var(--color-sand)" strokeDasharray="6 5" strokeWidth="1.5" />
            <text x={W - PAD.right} y={y(goal) - 6} textAnchor="end" fontSize="12" fill="var(--color-sand)">
              Goal {goal} {unit}
            </text>
          </g>
        )}
        {smooth && smooth.length > 1 && <path d={path(smooth) ?? ""} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" />}
        {!smooth && points.length > 1 && <path d={path(points) ?? ""} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" />}
        {points.map((p) => (
          <circle key={p.x} cx={x(t(p.x))} cy={y(p.y)} r={smooth ? 3 : 4} fill={smooth ? "rgb(255 255 255 / 0.45)" : "var(--color-mint)"} />
        ))}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
