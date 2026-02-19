#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Linting frontend (eslint)..."
npm --prefix fe run lint

echo "Linting backend (tsc)..."
npm --prefix be run lint

echo "Checking Rust formatting..."
cargo fmt --check --manifest-path src-tauri/Cargo.toml

echo "Running Clippy..."
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

echo "All lints passed."
