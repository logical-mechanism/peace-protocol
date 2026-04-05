#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

source ./check-prereqs.sh
check_prerequisites

# If a previous run left processes on the dev port, kill them.
# Uses port-based cleanup instead of pkill to avoid killing unrelated WebKit apps.
lsof -ti:5173 2>/dev/null | xargs -r kill 2>/dev/null || true

# WebKitGTK workarounds for Linux (older GPUs, kernel 6.17+)
export WEBKIT_DISABLE_DMABUF_RENDERER=1
# export LIBGL_ALWAYS_SOFTWARE=1
# export WEBKIT_DISABLE_COMPOSITING_MODE=1

# If you're on Wayland, test forcing X11 (common trigger for this error class).
# if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
#   export GDK_BACKEND=x11
# fi

echo "Installing dependencies and building backend..."
npm run install:all

echo "Starting backend TypeScript watcher..."
npm --prefix be run watch &
TSC_PID=$!
trap "kill $TSC_PID 2>/dev/null; wait $TSC_PID 2>/dev/null" EXIT

echo "Waiting for initial backend compilation..."
for i in $(seq 1 60); do
  [ -f be/dist/index.js ] && break
  sleep 0.5
done
if [ ! -f be/dist/index.js ]; then
  echo "ERROR: Backend compilation timed out (30s). Check for TypeScript errors."
  exit 1
fi

echo "Starting development version..."
if [ $# -gt 0 ]; then
  npx tauri dev -- "$@"
else
  npx tauri dev
fi
