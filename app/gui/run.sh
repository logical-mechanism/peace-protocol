#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Installing dependencies and building backend..."
npm run install:all

echo "Building development version..."
npx tauri dev
