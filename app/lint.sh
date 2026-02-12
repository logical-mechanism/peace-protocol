#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Python ==="
source "$SCRIPT_DIR/venv/bin/activate"
ruff format "$SCRIPT_DIR"
ruff check "$SCRIPT_DIR" --fix
mypy "$SCRIPT_DIR"

echo ""
echo "=== Go (snark) ==="
cd "$SCRIPT_DIR/snark"
gofmt -w .
go vet ./...

echo ""
echo "=== TypeScript (ui) ==="
cd "$SCRIPT_DIR/ui"
npm run lint