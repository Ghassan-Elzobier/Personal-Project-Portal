// Fetches one job advert from a link the owner pasted, for "Fill in from the advert".
//
// The link is the owner's, but where it leads is not: a redirect or a DNS answer could
// point inside a network. So every hop must be a public web address on the standard
// ports, redirects are followed by hand and each one checked, and the page is read
// to a size limit. (A name could still answer differently between the check and the
// fetch; only the signed-in owner can start one, so that is accepted.) Sites whose
// terms bar automated reading are never fetched: the owner pastes the advert instead.
// The fetcher and the DNS lookup are passed in, so this is tested without a network.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { advertText } from "./extract.ts";

/** Why a page could not be read, worded for the owner: these are shown as they are. */
export class PageError extends Error {}

export type Lookup = (host: string) => Promise<string[]>;
type Fetcher = typeof fetch;

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
/** Less text than this is a page that builds itself in the browser, or a sign-in wall. */
const MIN_TEXT = 200;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; personal-job-tracker)",
  Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
  "Accept-Language": "en-GB,en;q=0.8",
};

/** The sites feeds.ts leaves out because their terms bar automated reading. */
const BARRED = /(?:^|\.)(?:linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|apple\.com)$/i;
const PRIVATE_NAME = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/i;

const defaultLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Whether an address is on the public internet: not loopback, private, link-local or reserved. */
export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]);
    if (v === "::" || v === "::1" || v.startsWith("::ffff:") || v.startsWith("64:ff9b:")) return false;
    return !/^(?:f[c-d]|fe[89ab]|ff)/.test(v);
  }
  return false;
}

/** A pasted link, if it is one the portal may fetch. */
export function checkLink(link: string): URL {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new PageError("That isn't a full link. Paste one that starts with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new PageError("Only web links can be read. Paste one that starts with https://.");
  if (url.username || url.password)
    throw new PageError(
      "That link carries a sign-in, so it isn't read. Copy the advert's text and paste it here instead.",
    );
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  // new URL has already turned numeric hosts like 2130706433 into dotted addresses.
  if (url.port || isIP(host) || !host.includes(".") || PRIVATE_NAME.test(host))
    throw new PageError("That link isn't a public website.");
  if (BARRED.test(host))
    throw new PageError(
      "That site's terms don't allow reading it automatically. Copy the advert's text and paste it here instead.",
    );
  return url;
}

async function checkAddresses(host: string, lookup: Lookup) {
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new PageError("Couldn't find that site. Check the link.");
  }
  if (!addresses.length) throw new PageError("Couldn't find that site. Check the link.");
  if (!addresses.every(isPublicAddress)) throw new PageError("That link isn't a public website.");
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    // The job details sit near the top; past the limit, what came is enough.
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
}

/** The page at a pasted link, following at most a few redirects, each one checked. */
export async function fetchJobPage(
  link: string,
  fetcher: Fetcher = fetch,
  lookup: Lookup = defaultLookup,
): Promise<{ url: string; html: string }> {
  let url = checkLink(link);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkAddresses(url.hostname.replace(/^\[|\]$/g, ""), lookup);
    let res: Response;
    try {
      res = await fetcher(url.href, {
        headers: HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw new PageError(
        e instanceof Error && e.name === "TimeoutError"
          ? "The page took too long to answer. Copy the advert's text and paste it here instead."
          : "Couldn't reach that page. Copy the advert's text and paste it here instead.",
      );
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next)
        throw new PageError("The page moved without saying where. Copy the advert's text and paste it here instead.");
      url = checkLink(new URL(next, url).href);
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new PageError("That page has gone. The role may have closed.");
    if (res.status === 401 || res.status === 403 || res.status === 429)
      throw new PageError(
        "That site wouldn't let the portal read the page. Copy the advert's text and paste it here instead.",
      );
    if (!res.ok)
      throw new PageError(`The page answered ${res.status}. Copy the advert's text and paste it here instead.`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(type))
      throw new PageError(
        "That link isn't a web page (it may be a PDF). Copy the advert's text and paste it here instead.",
      );
    return { url: url.href, html: await readCapped(res) };
  }
  throw new PageError("The page kept redirecting. Copy the advert's text and paste it here instead.");
}

/**
 * A page's readable text, for when it publishes no job data: its <main> if it has
 * one, without menus, headers, footers and forms. Throws when too little is left to
 * be an advert, which is what a page that builds itself in the browser looks like.
 */
export function pageText(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\b[^>]*>/i.exec(html)?.[1];
  const text = advertText(
    (main ?? html).replace(/<(nav|header|footer|aside|form|dialog|button|select)\b[\s\S]*?<\/\1\b[^>]*>/gi, " "),
  );
  if (text.length < MIN_TEXT)
    throw new PageError(
      "That page builds itself in the browser, so the portal can't read it. Copy the advert's text and paste it here instead.",
    );
  return text;
}
