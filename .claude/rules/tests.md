---
paths:
  - "e2e/**"
  - "**/*.test.ts"
  - "supabase/tests/**"
  - "playwright.config.ts"
---

# Test rules

- Existing tests and screenshots are the owner's acceptance checks. Add new ones
  freely; never weaken, skip, delete or re-record an existing one to get green.
  If one is truly wrong, explain why in the pull request; the guard then needs
  the owner's `approved-test-change` label.
- Screenshots render in the Playwright Docker image (`scripts/e2e.sh`), never
  on the host. Update them only for an intended design change
  (`npm run test:e2e:update`), and look at every changed image before committing.
- Pages and server code read the time from `src/lib/dates/clock.ts`;
  `PORTAL_FIXED_NOW` pins it in the suite, and `page.clock` pins the browser.
- Unit tests are node:test beside the code (`*.test.ts`), pure and fast. Test
  data is made up; this repository is public.
