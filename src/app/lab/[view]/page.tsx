import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/access";
import { CODE_MAP, PARTS, RENDERER, VIEWS, codeHref, viewById } from "@/lib/lab/guide";
import { bookHref } from "@/lib/library/links";
import { attempt } from "@/lib/portal/data";
import { findUnit } from "@/lib/study/plans";
import { loadStudy } from "@/lib/study/load";
import { LinkPending } from "@/components/link-pending";
import { PageHeader } from "@/components/ui";
import { Legend } from "../kit";
import { BookLinks, CodeLinks, FindingCard, SourceChip } from "../shared";
import { ViewFigure } from "../view-figure";

export const dynamic = "force-dynamic";

type Params = { view: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const v = viewById((await params).view);
  return { title: v ? `${v.title} · Lab` : "Lab" };
}

export default async function LabView({ params }: { params: Promise<Params> }) {
  await requireOwner();
  const view = viewById((await params).view);
  if (!view) notFound();

  const index = VIEWS.indexOf(view);
  const prev = VIEWS[index - 1];
  const next = VIEWS[index + 1];

  // The plan units this view helps with, linked to their tasks when the plan is loaded.
  const study = await attempt(() => loadStudy());
  const rows = study.ok ? study.value.plans.flatMap((p) => p.rows) : [];
  const units = view.units.flatMap((ref) => {
    const found = findUnit(ref);
    if (!found) return [];
    const row = rows.find((r) => r.unit.ref === ref);
    return [{ ref, name: found.unit.name, done: row?.task.completed ?? false, href: row ? `/study?project=${row.task.project}&task=${row.task.gid}` : `/study?project=${found.plan.project}` }];
  });

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-2 text-sm text-neutral-400">
        <Link href="/lab" className="hover:text-white">Lab</Link>
        <span aria-hidden>/</span>
        <Link href={`/lab#part-${view.part}`} className="hover:text-white">{PARTS.find((p) => p.id === view.part)?.title}</Link>
        <span aria-hidden>/</span>
        <span>View {index + 1} of {VIEWS.length}</span>
      </nav>

      <PageHeader title={view.title}>{view.claim}</PageHeader>

      <section aria-label="Figure" className="space-y-3">
        <Legend />
        <ViewFigure id={view.id} />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="steps-title" className="space-y-3">
          <h2 id="steps-title" className="text-xl font-semibold">What happens</h2>
          <ol className="space-y-3">
            {view.steps.map((s, i) => (
              <li key={s.title} id={`step-${i + 1}`} className="flex scroll-mt-24 gap-3 rounded-xl p-2 target:bg-white/5 target:ring-1 target:ring-white/20">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-white/30 tabular-nums">{i + 1}</span>
                <div className="space-y-1">
                  <p className="font-semibold">{s.title}</p>
                  <p className="text-sm text-neutral-300">{s.text}</p>
                  {s.code && <CodeLinks refs={s.code} />}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-neutral-400">Code links open the lines at commit {RENDERER.short}.</p>
          <div className="space-y-1 pt-2">
            <h3 className="text-sm font-semibold">All the code this view explains</h3>
            <ul className="space-y-1 text-sm">
              {CODE_MAP.filter((c) => c.views.includes(view.id)).map((c) => (
                <li key={`${c.file}-${c.from}`}>
                  <a href={codeHref([c.file, c.from, c.to])} target="_blank" rel="noreferrer" className="font-mono text-xs text-aqua hover:underline">{c.file === "main" ? "main.cpp" : c.file === "shader" ? "raytrace.comp" : "CMakeLists.txt"}:{c.from}–{c.to}</a>{" "}
                  <span className="text-neutral-300">{c.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-6">
          <section aria-labelledby="book-title" className="space-y-2">
            <h2 id="book-title" className="font-semibold">In PMPP</h2>
            {view.bookNote && <p className="text-sm text-neutral-300">{view.bookNote}</p>}
            <ul className="space-y-3">
              {view.book.map((b) => (
                <li key={b.section} className="space-y-1 text-sm">
                  <p><span className="font-semibold tabular-nums">{b.section}</span> {b.title} <span className="text-neutral-400">· p. {b.page}</span></p>
                  <p className="text-neutral-300">{b.why}</p>
                  <BookLinks page={b.page} />
                </li>
              ))}
            </ul>
            <form action="/library" className="flex gap-2 pt-1">
              <label htmlFor="ask" className="sr-only">Search the book</label>
              <input id="ask" name="q" placeholder="Search the book, in Vulkan words if you like" className="field-input mt-0" />
              <button className="btn-ghost shrink-0 px-4 py-1.5">Search</button>
            </form>
          </section>

          {units.length > 0 && (
            <section aria-labelledby="plan-title" className="space-y-2">
              <h2 id="plan-title" className="font-semibold">In your plan</h2>
              <ul className="space-y-1 text-sm">
                {units.map((u) => (
                  <li key={u.ref}>
                    <Link href={u.href} className="hover:underline">{u.name}{u.done ? " ✓" : ""}<LinkPending /></Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="facts-title" className="space-y-2">
            <h2 id="facts-title" className="font-semibold">Numbers</h2>
            <dl className="space-y-2 text-sm">
              {view.facts.map((f) => (
                <div key={f.label}>
                  <dt className="flex flex-wrap items-center gap-2 text-neutral-400">{f.label} <SourceChip source={f.source} /></dt>
                  <dd className="tabular-nums">{f.value}</dd>
                  {f.note && <dd className="text-xs text-neutral-400">{f.note}</dd>}
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>

      {view.findings && view.findings.length > 0 && (
        <section aria-labelledby="findings-title" className="space-y-3">
          <h2 id="findings-title" className="text-xl font-semibold">Found in this part</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {view.findings.map((f) => <FindingCard key={f.title} finding={f} />)}
          </div>
        </section>
      )}

      <section aria-labelledby="checks-title" className="space-y-3">
        <h2 id="checks-title" className="text-xl font-semibold">Check yourself</h2>
        <p className="text-sm text-neutral-400">Answer from memory first, then open the answer.</p>
        <div className="space-y-2">
          {view.checks.map((c) => (
            <details key={c.q} className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
              <summary className="cursor-pointer font-medium">{c.q}</summary>
              <p className="mt-2 text-sm text-neutral-300">{c.a}</p>
            </details>
          ))}
        </div>
      </section>

      <nav aria-label="Views" className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-4 text-sm">
        {prev ? <Link href={`/lab/${prev.id}`} className="hover:text-white text-neutral-300">← {prev.title}<LinkPending /></Link> : <Link href="/lab" className="text-neutral-300 hover:text-white">← All views</Link>}
        {next ? <Link href={`/lab/${next.id}`} className="text-neutral-300 hover:text-white">{next.title} →<LinkPending /></Link> : <Link href={bookHref.search("warp divergence")} className="text-neutral-300 hover:text-white">Search the book →</Link>}
      </nav>
    </div>
  );
}
