#!/usr/bin/env bash
# Compile the Bun backend and stage it into the app's resources for bundling.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # native/
REPO_ROOT="$(cd "$HERE/.." && pwd)"

( cd "$REPO_ROOT/packages/backend" && bun build src/index.ts --compile --outfile dist/taskflow-backend )

# Stage the dev sidecar under a distinct name (taskflow-backend-dev) so that a
# cleanup `pkill -f taskflow-backend-dev` cannot match the installed production
# backend (`taskflow-backend`). The build artifact name is incidental; only the
# staged/running name matters for kill-safety.
DEST="$HERE/Sources/Taskflow/Resources/backend"
mkdir -p "$DEST"
cp "$REPO_ROOT/packages/backend/dist/taskflow-backend" "$DEST/taskflow-backend-dev"
chmod +x "$DEST/taskflow-backend-dev"

# Stage ripgrep if available (used by search; optional for boot).
RG="$(find "$REPO_ROOT" -path '*/@vscode/ripgrep/bin/rg' -type f 2>/dev/null | head -1 || true)"
[ -n "$RG" ] && cp "$RG" "$DEST/rg" && chmod +x "$DEST/rg" || true

echo "Staged backend sidecar into $DEST"
