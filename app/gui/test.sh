#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Running frontend tests (vitest)..."
npm --prefix fe run test

echo "Running backend tests (vitest)..."
npm --prefix be run test

echo "All tests passed."
