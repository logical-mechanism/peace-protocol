#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# If a previous run left WebKit helper processes behind, kill them.
# (Workaround for WebKitNetworkProcess sticking around / getting wedged)
pkill -u "$USER" -f 'WebKitNetworkProcess' 2>/dev/null || true
pkill -u "$USER" -f 'WebKitWebProcess'     2>/dev/null || true

# WebKitGTK workarounds for Linux (older GPUs, kernel 6.17+)
export WEBKIT_DISABLE_DMABUF_RENDERER=1
# export LIBGL_ALWAYS_SOFTWARE=1
# export WEBKIT_DISABLE_COMPOSITING_MODE=1

# If you're on Wayland, test forcing X11 (common trigger for this error class).
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  export GDK_BACKEND=x11
fi

echo "Installing dependencies and building backend..."
npm run install:all

echo "Building development version..."
npx tauri dev
