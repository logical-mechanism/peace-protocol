#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -euo pipefail

# SET UP VARS HERE
source ../.env

# alice
alice_wallet_path="../wallets/bob"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import recursive_decrypt

recursive_decrypt('${alice_wallet_path}/payment.skey')
"