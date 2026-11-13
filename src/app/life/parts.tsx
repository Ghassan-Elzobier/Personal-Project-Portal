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
      <p className="text-sm text-body">
        Your height, age and food rules decide portion sizes, targets and which recipes you see. It takes two minutes,
        and none of it leaves your private database.
      </p>
      <Link href="/life/settings" className="btn-life">
        Open settings
      </Link>
    </section>
  );
}
