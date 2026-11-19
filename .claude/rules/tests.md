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
- A test that taps and changes data is a save test: put it in a new
  `e2e/state-<feature>.spec.ts`. Those files run with `e2e/state-fresh.spec.ts`
  in the `state` project, after every other suite and one file at a time
  (`playwright.config.ts`). Each test creates its own data and puts everything
  back as it found it, because the other suites' screenshots show that data.
- Screenshots render in the Playwright Docker image (`scripts/e2e.sh`), never
  on the host. Update them only for an intended design change
  (`npm run test:e2e:update`), and look at every changed image before committing.
- Pages and server code read the time from `src/lib/dates/clock.ts`;
  `PORTAL_FIXED_NOW` pins it in the suite, and `page.clock` pins the browser.
- Unit tests are node:test beside the code (`*.test.ts`), pure and fast. Test
  data is made up; this repository is public.
