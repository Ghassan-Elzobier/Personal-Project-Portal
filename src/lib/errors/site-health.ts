// Whether the live portal loads, as a signed-out visitor sees it from outside.
// The error tracker cannot report the breaks that silence it: a deploy missing its
// Supabase settings, a failing proxy or sign-in page, an error page from Vercel.
// So the triage loads two pages itself, keeps one issue while they fail, found by
// its marker, and closes it once they load again. Pure, so it is tested here; the
// fetches and gh calls are in scripts/error-triage.mjs.
//
// The repository is public: the issue carries check names, reasons and status
// codes only, never the address, a header or the page's text.

/** What one request got back. A null status means no answer (a timeout or a network error). */
export type Probe = { status: number | null; location: string | null; body: string | null };

export type SiteProbes = { root: Probe; login: Probe };

export type SiteCheck = "proxy" | "login";

export type SiteReason = "no-answer" | "status" | "no-redirect" | "not-configured" | "no-form";

export type SiteFailure = { check: SiteCheck; reason: SiteReason; status: number | null };

export type SiteHealth = { healthy: boolean; failed: SiteFailure[] };

export const SITE_MARKER = "<!-- site-health -->";
export const SITE_TITLE = "The portal is not loading";

const CHECKS: Record<SiteCheck, string> = {
  proxy: "Signed out, `/` sends you to `/login`",
  login: "`/login` shows the sign-in form",
};

const REASONS: Record<SiteReason, string> = {
  "no-answer": "no answer (refused, or none within 15 seconds)",
  status: "unexpected status",
  "no-redirect": "answered without sending to `/login`",
  "not-configured": "says Supabase is not configured",
  "no-form": "no Sign in heading or email field",
};

const status = (s: number | null) => (s !== null && Number.isInteger(s) && s >= 100 && s <= 599 ? s : null);

function redirectsToLogin(location: string | null): boolean {
  if (!location) return false;
  try {
    return new URL(location, "https://portal.example.test").pathname === "/login";
  } catch {
    return false;
  }
}

function judgeRoot(p: Probe): SiteFailure | null {
  const code = status(p.status);
  if (code === null) return { check: "proxy", reason: "no-answer", status: null };
  if (code >= 300 && code < 400) {
    return redirectsToLogin(p.location) ? null : { check: "proxy", reason: "no-redirect", status: code };
  }
  return { check: "proxy", reason: code < 300 ? "no-redirect" : "status", status: code };
}

function judgeLogin(p: Probe): SiteFailure | null {
  const code = status(p.status);
  if (code === null) return { check: "login", reason: "no-answer", status: null };
  if (code !== 200) return { check: "login", reason: "status", status: code };
  const body = p.body ?? "";
  if (/not configured/i.test(body)) return { check: "login", reason: "not-configured", status: code };
  const heading = /<h1[^>]*>\s*Sign in\s*<\/h1>/i.test(body);
  const email = /<input[^>]*type="email"/i.test(body);
  return heading && email ? null : { check: "login", reason: "no-form", status: code };
}

/** Turns the two probes into healthy, or the list of checks that failed. */
export function judgeSite(probes: SiteProbes): SiteHealth {
  const failed = [judgeRoot(probes.root), judgeLogin(probes.login)].filter((f): f is SiteFailure => f !== null);
  return { healthy: failed.length === 0, failed };
}

export type SiteAction = "file" | "update" | "close" | "none";

/** File the issue when the site fails, keep it current while it does, close it once it loads. */
export function decideSite(h: SiteHealth, issueOpen: boolean): SiteAction {
  if (!h.healthy) return issueOpen ? "update" : "file";
  return issueOpen ? "close" : "none";
}

export function siteIssueBody(h: SiteHealth, tries: number): string {
  return [
    SITE_MARKER,
    `**Filed automatically by the error triage.** The live portal failed the checks below on ${tries} tries ` +
      `in a row, loading it signed out from outside. A break like this can also stop the portal recording ` +
      `its own errors, so the errors page may show nothing. This closes itself once the site loads again.`,
    "",
    "| Check | What went wrong | Status |",
    "| --- | --- | --- |",
    ...h.failed.map((f) => `| ${CHECKS[f.check]} | ${REASONS[f.reason]} | ${f.status ?? "none"} |`),
    "",
    "No answer or a 5xx: look at the latest deployment and its logs in Vercel. Not configured: " +
      "`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing from Vercel's production " +
      "environment; set them and redeploy.",
  ].join("\n");
}

export const SITE_CLOSED_COMMENT = "The portal loads again.";
