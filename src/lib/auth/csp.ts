// The Content-Security-Policy every page is served with: a second lock, behind
// React's escaping. The portal shows text from outside (job adverts, merchant
// names from the bank feed, production error messages). If a slip ever let a
// script into a page, this is what stops the browser running it as the owner.
//
// Scripts are held to a nonce made fresh for each request (src/proxy.ts), with
// 'strict-dynamic', so only the portal's own scripts and what they load can run:
// the policy OWASP's cheat sheet and ASVS 5.0 (3.4.3, 3.4.6) recommend, set up
// the way Next.js documents. Pure, so it is tested.
//
// Still open, on purpose:
// - Styles allow 'unsafe-inline': the pages use style={} for sizes and positions
//   that are only known at run time. A style can't run code.
// - No form-action: Claude's consent page sends the browser on to Claude's own
//   address after a form post (src/app/oauth/authorize/actions.ts).
// - No report-uri: violations are not yet sent to the error tracker.

/** A value no one can guess, new for every request. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * The policy for one response. `dev` adds 'unsafe-eval', which React needs under
 * `next dev` to rebuild server error stacks in the browser, and never otherwise.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
