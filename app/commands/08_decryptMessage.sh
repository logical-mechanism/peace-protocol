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

# koios stuff for querying
encryption_pid=$(cat ../contracts/hashes/encryption.hash)
encryption_tkn=$(cat ../data/encryption.token)

asset=${encryption_pid}${encryption_tkn}

tx_hashes=$(curl -X GET "https://preprod.koios.rest/api/v1/asset_txs?_asset_policy=${encryption_pid}&_asset_name=${encryption_tkn}&_history=true" -H 'accept: application/json' | jq -r '[.[].tx_hash][:-1]')

encryption_levels=$(curl -X POST "https://preprod.koios.rest/api/v1/tx_info" \
 -H 'accept: application/json' \
 -H 'content-type: application/json' \
 -d '{"_tx_hashes":'"${tx_hashes}"',"_inputs":false,"_metadata":false,"_assets":false,"_withdrawals":false,"_certs":false,"_scripts":true,"_bytecode":false}' | jq 'sort_by(.block_height) | reverse |
  [.[0] | .outputs[] | select(.payment_addr.bech32 == "addr_test1zqrx3fkkfurpwphwaqe9ne27tn9qpkkn5p6rajs636pfntyxca55rx42vu7fv0dqfe94htjy34ysut82eypvhqhymfmqhet0m3") | .inline_datum.value.fields[3,4]] +
  [.[1:][] | .outputs[] | select(.payment_addr.bech32 == "addr_test1zqrx3fkkfurpwphwaqe9ne27tn9qpkkn5p6rajs636pfntyxca55rx42vu7fv0dqfe94htjy34ysut82eypvhqhymfmqhet0m3") | .inline_datum.value.fields[4]]
')


WALLET_NAME="$1"

# alice
alice_wallet_path="../wallets/${WALLET_NAME}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import recursive_decrypt

recursive_decrypt('${alice_wallet_path}/payment.skey', ${encryption_levels})
"