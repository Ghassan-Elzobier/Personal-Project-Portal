import Link from "next/link";
import { codeHref, codeLabel, type CodeRef, type Finding, type Source } from "@/lib/lab/guide";
import { bookHref } from "@/lib/library/links";
import { RENDERER } from "@/lib/lab/guide";
import type { Drift } from "@/lib/lab/drift";
// Pieces the Lab hub and the view pages share. The figures themselves are in
// view-figure.tsx, so the hub does not load the interactive ones.

/** Links to the lines, on GitHub, at the commit the figures were drawn from. */
export function CodeLinks({ refs }: { refs: readonly CodeRef[] }) {
  if (!refs.length) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {refs.map((r) => (
        <a
          key={codeLabel(r)}
          href={codeHref(r)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-aqua underline-offset-4 hover:underline"
        >
          {codeLabel(r)}
        </a>
      ))}
    </span>
  );
}

const SOURCE: Record<Source, { label: string; className: string; title: string }> = {
  measured: {
    label: "Measured",
    className: "bg-mint/10 text-mint ring-mint/30",
    title: "Read off the Iris Xe laptop, or from docs/benchmark.md",
  },
  model: {
    label: "Model",
    className: "bg-aqua/10 text-aqua ring-aqua/30",
    title: "Computed by running the shader's logic in TypeScript",
  },
  published: {
    label: "Published",
    className: "bg-sand/10 text-sand ring-sand/30",
    title: "A vendor's paper figure, not measured here",
  },
  code: {
    label: "From the code",
    className: "bg-white/5 text-neutral-300 ring-white/10",
    title: "Follows directly from the code",
  },
};

export function SourceChip({ source }: { source: Source }) {
  const s = SOURCE[source];
  return (
    <span className={`chip ${s.className}`} title={s.title}>
      {s.label}
    </span>
  );
}

const FINDING: Record<Finding["kind"], { label: string; className: string }> = {
  bug: { label: "Bug, confirmed", className: "bg-coral/10 text-coral ring-coral/30" },
  check: { label: "Worth checking", className: "bg-sand/10 text-sand ring-sand/30" },
  note: { label: "Note", className: "bg-white/5 text-neutral-300 ring-white/10" },
};

export function FindingCard({ finding, view }: { finding: Finding; view?: { id: string; title: string } }) {
  const k = FINDING[finding.kind];
  return (
    <div
      className={`space-y-2 rounded-xl p-4 ring-1 ${finding.kind === "bug" ? "bg-coral/5 ring-coral/30" : "bg-white/5 ring-white/10"}`}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className={`chip ${k.className}`}>{k.label}</span>
        <span className="font-semibold">{finding.title}</span>
      </p>
      <p className="text-sm text-neutral-300">{finding.text}</p>
      {finding.evidence && (
        <p className="text-sm text-neutral-400">
          <span className="text-neutral-300">Evidence:</span> {finding.evidence}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {finding.code && <CodeLinks refs={finding.code} />}
        {view && (
          <Link href={`/lab/${view.id}`} className="text-xs text-neutral-400 hover:text-white">
            In {view.title}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Shown when the renderer's main branch has changed the explained files since the pinned commit. */
export function DriftBanner({ drift }: { drift: Drift | null }) {
  if (!drift) return null;
  return (
    <div role="status" className="rounded-xl bg-sand/10 p-4 text-sm ring-1 ring-sand/30">
      <p className="font-semibold text-sand">The renderer has moved on since these figures were drawn</p>
      <p className="mt-1 text-neutral-200">
        {drift.commits} {drift.commits === 1 ? "commit" : "commits"} on main after {RENDERER.short} change{" "}
        {drift.files.join(", ")}. The figures and line links still describe {RENDERER.short}. Run{" "}
        <span className="font-mono text-xs">npm run lab:check</span> in the portal to see which references moved.{" "}
        <a href={drift.url} target="_blank" rel="noreferrer" className="text-aqua hover:underline">
          See the changes
        </a>
      </p>
    </div>
  );
}

/** A PMPP reference: read the page here, or open the PDF there. */
export function BookLinks({ page }: { page: number }) {
  return (
    <span className="flex flex-wrap gap-x-3 text-xs">
      <Link href={bookHref.page(page)} className="text-aqua underline-offset-4 hover:underline">
        Read p. {page}
      </Link>
      <a href={bookHref.pdf(page)} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-white">
        Open the PDF
      </a>
    </span>
  );
}
