// Shared settings for the end-to-end suite. scripts/e2e.sh exports the
// Supabase values from `supabase status` before Playwright starts.

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

/** The made-up owner from supabase/seed.sql. */
export const OWNER_EMAIL = "owner@example.test";

/** Where the signed-in browser state is kept between the setup and the tests. */
export const OWNER_STATE = "e2e/.auth/owner.json";

/** The instant every server render and browser clock is pinned to (a Monday morning). */
export const FIXED_NOW = process.env.PORTAL_FIXED_NOW ?? "2026-11-16T09:30:00Z";

/** Every page the owner can open, with the heading it must show. */
export const OWNER_PAGES: { path: string; heading: RegExp }[] = [
  { path: "/", heading: /./ },
  { path: "/schedule", heading: /Schedule/i },
  { path: "/study", heading: /Study/i },
  { path: "/lab", heading: /renderer/i },
  { path: "/library", heading: /Book|Library/i },
  { path: "/jobs", heading: /Jobs/i },
  { path: "/tasks", heading: /Tasks/i },
  { path: "/timeline", heading: /Timeline/i },
  { path: "/log", heading: /Log/i },
  { path: "/week", heading: /update|week/i },
  { path: "/roadmap", heading: /Roadmap/i },
  { path: "/job-hunt", heading: /Job hunt/i },
  { path: "/progress", heading: /Progress/i },
  { path: "/people", heading: /People/i },
  { path: "/claude", heading: /Claude/i },
  { path: "/design", heading: /Design/i },
  { path: "/life", heading: /./ },
  { path: "/life/gym", heading: /Gym/i },
  { path: "/life/kitchen", heading: /Kitchen/i },
  { path: "/life/body", heading: /Body/i },
  { path: "/life/recipes", heading: /Recipes/i },
  { path: "/life/settings", heading: /Settings|Life/i },
];
