// The portal's clock: the one place server code asks what time it is for the
// owner (today, this week, how late in the day). Durations, deadlines and
// token lifetimes keep using Date.now(), since they measure time passing.
//
// PORTAL_FIXED_NOW pins the clock for the end-to-end and screenshot suites, so
// a page renders the same day on every run. It is ignored on Vercel, so a
// stray value can never freeze the live site.

/** The current instant, or the pinned one in a test run. */
export function now(): Date {
  const fixed = process.env.PORTAL_FIXED_NOW;
  if (fixed && !process.env.VERCEL) {
    const pinned = new Date(fixed);
    if (!Number.isNaN(pinned.getTime())) return pinned;
  }
  return new Date();
}
