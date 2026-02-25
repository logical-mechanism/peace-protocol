#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

source ./check-prereqs.sh
check_prerequisites

echo "Installing dependencies and building backend..."
npm run install:all

echo "Building debug release..."
npx tauri build --debug
