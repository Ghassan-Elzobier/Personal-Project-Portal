// Loads your PMPP PDF into the portal's private book library, page by page, so the
// Book page and the Claude connector can search it. The text goes from your PDF to
// your database and nowhere else: the SQL is written to a temporary folder, loaded,
// and deleted. None of it belongs in this repo.
//
//   npm run load:book -- "/path/to/Programming Massively Parallel Processors ... .pdf"
//
// Run it after `supabase db push --linked`. Add --local to load a local database,
// or --sql-only <dir> to write the SQL and stop. Safe to run again: it replaces
// the book's pages each time. Needs pdftotext (sudo apt install poppler-utils).

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PMPP } from "../src/lib/study/pmpp.ts";

const BOOK = "pmpp-5e";
const BATCH_BYTES = 300_000;

const args = process.argv.slice(2);
const pdf = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--sql-only");
const target = args.includes("--local") ? "--local" : "--linked";
const sqlOnly = args.includes("--sql-only") ? args[args.indexOf("--sql-only") + 1] : null;

if (!pdf) {
  console.error('Give the path to your PDF: npm run load:book -- "/path/to/book.pdf"');
  process.exit(1);
}

// Chapters, their titles and first pages come from the study plan, which read them
// from the same PDF, so the two always agree.
const CHAPTERS = PMPP.sections
  .flatMap((s) => s.units)
  .flatMap((u) => {
    const m = /^pmpp-(\d+|app-[a-c])$/.exec(u.ref);
    if (!m || !u.page) return [];
    const id = m[1].startsWith("app-") ? m[1].slice(4).toUpperCase() : m[1];
    const title = u.name.replace(/^(Ch \d+|Appendix [A-C]) /, "");
    return [{ id, title, page: u.page, label: /^\d+$/.test(id) ? `Ch ${id}` : `Appendix ${id}` }];
  })
  .sort((a, b) => a.page - b.page);

const HEADING = /^((\d{1,2}|[A-C])\.(\d{1,2}))\.?\s+(\S.*)$/;
const NOISE = /^(Navigate back to Figure|Follow for extended description)/;

/** 6.10 -> 10, so sections only move forward. */
const minor = (number) => (number ? Number(number.split(".")[1]) : 0);
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** A wrapped heading keeps the start of its title. */
const sameStart = (text, title) => {
  const a = squash(text).slice(0, 16);
  const b = squash(title).slice(0, 16);
  return a.length >= 4 && (b.startsWith(a) || a.startsWith(b));
};

function readPdf(path) {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
  } catch {
    console.error("pdftotext is missing. Install it with: sudo apt install poppler-utils");
    process.exit(1);
  }
  return promisify(execFile)("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], { maxBuffer: 256 * 1024 * 1024 }).then((r) => r.stdout);
}

function clean(lines) {
  const kept = lines
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trimEnd())
    .filter((l) => !NOISE.test(l.trim()));
  // Drop the indent every line shares, then squeeze runs of blank lines.
  const indent = Math.min(...kept.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length), 80);
  return kept
    .map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);
}

function parse(text) {
  const raw = text.split("\f");
  if (raw.length && !raw.at(-1).trim()) raw.pop();
  const lastChapter = CHAPTERS.at(-1).page;
  const outline = new Map(); // "6.1" -> full title, from each chapter's outline page
  const pages = [];
  let chapter = null;
  let section = null;
  let figures = false;
  let figure = null;
  let indexFrom = Infinity;

  for (let i = 0; i < raw.length; i++) {
    const page = i + 1;
    const lines = raw[i].split("\n");
    const top = lines.map((l) => l.trim()).filter(Boolean);
    if (page > lastChapter && top[0] === "Index") indexFrom = Math.min(indexFrom, page);
    if (page >= indexFrom) break;

    const now = CHAPTERS.filter((c) => c.page <= page).at(-1) ?? null;
    if (now !== chapter) {
      chapter = now;
      section = null;
      figures = false;
      figure = null;
    }
    if (!top.length) continue;

    // Headings anywhere on the page, with where they sit. A chapter's outline page
    // lists its sections; when the first section starts on that same page, its
    // number appears twice, and the second one is the real heading.
    const found = top.flatMap((l, at) => {
      const h = HEADING.exec(l);
      return h ? [{ number: h[1], chapter: h[2], text: h[4].trim(), at }] : [];
    });
    const isOutline = top[0] === "Chapter Outline" || new Set(found.map((h) => h.number)).size >= 3;
    const seen = new Set();
    const starts = [];
    for (const h of found) {
      if (isOutline && !seen.has(h.number)) {
        seen.add(h.number);
        if (!outline.has(h.number)) outline.set(h.number, h.text);
        continue;
      }
      starts.push(h);
    }

    const fig = /^Description of Figure\s+([0-9A-C]+\.[0-9]+)/.exec(top[0]);
    if (fig) {
      figures = true;
      figure = fig[1];
    } else if (top[0].startsWith("Description of Figure")) {
      figures = true;
    }

    // A page belongs to the section that covers most of it: a heading in its top
    // third takes the page, one further down takes the pages after it.
    let pageSection = section;
    if (chapter && !figures) {
      const listed = [...outline.keys()].some((k) => k.startsWith(`${chapter.id}.`));
      for (const h of starts) {
        if (h.chapter !== chapter.id || minor(h.number) <= minor(section?.number)) continue;
        // Prose that wraps onto a line starting "6.1 ..." is not a heading: a real
        // one matches its outline entry, or is a short line when there is no outline.
        const title = outline.get(h.number);
        if (title ? !sameStart(h.text, title) : listed || top[h.at].length > 70) continue;
        section = { number: h.number, title: title ?? h.text };
        if (h.at < top.length / 3) pageSection = section;
      }
    }

    const kind = !chapter ? "front" : figures ? "figure" : "body";
    const where = chapter ? `${chapter.label} ${chapter.title}` : "Front matter";
    const heading =
      kind === "figure" ? `${where} › Figure descriptions${figure ? ` (Figure ${figure})` : ""}` : pageSection ? `${where} › ${pageSection.number} ${pageSection.title}` : where;
    const body = clean(lines);
    if (!body) continue;
    pages.push({ page, kind, chapter: chapter?.id ?? null, section: kind === "body" ? (pageSection?.number ?? null) : null, sectionTitle: pageSection?.title ?? "", heading, figure: kind === "figure" ? figure : null, body });
  }

  // Sections and chapters, with the pages each spans (body pages only).
  const sections = new Map();
  for (const c of CHAPTERS) sections.set(c.id, { number: c.id, chapter: c.id, title: c.title, first: c.page, last: c.page });
  for (const p of pages) {
    if (p.kind !== "body" || !p.chapter) continue;
    const ch = sections.get(p.chapter);
    ch.last = Math.max(ch.last, p.page);
    if (!p.section) continue;
    const s = sections.get(p.section) ?? { number: p.section, chapter: p.chapter, title: outline.get(p.section) ?? p.sectionTitle, first: p.page, last: p.page };
    s.first = Math.min(s.first, p.page);
    s.last = Math.max(s.last, p.page);
    sections.set(p.section, s);
  }
  for (const [number, title] of outline) {
    const s = sections.get(number);
    if (s && !s.title) s.title = title;
  }
  return { pages, sections: [...sections.values()], indexFrom };
}

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

