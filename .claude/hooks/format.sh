#!/usr/bin/env bash
# PostToolUse on Edit and Write: formats the file Claude just changed, so style
# never costs a review comment or a model turn.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  *.ts | *.tsx | *.mjs | *.js | *.json | *.css | *.yml | *.yaml) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
# shellcheck source=.claude/hooks/node-env.sh
. .claude/hooks/node-env.sh
node_modules/.bin/prettier --write --log-level silent --ignore-unknown "$file" 2>/dev/null
exit 0
