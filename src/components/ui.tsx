import Link from "next/link";
import type { ReactNode } from "react";
import { formatHours } from "@/lib/tasks/session-log";
import { shortDate } from "@/lib/dates/week";

/** What a chip's colour says. A tone always means the same thing (docs/DESIGN.md). */
export type Tone = "neutral" | "quiet" | "aqua" | "mint" | "sand" | "coral" | "lilac" | "ice";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/5 text-body ring-white/10",
  quiet: "bg-white/5 text-muted ring-white/10",
  aqua: "bg-aqua/10 text-aqua ring-aqua/30",
  mint: "bg-mint/10 text-mint ring-mint/30",
  sand: "bg-sand/10 text-sand ring-sand/30",
  coral: "bg-coral/10 text-coral ring-coral/30",
  lilac: "bg-lavender/10 text-lilac ring-lavender/30",
  ice: "bg-ice/10 text-ice ring-ice/30",
};

/** A chip's colours, for a chip that is also a link. */
export function toneClass(tone: Tone): string {
  return TONES[tone];
}

/** A few words that name a state or a kind. The colour backs up the word, never replaces it. */
export function Chip({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span className={`chip whitespace-nowrap ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

const STAGE_TONES: Record<string, Tone> = {
  "Not started": "neutral",
  "In progress": "aqua",
  Blocked: "coral",
  "Needs review": "sand",
  Done: "mint",
};

export function StagePill({ stage }: { stage: string | null }) {
  if (!stage) return null;
  return <Chip tone={STAGE_TONES[stage] ?? "neutral"}>{stage}</Chip>;
}

const STATUSES: Record<string, { label: string; tone: Tone }> = {
  on_track: { label: "On track", tone: "mint" },
  at_risk: { label: "At risk", tone: "sand" },
  off_track: { label: "Off track", tone: "coral" },
  on_hold: { label: "On hold", tone: "neutral" },
  complete: { label: "Complete", tone: "lilac" },
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUSES[status] ?? STATUSES.on_hold;
  return <Chip tone={style.tone}>{style.label}</Chip>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 space-y-2">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="text-heading">{title}</h1>
      {children && <div className="max-w-2xl subtext">{children}</div>}
    </header>
  );
}

export function ErrorNote({ title, message }: { title?: string; message: string }) {
  return (
    <div className="rounded-xl bg-coral/10 p-4 text-sm text-coral ring-1 ring-coral/30" role="alert">
      {title && <p className="font-semibold">{title}</p>}
      <p>{message}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-white/5 p-4 text-sm text-muted">{children}</p>;
}

export function Hours({ value }: { value: number }) {
  return <span className="tabular-nums">{formatHours(value)} h</span>;
}

/** A wide table or chart that scrolls sideways on a phone. It takes focus, so a keyboard can scroll it too. */
export function ScrollX({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto ${className}`}>
      {children}
    </div>
  );
}

export function DueDate({ dueOn, today }: { dueOn: string | null; today: string }) {
  if (!dueOn) return null;
  const overdue = dueOn < today;
  const label = dueOn === today ? "Due today" : overdue ? `Overdue, ${shortDate(dueOn)}` : `Due ${shortDate(dueOn)}`;
  return <span className={overdue ? "text-coral" : dueOn === today ? "text-sand" : "text-muted"}>{label}</span>;
}

export function EvidenceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link">
      Evidence
    </a>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-xl font-semibold">{children}</h2>
      {action}
    </div>
  );
}

/** A task's link: same tab inside the portal, new tab when it points to Asana. */
export function TaskLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} scroll={false} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
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
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" role="img" aria-label={`${label}: ${sub}`}>
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
      <span className="text-xs text-muted tabular-nums">{sub}</span>
    </div>
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
          className={`flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-sm ${t.key === current ? "bg-fern font-semibold text-white" : "text-muted hover:text-white"}`}
        >
          <span className="truncate">{t.label}</span>
          {t.count ? <span className="text-xs text-mint tabular-nums">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
