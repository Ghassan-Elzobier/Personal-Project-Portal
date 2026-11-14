#!/usr/bin/env bash
# One-time GitHub settings for the factory. Safe to run again: each step sets
# the same state. Needs `gh auth login` as the repository owner.
#
#   bash scripts/github-setup.sh          settings, labels and the main ruleset
#   bash scripts/github-setup.sh secrets  also prompts for the three secrets
#
# What it does, and why, is in docs/FACTORY.md ("One-time setup").
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo "Setting up $repo"

# Merging: keep merge commits (so .git-blame-ignore-revs stays valid), allow
# "merge when checks pass" from a phone, and tidy branches away after merging.
gh api -X PATCH "repos/$repo" --silent \
  -F allow_auto_merge=true -F delete_branch_on_merge=true -F allow_update_branch=true \
  -F allow_merge_commit=true -F allow_squash_merge=true -F allow_rebase_merge=false

# Security features that are free for public repositories.
gh api -X PUT "repos/$repo/vulnerability-alerts" --silent
gh api -X PUT "repos/$repo/automated-security-fixes" --silent
gh api -X PUT "repos/$repo/private-vulnerability-reporting" --silent
gh api -X PATCH "repos/$repo" --silent --input - <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "secret_scanning_non_provider_patterns": { "status": "enabled" } } }
JSON
gh api -X PATCH "repos/$repo/code-scanning/default-setup" --silent -f state=configured -f query_suite=default

# Labels the workflows and skills use.
label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null; }
label approved-test-change d93f0b "Owner approves changing an existing test or screenshot (the guard checks)"
label skip-review cfd3d7 "No automatic Claude review on this PR"
label feature 0e8a16 "Something new the portal should do"
label bug d73a4a "Works differently from how it should"
label error-report b60205 "Filed automatically from an error in production"
label no-autofix cfd3d7 "The error triage does not hand this issue to Claude"
label refactor 5319e7 "Same behaviour, better structure; the weekly refactor run picks these up"
label factory fbca04 "An improvement to the factory itself"
label deps 0366d6 "Dependency updates"
label ci 0366d6 "Workflow and action updates"

# main: changes arrive only through pull requests that pass CI and the guard.
# The owner may merge a PR whose checks fail (bypass "pull_request"), but nobody,
# including agents pushing with the owner's credentials, can push to main.
ruleset_json=$(cat <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false, "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "Checks" }, { "context": "Integration" }, { "context": "Guard" }] } }
  ]
}
JSON
)
existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id' || true)
if [ -n "$existing" ]; then
  echo "$ruleset_json" | gh api -X PUT "repos/$repo/rulesets/$existing" --silent --input -
else
  echo "$ruleset_json" | gh api -X POST "repos/$repo/rulesets" --silent --input -
fi

# The production environment holds the database secrets, for main only.
gh api -X PUT "repos/$repo/environments/production" --silent --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST "repos/$repo/environments/production/deployment-branch-policies" --silent \
  -f name=main -f type=branch 2>/dev/null || true

if [ "${1:-}" = "secrets" ]; then
  echo
  echo "Each prompt hides what you type. Nothing is printed or stored outside GitHub."
  ref_file=supabase/.temp/project-ref
  if [ -f "$ref_file" ]; then
    gh variable set SUPABASE_PROJECT_REF --body "$(cat "$ref_file")"
  else
    read -rp "Supabase project ref (the id in the dashboard URL): " ref && gh variable set SUPABASE_PROJECT_REF --body "$ref"
  fi
  echo "Supabase access token (supabase.com/dashboard/account/tokens):"
  gh secret set SUPABASE_ACCESS_TOKEN --env production
  echo "Supabase database password (Project settings, Database):"
  gh secret set SUPABASE_DB_PASSWORD --env production
  echo "Claude token: run 'claude setup-token' in another terminal and paste the result:"
  gh secret set CLAUDE_CODE_OAUTH_TOKEN
fi

echo "Done. Remaining steps in the browser: docs/FACTORY.md, One-time setup."
