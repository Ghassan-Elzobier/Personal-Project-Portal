#!/usr/bin/env bash
# Starts an MCP server from .mcp.json with the Node version in .nvmrc.
#
# Claude Code launches MCP servers with whatever `node` its host has on PATH
# (often the system's old Node 18), not the Node the session hooks put on the Bash
# tool's PATH. Playwright, Chrome DevTools and Next.js DevTools MCP all need
# Node 20 or newer and close the connection at once without it. This reuses the
# hooks' own lookup (fnm, nvm, /opt) so every server runs on the project's Node.
#
#   scripts/mcp.sh npx -y next-devtools-mcp@0.4.0
set -euo pipefail
cd "$(dirname "$0")/.."
export CLAUDE_PROJECT_DIR="$PWD"
# shellcheck source=.claude/hooks/node-env.sh
. .claude/hooks/node-env.sh
exec "$@"
