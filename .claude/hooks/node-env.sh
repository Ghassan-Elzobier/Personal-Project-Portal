#!/usr/bin/env bash
# Sourced by the other hooks: puts the Node version in .nvmrc first on PATH.
# Looks in fnm, nvm and /opt (where session-start.sh installs it in the cloud).
want=$(cat "${CLAUDE_PROJECT_DIR:-.}/.nvmrc" 2>/dev/null || echo 24)
current=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
if [ "$current" != "$want" ]; then
  for dir in "$HOME"/.local/share/fnm/node-versions/v"$want".*/installation/bin \
    "$HOME"/.nvm/versions/node/v"$want".*/bin /opt/node"$want"/bin; do
    [ -x "$dir/node" ] && NODE_BIN="$dir"
  done
  [ -n "${NODE_BIN:-}" ] && export PATH="$NODE_BIN:$PATH"
fi
