#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# run python tests
source venv/bin/activate
pytest -s -vv

# run the aiken tests
cd contracts
aiken check
cd ..

# snark is oos for poc
cd snark
go test ./... -count=1
cd ..
