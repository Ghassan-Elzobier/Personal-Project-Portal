import "server-only";
import { connectorCaller } from "../connector/context";
import { anonClient } from "../connector/oauth";
import { createClient } from "../supabase/server";
import { planSearch, type SearchPlan } from "./query";

// The owner's book library: PMPP's pages in the private `portal` schema, loaded
// from their own PDF by scripts/load-book.mjs, and the PDF in a private bucket.
// The library_* RPCs let only the owner in, from a session or a connector token.

export const BOOK = {
  id: "pmpp-5e",
  short: "PMPP",
  title: "Programming Massively Parallel Processors",
  edition: "5th edition",
  authors: "Hwu, Kirk and El Hajj",
  bucket: "library",
  pdf: "pmpp-5e.pdf",
} as const;

export class BookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const ERROR_STATUS: Record<string, number> = { "42501": 403, P0002: 404, "22023": 400 };

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const connector = connectorCaller();
  const client = connector ? anonClient() : await createClient();
  const { data, error } = await client.rpc(name, connector ? { ...args, p_access_hash: connector.accessHash } : args);
  if (error) {
    const status = ERROR_STATUS[error.code];
    if (!status) console.error(name, error.message);
    throw new BookError(status ? error.message : "The library did not answer. Try again in a minute.", status ?? 500);
  }
  return data as T;
}

export type Hit = {
  page: number;
  kind: "front" | "body" | "figure";
  chapter: string | null;
  section: string | null;
  heading: string;
  figure: string | null;
  matched_every_term: boolean;
  /** Matches marked with \u0001 and \u0002. Plain text: never render as HTML. */
  excerpt: string;
};

export type SearchResult = SearchPlan & { query: string; results: Hit[]; matchedEvery: number };

export async function searchBook(query: string, opts: { chapter?: string | null; limit?: number } = {}): Promise<SearchResult> {
  const plan = planSearch(query);
  if (!plan.groups.length) return { ...plan, query, results: [], matchedEvery: 0 };
  const data = await rpc<{ results: Hit[]; matched_every_term: number }>("library_search", {
    p_book: BOOK.id,
    p_groups: plan.groups,
    p_chapter: opts.chapter || null,
    p_limit: opts.limit ?? 8,
  });
  return { ...plan, query, results: data.results, matchedEvery: data.matched_every_term };
}

export type PageText = { page: number; kind: Hit["kind"]; heading: string; text: string };
export type Reading = {
  pages: PageText[];
  section: { number: string; title: string; first_page: number; last_page: number } | null;
  next_page: number | null;
  last_page: number | null;
};

export function readBook(at: { page?: number; section?: string; count?: number }): Promise<Reading> {
  return rpc<Reading>("library_read", { p_book: BOOK.id, p_page: at.page ?? null, p_section: at.section ?? null, p_count: at.count ?? 3 });
}

export type Section = { number: string; chapter: string; title: string; first_page: number; last_page: number };
export type Outline = { pages: number; sections: Section[] };

export function bookOutline(): Promise<Outline> {
  return rpc<Outline>("library_outline", { p_book: BOOK.id });
}

/** Chapters with their sections, in the book's page order. */
export function chaptersOf(outline: Outline) {
  const chapters = outline.sections.filter((s) => !s.number.includes("."));
  return chapters.map((c) => ({ ...c, sections: outline.sections.filter((s) => s.chapter === c.chapter && s.number.includes(".")) }));
}

/** "PMPP 6.1 Global memory access coalescing, p. 351", from a heading the loader wrote. */
export function cite(p: { page: number; heading: string }): string {
  const tail = p.heading.split(" › ").at(-1) ?? p.heading;
  return `${BOOK.short} ${tail.replace(/^Ch \d+ /, "Ch ")}, p. ${p.page}`;
}

/** Whether the PDF is in the bucket. Only the owner's session can see it. */
export async function pdfUploaded(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BOOK.bucket).list("", { search: BOOK.pdf, limit: 1 });
  if (error) {
    console.error("library list failed", error.message);
    return false;
  }
  return (data ?? []).some((f) => f.name === BOOK.pdf);
}

/** A link that opens the PDF at a page, valid for an hour. */
export async function pdfSignedUrl(page?: number): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BOOK.bucket).createSignedUrl(BOOK.pdf, 3600);
  if (error || !data?.signedUrl) return null;
  return page ? `${data.signedUrl}#page=${page}` : data.signedUrl;
}

/** Where the browser may upload the PDF, straight to storage, for the next two hours. */
export async function pdfUploadTarget(): Promise<{ path: string; token: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BOOK.bucket).createSignedUploadUrl(BOOK.pdf, { upsert: true });
  if (error || !data) {
    console.error("library upload url failed", error?.message);
    return null;
  }
  return { path: data.path, token: data.token };
}

export { bookHref } from "./links";
