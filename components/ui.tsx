import Link from "next/link";
import type { ReactNode } from "react";
import { formatHours } from "@/lib/session-log";
import { shortDate } from "@/lib/week";

const STAGE_STYLES: Record<string, string> = {
  "Not started": "bg-white/5 text-neutral-300 ring-white/10",
  "In progress": "bg-aqua/10 text-aqua ring-aqua/30",
  Blocked: "bg-coral/10 text-coral ring-coral/30",
  "Needs review": "bg-sand/10 text-sand ring-sand/30",
  Done: "bg-mint/10 text-mint ring-mint/30",
};

export function StagePill({ stage }: { stage: string | null }) {
  if (!stage) return null;
  return <span className={`chip ${STAGE_STYLES[stage] ?? STAGE_STYLES["Not started"]}`}>{stage}</span>;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  on_track: { label: "On track", className: "bg-mint/10 text-mint ring-mint/30" },
  at_risk: { label: "At risk", className: "bg-sand/10 text-sand ring-sand/30" },
  off_track: { label: "Off track", className: "bg-coral/10 text-coral ring-coral/30" },
  on_hold: { label: "On hold", className: "bg-white/5 text-neutral-300 ring-white/10" },
  complete: { label: "Complete", className: "bg-lavender/10 text-lavender ring-lavender/30" },
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.on_hold;
  return <span className={`chip ${style.className}`}>{style.label}</span>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 space-y-2">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="text-heading">{title}</h1>
      {children && <div className="subtext max-w-2xl">{children}</div>}
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
  return <p className="rounded-xl bg-white/5 p-4 text-sm text-neutral-400">{children}</p>;
}

export function Hours({ value }: { value: number }) {
  return <span className="tabular-nums">{formatHours(value)} h</span>;
}

export function DueDate({ dueOn, today }: { dueOn: string | null; today: string }) {
  if (!dueOn) return null;
  const overdue = dueOn < today;
  const label = dueOn === today ? "Due today" : overdue ? `Overdue, ${shortDate(dueOn)}` : `Due ${shortDate(dueOn)}`;
  return <span className={overdue ? "text-coral" : dueOn === today ? "text-sand" : "text-neutral-400"}>{label}</span>;
}

export function EvidenceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-aqua underline-offset-4 hover:underline">
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

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm text-neutral-400 transition-colors hover:text-white">
      {children}
    </Link>
  );
}
