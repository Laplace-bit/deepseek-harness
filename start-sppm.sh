#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { printf '%s\n' 'Node.js is required.' >&2; exit 1; }
command -v pnpm >/dev/null || { printf '%s\n' 'pnpm is required; install the version in package.json.' >&2; exit 1; }
test -d node_modules/tsx || { printf '%s\n' 'Dependencies are missing. Run pnpm install first.' >&2; exit 1; }
exec node --import tsx/esm scripts/start-sppm.mjs
