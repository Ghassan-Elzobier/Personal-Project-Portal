import { shortDate } from "@/lib/dates/week";

// A count per day as bars: how often something happened over the last days.
// Full size, the bars fill their card and the dates sit underneath as text, so
// they stay readable on a phone. Compact, it is a small trend for a list row.
// The bars are coral because they count errors; zero days show as a faint line.

type Day = { day: string; count: number };

const STEP = 10;
const BAR = 8;
const HEIGHT = 40;

function summary(days: Day[]): string {
  const total = days.reduce((sum, d) => sum + d.count, 0);
  if (!total) return `none in ${days.length} days`;
  const peak = days.reduce((top, d) => (d.count > top.count ? d : top), days[0]);
  return `${total} in ${days.length} days, most on ${shortDate(peak.day)} (${peak.count})`;
}

export function DailyBars({ days, label, size = "full" }: { days: Day[]; label: string; size?: "full" | "compact" }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const text = summary(days);
  const bars = (
    <svg
      viewBox={`0 0 ${days.length * STEP} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${text}`}
      className={size === "compact" ? "h-6 w-20 shrink-0" : "h-28 w-full"}
    >
      {days.map((d, i) => {
        const height = d.count ? Math.max(2, (d.count / max) * HEIGHT) : 1.5;
        return (
          <rect
            key={d.day}
            x={i * STEP + (STEP - BAR) / 2}
            y={HEIGHT - height}
            width={BAR}
            height={height}
            className={d.count ? "fill-coral" : "fill-white/15"}
          />
        );
      })}
    </svg>
  );
  if (size === "compact") return bars;
  return (
    <figure className="space-y-2">
      {bars}
      <figcaption className="flex flex-wrap justify-between gap-x-4 text-xs text-muted tabular-nums">
        <span>{days.length ? shortDate(days[0].day) : ""}</span>
        <span>{text}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
