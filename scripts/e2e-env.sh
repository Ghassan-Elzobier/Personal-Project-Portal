# Sourced, not run: the environment the end-to-end suite and `npm run debug` both
# use. Starts the local Supabase stack if it is down (migrations and seed.sql
# applied), blanks every portal setting so live values in .env.local never reach
# the app, and points it at the local stack with the pinned test clock.
# Expects to be sourced from the repository root.
# The local database, with migrations and supabase/seed.sql applied.
if ! npx supabase status >/dev/null 2>&1; then
  npm run db:start
fi

# Blank every portal setting first, so live values in .env.local never reach
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
# Report errors as production does, so e2e/errors.spec.ts can see them stored.
export ERROR_REPORTING=on
# Money's bank feed: the made-up Lunch Flow that Playwright starts (e2e/fake-lunchflow.mjs).
export LUNCHFLOW_BASE_URL="http://localhost:3199"
export LUNCHFLOW_API_KEY="e2e-made-up-key"
# The scheduled sync's two secrets, made up for the suite.
export CRON_SECRET="e2e-made-up-cron-secret"
export MONEY_SYNC_KEY="e2e-made-up-sync-key"
export NEXT_TELEMETRY_DISABLED=1

