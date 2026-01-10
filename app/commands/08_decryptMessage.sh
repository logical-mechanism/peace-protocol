#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -euo pipefail

# SET UP VARS HERE
source ../.env

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <wallet-name>"
  echo "Example: $0 alice"
  exit 1
fi

WALLET_NAME="$1"

# alice
alice_wallet_path="../wallets/${WALLET_NAME}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import recursive_decrypt

recursive_decrypt('${alice_wallet_path}/payment.skey')
"