import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";

// Small charts drawn on the server. They scale to the width of their card, so they
// never push a phone screen sideways. LineChart: points, an optional smoothed line and
// an optional goal. ForecastChart: a balance day by day, with the buffer, the lowest
// point and the paydays marked, and optionally a second, dashed line beside it.

type Point = { x: string; y: number };

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 40 };

export function LineChart({
  points,
  smooth,
  goal,
  unit,
  label,
}: {
  points: Point[];
  smooth?: Point[];
  goal?: number;
  unit: string;
  label: string;
}) {
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
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}. Latest ${last ? `${last.y} ${unit}` : "none"}.`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="rgb(255 255 255 / 0.06)" />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-xs">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {xticks.map((d) => (
          <text key={d.toISOString()} x={x(d)} y={H - 6} textAnchor="middle" className="fill-faint text-xs">
            {fmt.format(d)}
          </text>
        ))}
        {goal !== undefined && y(goal) >= PAD.top && y(goal) <= H - PAD.bottom && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(goal)}
              y2={y(goal)}
              stroke="var(--color-sand)"
              strokeDasharray="6 5"
              strokeWidth="1.5"
            />
            <text x={W - PAD.right} y={y(goal) - 6} textAnchor="end" className="fill-sand text-xs">
              Goal {goal} {unit}
            </text>
          </g>
        )}
        {smooth && smooth.length > 1 && (
          <path d={path(smooth) ?? ""} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" />
        )}
        {!smooth && points.length > 1 && (
          <path d={path(points) ?? ""} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" />
        )}
        {points.map((p) => (
          <circle
            key={p.x}
            cx={x(t(p.x))}
            cy={y(p.y)}
            r={smooth ? 3 : 4}
            fill={smooth ? "rgb(255 255 255 / 0.45)" : "var(--color-mint)"}
          />
        ))}
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

const pounds0 = (pence: number) => {
  const v = Math.round(pence / 100);
  return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB")}`;
};

/**
 * A balance day by day (pence): the line, a dashed buffer line from the day it starts,
 * the lowest point marked (coral when it is under the buffer), and a tick at each payday.
 * `pace`, when given, is a second balance (at your recent spending), drawn dashed and muted.
 * `best`, when given, is the best case (spending kept to the plan's floor), drawn dotted.
 */
export function ForecastChart({
  points,
  buffer,
  bufferFrom,
  lowest,
  paydays,
  label,
  pace,
  best,
}: {
  points: { day: string; pence: number }[];
  pace?: { day: string; pence: number }[];
  best?: { day: string; pence: number }[];
  buffer: number;
  bufferFrom: string | null;
  lowest: { day: string; pence: number };
  paydays: string[];
  label: string;
}) {
  if (points.length < 2) return null;
  // Narrower than LineChart's drawing, so its labels stay readable on a 360 px phone.
  const W = 360;
  const H = 190;
  const PAD = { top: 14, right: 6, bottom: 22, left: 40 };
  const t = (d: string) => new Date(`${d}T12:00:00Z`);
  const first = points[0].day;
  const last = points[points.length - 1].day;
  const ys = [...points, ...(pace ?? []), ...(best ?? [])].map((p) => p.pence);
  const lo = Math.min(...ys, buffer > 0 ? buffer : Infinity, 0);
  const hi = Math.max(...ys, buffer);
  const span = Math.max(100, hi - lo);
  const x = scaleTime()
    .domain([t(first), t(last)])
    .range([PAD.left + 8, W - PAD.right]);
  const y = scaleLinear()
    .domain([lo - span * 0.08, hi + span * 0.12])
    .nice(4)
    .range([H - PAD.bottom, PAD.top]);
  const path = line<{ day: string; pence: number }>()
    .x((p) => x(t(p.day)))
    .y((p) => y(p.pence));
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const bufferStart = bufferFrom && bufferFrom > first ? bufferFrom : first;
  const under = lowest.pence < (bufferFrom && lowest.day < bufferFrom ? 0 : buffer);
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line
              x1={PAD.left + 8}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? "rgb(255 255 255 / 0.25)" : "rgb(255 255 255 / 0.06)"}
            />
            <text x={PAD.left + 2} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted text-xs">
              {pounds0(v)}
            </text>
          </g>
        ))}
        {x.ticks(4).map((d) => (
          <text key={d.toISOString()} x={x(d)} y={H - 6} textAnchor="middle" className="fill-faint text-xs">
            {fmt.format(d)}
          </text>
        ))}
        {paydays.map((d) => (
          <line
            key={d}
            x1={x(t(d))}
            x2={x(t(d))}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="rgb(255 255 255 / 0.12)"
            strokeDasharray="2 4"
          />
        ))}
        {buffer > 0 && bufferStart <= last && (
          <g>
            <line
              x1={x(t(bufferStart))}
              x2={W - PAD.right}
              y1={y(buffer)}
              y2={y(buffer)}
              stroke="var(--color-sand)"
              strokeDasharray="6 5"
              strokeWidth="1.5"
            />
            <text x={W - PAD.right} y={y(buffer) - 6} textAnchor="end" className="fill-sand text-xs">
              Buffer {pounds0(buffer)}
            </text>
          </g>
        )}
        {pace && pace.length > 1 && (
          <path d={path(pace) ?? ""} fill="none" stroke="var(--color-muted)" strokeDasharray="5 4" strokeWidth="2" />
        )}
        {best && best.length > 1 && (
          <path
            d={path(best) ?? ""}
            fill="none"
            stroke="var(--color-mint)"
            strokeOpacity="0.6"
            strokeDasharray="1 5"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        )}
        <path d={path(points) ?? ""} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" />
        <circle
          cx={x(t(lowest.day))}
          cy={y(lowest.pence)}
          r={5}
          fill={under ? "var(--color-coral)" : "var(--color-sand)"}
        />
      </svg>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
