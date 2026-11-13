#!/usr/bin/env bash
# Runs the end-to-end suite (e2e/) against a production build and the local
# Supabase stack. The same script runs on a laptop, in a Claude cloud session
# and in CI, so all three see the same thing.
#
#   npm run test:e2e                       everything
#   npm run test:e2e -- e2e/pages.spec.ts  one file (any Playwright arguments)
#   npm run test:e2e:update                re-render screenshot baselines on purpose
#
# Playwright runs inside the official Playwright image, so screenshots render
# with the same fonts and browser everywhere. Without Docker it runs on the host
# and skips the screenshot suite, since host rendering differs.
# E2E_SKIP_BUILD=1 reuses the last build.
set -euo pipefail
cd "$(dirname "$0")/.."

PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v$(node -p 'require("@playwright/test/package.json").version')-noble"

# 1. The local database, with migrations and supabase/seed.sql applied.
if ! npx supabase status >/dev/null 2>&1; then
  npm run db:start
fi

# 2. Blank every portal setting first, so live values in .env.local never reach
#    the test server (Next.js never overrides a variable that is already set).
while IFS= read -r name; do
  export "$name="
done < <(sed -nE 's/^([A-Z_][A-Z0-9_]*)=.*/\1/p' .env.example)

eval "$(npx supabase status -o env | sed -nE 's/^([A-Z_]+)=(.*)$/export SB_\1=\2/p')"
export NEXT_PUBLIC_SUPABASE_URL="$SB_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
export NEXT_PUBLIC_SITE_URL="http://localhost:3100"
export PORTAL_TIMEZONE="Europe/London"
export PORTAL_FIXED_NOW="${PORTAL_FIXED_NOW:-2026-11-16T09:30:00Z}"
export NEXT_TELEMETRY_DISABLED=1

# 3. A production build pointed at the local stack.
if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then
  npx next build
fi

mkdir -p e2e/.auth

# 4. The suite.
if command -v docker >/dev/null 2>&1 && [ "${E2E_NO_DOCKER:-}" != "1" ]; then
  env_args=()
  for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL \
    PORTAL_TIMEZONE PORTAL_FIXED_NOW NEXT_TELEMETRY_DISABLED CI; do
    env_args+=(-e "$name")
  done
  while IFS= read -r name; do env_args+=(-e "$name"); done < <(sed -nE 's/^([A-Z_][A-Z0-9_]*)=.*/\1/p' .env.example)
  exec docker run --rm --network host --ipc host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp "${env_args[@]}" \
    -v "$PWD":/work -w /work "$PLAYWRIGHT_IMAGE" \
    npx playwright test "$@"
else
  echo "Docker not found: running on the host and skipping screenshots." >&2
  exec npx playwright test --grep-invert "looks as approved" "$@"
fi
