#!/usr/bin/env bash
# The portal running for debugging, on the seeded local database, the same
# environment the end-to-end suite uses. For a person, or an agent using the
# Playwright test MCP, Chrome DevTools MCP or Next.js DevTools MCP (/debug skill).
#
#   npm run debug         start the app on http://localhost:3100 (the dev server:
#                         source maps, hot reload, and Next's own MCP endpoint)
#   npm run debug:link    print a one-time sign-in link for the seeded owner, to
#                         paste into a browser the DevTools MCP controls
#
# Local only: the database is the scratch stack, never production.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/e2e-env.sh

case "${1:-up}" in
  link)
    node --experimental-strip-types --no-warnings scripts/debug-link.mjs
    ;;
  up)
    echo "Debugging build of the portal on ${NEXT_PUBLIC_SITE_URL} (seeded local database)."
    echo "In another terminal: npm run debug:link  (a signed-in link for the browser you debug with)"
    echo "Playwright's test runner reuses this server, so the agents' tests run against it."
    exec npx next dev -p 3100
    ;;
  *)
    echo "Usage: npm run debug | npm run debug:link" >&2
    exit 2
    ;;
esac
