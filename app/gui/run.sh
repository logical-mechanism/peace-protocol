#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# WebKitGTK workarounds for Linux (older GPUs, kernel 6.17+)
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export LIBGL_ALWAYS_SOFTWARE=1

echo "Installing dependencies and building backend..."
npm run install:all

echo "Building development version..."
npx tauri dev
