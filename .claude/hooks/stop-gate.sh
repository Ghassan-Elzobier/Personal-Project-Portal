#!/usr/bin/env bash
# Stop: Claude cannot call a task done while its changes fail the fast checks.
# Runs only when code changed since the last passing run, so questions and
# reading cost nothing. Blocks once with the errors; if the next attempt still
# fails, it lets the turn end and says so, rather than looping on the usage.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
# shellcheck source=.claude/hooks/node-env.sh
. .claude/hooks/node-env.sh

base=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)
mapfile -t changed < <({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u |
  grep -E '\.(ts|tsx|mjs|js|css|json|ya?ml)$' | while read -r f; do [ -f "$f" ] && echo "$f"; done)
[ ${#changed[@]} -eq 0 ] && exit 0

state=$( { git rev-parse HEAD; git diff HEAD; git ls-files --others --exclude-standard | xargs -r cat 2>/dev/null; } | sha256sum | cut -d' ' -f1)
ok_file="$(git rev-parse --git-dir)/claude-gate-ok"
[ "$(cat "$ok_file" 2>/dev/null)" = "$state" ] && exit 0

problems=""
run() {
  local name=$1
  shift
  local out
  if ! out=$("$@" 2>&1); then problems+=$'\n'"## $name"$'\n'"$(echo "$out" | tail -40)"$'\n'; fi
}
run "Format (fix with npm run format)" node_modules/.bin/prettier --check --log-level warn "${changed[@]}"
lintable=()
for f in "${changed[@]}"; do [[ $f =~ \.(ts|tsx|mjs)$ ]] && lintable+=("$f"); done
[ ${#lintable[@]} -gt 0 ] && run "Lint" node_modules/.bin/eslint --cache --cache-location node_modules/.cache/eslint/ --pass-on-unpruned-suppressions "${lintable[@]}"
run "Types" node_modules/.bin/tsc --noEmit
run "Unit tests" npm test --silent

if [ -z "$problems" ]; then
  echo "$state" >"$ok_file"
  exit 0
fi
if [ "$(echo "$input" | jq -r '.stop_hook_active')" = "true" ]; then
  jq -n --arg m "Checks still fail after one more try; ending the turn. Say so plainly to the user." '{systemMessage: $m}'
  exit 0
fi
jq -n --arg r "The fast checks fail on your changes. Fix them before finishing (or explain to the user why not):$problems" \
  '{decision: "block", reason: $r}'
exit 0