function toSql({ pages, sections }) {
  const files = [];
  let rows = [];
  let size = 0;
  const flush = (first) => {
    if (!rows.length) return;
    const head = first ? `delete from portal.book_pages where book = ${q(BOOK)};\n` : "";
    files.push(
      `${head}insert into portal.book_pages (book, page, kind, chapter, section, heading, figure, body) values\n${rows.join(",\n")}\n` +
        "on conflict (book, page) do update set kind = excluded.kind, chapter = excluded.chapter, section = excluded.section, heading = excluded.heading, figure = excluded.figure, body = excluded.body;\n",
    );
    rows = [];
    size = 0;
  };
  for (const p of pages) {
    const row = `(${q(BOOK)}, ${p.page}, ${q(p.kind)}, ${q(p.chapter)}, ${q(p.section)}, ${q(p.heading)}, ${q(p.figure)}, ${q(p.body)})`;
    rows.push(row);
    size += row.length;
    if (size > BATCH_BYTES) flush(files.length === 0);
  }
  flush(files.length === 0);
  files.push(
    `delete from portal.book_sections where book = ${q(BOOK)};\n` +
      `insert into portal.book_sections (book, number, chapter, title, first_page, last_page) values\n` +
      sections.map((s) => `(${q(BOOK)}, ${q(s.number)}, ${q(s.chapter)}, ${q(s.title)}, ${s.first}, ${s.last})`).join(",\n") +
      ";\n",
  );
  return files;
}

const text = await readPdf(resolve(pdf));
const parsed = parse(text);
const files = toSql(parsed);
const count = (k) => parsed.pages.filter((p) => p.kind === k).length;
const bare = CHAPTERS.filter((c) => !parsed.sections.some((s) => s.chapter === c.id && s.number !== c.id));
console.log(`Read ${parsed.pages.length} pages: ${count("body")} of text, ${count("figure")} describing figures, ${count("front")} of front matter. The index from page ${parsed.indexFrom} is left out.`);
console.log(`Found ${parsed.sections.length - CHAPTERS.length} sections in ${CHAPTERS.length} chapters.${bare.length ? ` No sections found in: ${bare.map((c) => c.label).join(", ")}.` : ""}`);

const dir = sqlOnly ? resolve(sqlOnly) : mkdtempSync(join(tmpdir(), "portal-book-"));
mkdirSync(dir, { recursive: true });
files.forEach((sql, i) => writeFileSync(join(dir, `${String(i).padStart(2, "0")}.sql`), sql));
if (sqlOnly) {
  writeFileSync(join(dir, "outline.json"), JSON.stringify(parsed.sections, null, 1));
  console.log(`Wrote ${files.length} SQL files and outline.json to ${dir}. Nothing was loaded.`);
  process.exit(0);
}

try {
  for (let i = 0; i < files.length; i++) {
    process.stdout.write(`Loading part ${i + 1} of ${files.length}\r`);
    execFileSync("supabase", ["db", "query", target, "-f", join(dir, `${String(i).padStart(2, "0")}.sql`)], { stdio: ["ignore", "ignore", "inherit"] });
  }
  console.log(`\nDone. Search it at /library, or ask Claude through the connector.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
