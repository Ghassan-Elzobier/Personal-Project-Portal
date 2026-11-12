import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/access";
import { VIEWS } from "@/lib/lab/guide";
import { BOOK, BookError, bookOutline, chaptersOf, pdfUploaded, readBook, searchBook, type Outline } from "@/lib/library/book";
import { bookHref } from "@/lib/library/links";
import { splitExcerpt } from "@/lib/library/query";
import { LinkPending } from "@/components/link-pending";
import { Empty, ErrorNote, PageHeader } from "@/components/ui";
import { UploadPdf } from "./upload-pdf";

export const metadata: Metadata = { title: "Book" };
export const dynamic = "force-dynamic";

type Search = { q?: string; chapter?: string; page?: string };

/** Searches that tie the book to the renderer, to show what the search can do. */
const TRY = ["warp divergence", "subgroup ballot", "coalescing", "occupancy registers", "shared variables tiling", "zero-copy", "barrier"];

async function safely<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (!(err instanceof BookError)) console.error(err);
    return { ok: false, error: err instanceof BookError ? err.message : "The library did not answer. Try again in a minute." };
  }
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireOwner();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 300);
  const page = Number.parseInt(params.page ?? "", 10);
  const [outline, hasPdf] = await Promise.all([safely(() => bookOutline()), pdfUploaded()]);
  const chapters = outline.ok ? chaptersOf(outline.value) : [];
  const loaded = outline.ok && outline.value.pages > 0;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={`${BOOK.short} · ${BOOK.edition}`} title="Book">
        Search {BOOK.title} in your own words or in Vulkan&apos;s: a subgroup finds warps, a workgroup finds thread blocks, shared variables find shared memory. Claude searches the same pages through the connector.
      </PageHeader>

      {!outline.ok && <ErrorNote title="The book did not load" message={outline.error} />}
      {outline.ok && !loaded && <LoadCard />}

      {loaded && (
        <form action="/library" className="card space-y-3" role="search">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="q" className="sr-only">Search the book</label>
            <input id="q" name="q" defaultValue={q} placeholder="What do you want to know? e.g. why does divergence cost time" className="field-input mt-0 flex-1" />
            <label htmlFor="chapter" className="sr-only">Chapter</label>
            <select id="chapter" name="chapter" defaultValue={params.chapter ?? ""} className="field-input mt-0 sm:w-56">
              <option value="">Every chapter</option>
              {chapters.map((c) => (
                <option key={c.number} value={c.chapter}>{/^\d+$/.test(c.chapter) ? `Ch ${c.chapter}` : `Appendix ${c.chapter}`} {c.title}</option>
              ))}
            </select>
            <button className="btn-primary shrink-0">Search</button>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            Try
            {TRY.map((t) => (
              <Link key={t} href={bookHref.search(t)} className="chip bg-white/5 text-neutral-300 ring-white/10 hover:bg-white/10">{t}</Link>
            ))}
          </p>
        </form>
      )}

      {loaded && !hasPdf && <UploadPdf />}

      {loaded && Number.isFinite(page) && page > 0 ? (
        <Reader page={page} back={q ? bookHref.search(q, params.chapter) : null} hasPdf={hasPdf} />
      ) : loaded && q ? (
        <Results q={q} chapter={params.chapter ?? null} hasPdf={hasPdf} />
      ) : loaded && outline.ok ? (
        <Contents outline={outline.value} />
      ) : null}
    </div>
  );
}

function LoadCard() {
  return (
    <section className="card-special space-y-3">
      <h2 className="text-xl font-semibold">Load your PDF once</h2>
      <p className="max-w-2xl text-sm text-white/90">
        The book&apos;s pages go from your own PDF into your private database, and nowhere else. Mentors cannot see them. From the portal&apos;s folder, after the migrations are pushed:
      </p>
      <pre className="overflow-x-auto rounded-lg bg-primary/60 p-3 text-xs">npm run load:book -- &quot;/path/to/Programming Massively Parallel Processors.pdf&quot;</pre>
      <p className="text-sm text-white/80">It needs pdftotext (sudo apt install poppler-utils) and takes about a minute. Run it again any time: it replaces the pages.</p>
    </section>
  );
}

