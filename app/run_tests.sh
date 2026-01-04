#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -euo pipefail

OUT="coverage.txt"
: > "$OUT"

# --------------------
# PYTHON
# --------------------

echo "====================" | tee -a "$OUT"
echo "PYTHON COVERAGE"     | tee -a "$OUT"
echo "====================" | tee -a "$OUT"

if [ ! -f venv/bin/activate ]; then
  echo "ERROR: venv not found. Run: python -m venv venv" >&2
  exit 1
fi

echo -e "\033[1;36m\nRunning Python Tests\033[0m"
source venv/bin/activate
coverage erase
coverage run -m pytest -s -vv
coverage report -m | tee -a "$OUT"
deactivate

# --------------------
# AIKEN
# --------------------
echo -e "\033[1;36m\nRunning Aiken Tests\033[0m"
cd contracts
aiken check
cd ..

# --------------------
# GO / GNARK
# --------------------

echo "" | tee -a "$OUT"
echo "====================" | tee -a "$OUT"
echo "GO COVERAGE"         | tee -a "$OUT"
echo "====================" | tee -a "$OUT"

echo -e "\033[1;36m\nRunning Gnark Tests\033[0m"
cd snark
go test -v -count=1 -timeout=120m -coverprofile=cover.out ./...
go tool cover -func=cover.out | tee -a "../$OUT"
cd ..
