import Link from "next/link";
import type { ReactNode } from "react";
import { clock, shortDate } from "@/lib/dates/week";

// Server-rendered pieces shared by the Life pages.

export function LifeHeader({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="eyebrow text-mint/80">{eyebrow}</p>}
        <h1 className="text-heading">{title}</h1>
        {children && <div className="max-w-2xl subtext">{children}</div>}
      </div>
      {action}
    </header>
  );
}

/** A progress ring, for the week's effort. */
export function Ring({
  value,
  max,
  label,
  sub,
  color = "var(--color-mint)",
}: {
  value: number;
  max: number;
  label: string;
  sub: string;
  color?: string;
}) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" role="img" aria-label={`${label}: ${sub}`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${share * c} ${c}`}
        />
      </svg>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-neutral-400 tabular-nums">{sub}</span>
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "mint" | "sand" | "aqua" | "coral" | "ice";
}) {
  const tones = {
    neutral: "bg-white/5 text-neutral-300 ring-white/10",
    mint: "bg-mint/10 text-mint ring-mint/25",
    sand: "bg-sand/10 text-sand ring-sand/25",
    aqua: "bg-aqua/10 text-aqua ring-aqua/25",
    coral: "bg-coral/10 text-coral ring-coral/25",
    ice: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  };
  return <span className={`chip whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(
    d,
  );
}

export function weekRange(start: string, end: string): string {
  return `${weekdayShort(start)} ${shortDate(start)} to ${weekdayShort(end)} ${shortDate(end)}`;
}

export { clock };

export function SetupCard() {
  return (
    <section className="space-y-3 card-life">
      <h2 className="text-lg font-semibold">Set up your profile first</h2>
      <p className="text-sm text-neutral-300">
        Your height, age and food rules decide portion sizes, targets and which recipes you see. It takes two minutes,
        and none of it leaves your private database.
      </p>
      <Link href="/life/settings" className="btn-life">
        Open settings
      </Link>
    </section>
  );
}

/** Tabs as links, so each one has its own URL and the back button works. */
export function Tabs({
  tabs,
  current,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
}) {
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 rounded-2xl bg-white/5 p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === current ? "page" : undefined}
          className={`flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-sm ${t.key === current ? "bg-fern font-semibold text-white" : "text-neutral-400 hover:text-white"}`}
        >
          <span className="truncate">{t.label}</span>
          {t.count ? <span className="text-xs text-mint tabular-nums">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