async function Results({ q, chapter, hasPdf }: { q: string; chapter: string | null; hasPdf: boolean }) {
  const found = await safely(() => searchBook(q, { chapter, limit: 10 }));
  if (!found.ok) return <ErrorNote title="Search failed" message={found.error} />;
  const { results, translated, groups, matchedEvery } = found.value;
  if (!groups.length) return <Empty>Those are all small words. Try the idea itself, such as &quot;coalescing&quot; or &quot;occupancy&quot;.</Empty>;
  return (
    <section aria-labelledby="results-title" className="space-y-4">
      <div className="space-y-1">
        <h2 id="results-title" className="text-xl font-semibold">{results.length ? `${results.length} ${results.length === 1 ? "page" : "pages"}` : "Nothing found"}</h2>
        {translated.length > 0 && (
          <p className="text-sm text-neutral-400">
            Also searched the book&apos;s words: {translated.map((t) => `${t.to.join(" or ")} for ${t.from}`).join("; ")}.
          </p>
        )}
        {results.length > 0 && matchedEvery < results.length && (
          <p className="text-sm text-neutral-400">{matchedEvery ? `The first ${matchedEvery} match every term. The rest match some of them.` : "No page matches every term, so these match some of them."}</p>
        )}
      </div>
      {results.length === 0 && <Empty>No page uses those words. Try fewer words, or the CUDA name for the idea.</Empty>}
      <ol className="space-y-3">
        {results.map((r) => (
          <li key={r.page} className="card space-y-2">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link href={bookHref.page(r.page)} className="font-semibold hover:underline">{r.heading.split(" › ").at(-1)}<LinkPending /></Link>
              <span className="text-sm text-neutral-400 tabular-nums">p. {r.page}</span>
            </p>
            <p className="text-xs text-neutral-400">
              {r.heading.split(" › ")[0]}
              {r.kind === "figure" && " · describes a figure"}
              {!r.matched_every_term && " · matches some terms"}
            </p>
            <p className="text-sm text-neutral-300">
              {splitExcerpt(r.excerpt).map((run, i) => (run.mark ? <mark key={i} className="rounded bg-aqua/20 px-0.5 text-white">{run.text}</mark> : <span key={i}>{run.text}</span>))}
            </p>
            <p className="flex flex-wrap gap-2 text-sm">
              <Link href={bookHref.page(r.page)} className="btn-ghost px-3 py-1 text-xs">Read the page</Link>
              {hasPdf && <a href={bookHref.pdf(r.page)} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1 text-xs">Open the PDF at p. {r.page}</a>}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function Reader({ page, back, hasPdf }: { page: number; back: string | null; hasPdf: boolean }) {
  const read = await safely(() => readBook({ page, count: 3 }));
  if (!read.ok) return <ErrorNote title="That page did not load" message={read.error} />;
  const { pages, next_page, last_page } = read.value;
  if (!pages.length) return <Empty>There is no page {page} in the loaded book{last_page ? `. It ends at page ${last_page}` : ""}.</Empty>;
  const nav = (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-2 text-sm">
      {back && <Link href={back} className="btn-ghost px-3 py-1">Back to results</Link>}
      {page > 1 && <Link href={bookHref.page(Math.max(1, page - 3))} className="btn-ghost px-3 py-1">← Earlier</Link>}
      {next_page && <Link href={bookHref.page(next_page)} className="btn-ghost px-3 py-1">Later →</Link>}
      {hasPdf && <a href={bookHref.pdf(page)} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1">Open the PDF at p. {page}</a>}
      <Link href="/library" className="text-neutral-400 hover:text-white">Contents</Link>
    </nav>
  );
  return (
    <section aria-label={`Pages ${pages[0].page} to ${pages.at(-1)!.page}`} className="space-y-4">
      {nav}
      <p className="text-sm text-neutral-400">The figures are in the PDF. Pages marked as figure descriptions say in words what a figure shows.</p>
      {pages.map((p) => (
        <article key={p.page} id={`p${p.page}`} className="card scroll-mt-24 space-y-3">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-semibold">{p.heading}</h2>
            <span className="text-sm text-neutral-400 tabular-nums">p. {p.page}{p.kind === "figure" ? " · figure description" : ""}</span>
          </header>
          <div className="max-w-3xl text-[15px] leading-relaxed whitespace-pre-wrap text-neutral-200">{p.text}</div>
        </article>
      ))}
      {nav}
    </section>
  );
}

function Contents({ outline }: { outline: Outline }) {
  const chapters = chaptersOf(outline);
  // Chapters the Lab draws on, so the book leads back to the renderer.
  const lab = new Map<string, { id: string; title: string }[]>();
  for (const v of VIEWS) {
    for (const b of v.book) {
      const ch = b.section.split(".")[0];
      const list = lab.get(ch) ?? [];
      if (!list.some((x) => x.id === v.id)) list.push({ id: v.id, title: v.title });
      lab.set(ch, list);
    }
  }
  return (
    <section aria-labelledby="contents-title" className="space-y-3">
      <h2 id="contents-title" className="text-xl font-semibold">Contents</h2>
      <p className="text-sm text-neutral-400">{outline.pages.toLocaleString("en-GB")} pages loaded. Page numbers are the PDF&apos;s own, the same ones the study plan uses.</p>
      <div className="divide-y divide-white/5">
        {chapters.map((c) => (
          <details key={c.number} className="py-2">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-semibold">{/^\d+$/.test(c.chapter) ? `Ch ${c.chapter}` : `Appendix ${c.chapter}`} {c.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                {(lab.get(c.chapter) ?? []).map((v) => (
                  <Link key={v.id} href={`/lab/${v.id}`} className="chip bg-aqua/10 text-aqua ring-aqua/30 hover:bg-aqua/20">Lab: {v.title}</Link>
                ))}
                <span className="tabular-nums">p. {c.first_page}</span>
              </span>
            </summary>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 pl-4 text-sm sm:grid-cols-2">
              {c.sections.map((s) => (
                <li key={s.number}>
                  <Link href={bookHref.page(s.first_page)} className="text-neutral-300 hover:text-white">
                    <span className="tabular-nums text-neutral-400">{s.number}</span> {s.title} <span className="text-xs text-neutral-500 tabular-nums">p. {s.first_page}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
