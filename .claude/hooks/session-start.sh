#!/usr/bin/env bash
# SessionStart: every session, local or cloud, runs the project's Node (.nvmrc)
# and has its dependencies. Prints one line of orientation, which Claude reads.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
want=$(cat .nvmrc)
# shellcheck source=.claude/hooks/node-env.sh
. .claude/hooks/node-env.sh

# A cloud VM has Node 22 by default: fetch the pinned major from nodejs.org once.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "$want" ]; then
  version=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r "[.[] | select(.version | startswith(\"v$want.\"))][0].version")
  if [ -n "$version" ] && curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" | tar -xJ -C /opt; then
    rm -rf "/opt/node$want" && mv "/opt/node-$version-linux-x64" "/opt/node$want"
    export PATH="/opt/node$want/bin:$PATH"
  fi
fi

# Every later command in this session uses the same Node.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$(dirname "$(command -v node)"):\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi

# Install when the lockfile changed since the last install (cloud, or a fresh worktree).
stamp=node_modules/.lock-hash
hash=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -d node_modules ] || [ "$(cat "$stamp" 2>/dev/null)" != "$hash" ]; then
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund >/tmp/npm-ci.log 2>&1 && echo "$hash" >"$stamp" || echo "npm ci failed: see /tmp/npm-ci.log"
  fi
fi

# A cloud session: start Docker if it is installed but stopped, then say which
# suites can run here (scripts/cloud-env.mjs). The daemon gets the session's own
# proxy, or it can't pull images through the allowlist. Local sessions skip this.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1 && command -v dockerd >/dev/null 2>&1; then
    proxy_args=()
    https_proxy_value="${HTTPS_PROXY:-${https_proxy:-}}"
    http_proxy_value="${HTTP_PROXY:-${http_proxy:-}}"
    no_proxy_value="${NO_PROXY:-${no_proxy:-}}"
    [ -n "$http_proxy_value" ] && proxy_args+=(--http-proxy "$http_proxy_value")
    [ -n "$https_proxy_value" ] && proxy_args+=(--https-proxy "$https_proxy_value")
    [ -n "$no_proxy_value" ] && proxy_args+=(--no-proxy "$no_proxy_value")
    nohup dockerd "${proxy_args[@]}" >/tmp/dockerd.log 2>&1 &
    for _ in $(seq 30); do
      docker info >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  node --experimental-strip-types --no-warnings scripts/cloud-env.mjs || true
fi

echo "Node $(node -v) on $(git branch --show-current 2>/dev/null). Follow AGENTS.md; ship changes with /ship."
exit 0
