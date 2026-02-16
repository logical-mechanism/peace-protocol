#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -euo pipefail

# SET UP VARS HERE
source ../.env

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# bob
bob_wallet_path="../wallets/bob"
bob_address=$(cat ${bob_wallet_path}/payment.addr)
bob_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${bob_wallet_path}/payment.vkey)

# collat wallet
collat_wallet_path="../wallets/collat"
collat_address=$(cat ${collat_wallet_path}/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${collat_wallet_path}/payment.vkey)

# stake key
staking_credential=$(jq -r '.staking_credential' ${CONFIG_JSON})

# bidding
bidding_script_path="../contracts/contracts/bidding_contract.plutus"
bidding_script_address=$(${cli} conway address build --payment-script-file ${bidding_script_path} --stake-key-hash ${staking_credential} ${network})
bidding_pid=$(cat ../contracts/hashes/bidding.hash)

# encryption
encryption_script_path="../contracts/contracts/encryption_contract.plutus"
encryption_script_address=$(${cli} conway address build --payment-script-file ${encryption_script_path} --stake-key-hash ${staking_credential} ${network})
encryption_pid=$(cat ../contracts/hashes/encryption.hash)

# reference
reference_script_path="../contracts/contracts/reference_contract.plutus"
reference_script_address=$(${cli} conway address build --payment-script-file ${reference_script_path} ${network})

# the genesis token information
tx_id=$(jq -r '.genesis_tx_id' ${CONFIG_JSON})
tx_idx=$(jq -r '.genesis_tx_idx' ${CONFIG_JSON})

genesis_pid=$(cat ../contracts/hashes/genesis.hash)
tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${tx_idx});print(encoded.hex())")
full_genesis_tkn="${tx_idx_cbor}${tx_id}"
genesis_tkn="${full_genesis_tkn:0:64}"

# encryption token
encryption_token=$(cat ../data/encryption.token)

echo -e "\033[0;36m Gathering Collateral UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${collat_address} \
    --out-file ./tmp/collat_utxo.json
TXNS=$(jq length ./tmp/collat_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${collat_address} \033[0m \n";
   exit;
fi
collat_utxo=$(jq -r 'keys[0]' ./tmp/collat_utxo.json)

# get script utxos
echo -e "\033[0;36m Gathering Encryption UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${encryption_script_address} \
    ${network} \
    --out-file ./tmp/encryption_utxo.json
TXNS=$(jq length ./tmp/encryption_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${reference_script_address} \033[0m \n";
.   exit;
fi
TXIN=$(jq -r --arg alltxin "" --arg policy_id "$encryption_pid" --arg token_name "$encryption_token" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/encryption_utxo.json)
encryption_tx_in=${TXIN::-8}

echo -e "\033[0;36m Gathering Reference UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${reference_script_address} \
    ${network} \
    --out-file ./tmp/reference_utxo.json
TXNS=$(jq length ./tmp/reference_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${reference_script_address} \033[0m \n";
.   exit;
fi

TXIN=$(jq -r --arg alltxin "" --arg policy_id "$genesis_pid" --arg token_name "$genesis_tkn" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/reference_utxo.json)
reference_tx_in=${TXIN::-8}

echo -e "\033[0;36m Gathering Bob UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${bob_address} \
    --out-file ./tmp/bob_utxo.json
TXNS=$(jq length ./tmp/bob_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${bob_address} \033[0m \n";
   exit;
fi
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' ./tmp/bob_utxo.json)
bob_utxo=${TXIN::-8}

# find token name from inputs
first_utxo=$(jq -r 'keys[0]' ./tmp/bob_utxo.json)

string=${first_utxo}
IFS='#' read -ra array <<< "$string"

tx_idx_cbor=$(../venv/bin/python -c "import cbor2;encoded=cbor2.dumps(${array[1]});print(encoded.hex())")
full_tkn="${tx_idx_cbor}${array[0]}"
token_name="${full_tkn:0:64}"
echo $token_name > ../data/bidding.token
bidding_asset="1 ${bidding_pid}.${token_name}"
echo -e "\033[1;36m\nBidding Token: ${bidding_asset} \033[0m"

PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import create_bidding_tx

create_bidding_tx('${bob_wallet_path}/payment.skey')
"

jq \
--arg bob_pkh "${bob_pkh}" \
--arg bid_token_name "${token_name}" \
--arg encryption_token "${encryption_token}" \
--argjson register "$(cat ../data/register.json)" \
'.fields[0].bytes=$bob_pkh |
.fields[1]=$register |
.fields[2].bytes=$bid_token_name |
.fields[3].bytes=$encryption_token' \
../data/bidding/bidding-datum.json | sponge ../data/bidding/bidding-datum.json

jq \
--argjson schnorr "$(cat ../data/schnorr.json)" \
'.fields[0]=$schnorr' \
../data/bidding/bidding-mint-redeemer.json | sponge ../data/bidding/bidding-mint-redeemer.json

utxo_value=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-inline-datum-file ../data/bidding/bidding-datum.json \
    --tx-out="${bidding_script_address} + 5000000 + ${bidding_asset}" | tr -dc '0-9')
bidding_script_output="${bidding_script_address} + $((${utxo_value} + 5000000)) + ${bidding_asset}"

echo -e "\033[0;35m\nBidding Output: ${bidding_script_output}\033[0m"

bidding_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/bidding_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${bob_address} \
    --read-only-tx-in-reference="${reference_tx_in}" \
    --read-only-tx-in-reference="${encryption_tx_in}" \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in ${bob_utxo} \
    --tx-out="${bidding_script_output}" \
    --tx-out-inline-datum-file ../data/bidding/bidding-datum.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${bob_pkh} \
    --mint="${bidding_asset}" \
    --mint-tx-in-reference="${bidding_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${bidding_pid}" \
    --mint-reference-tx-in-redeemer-file ../data/bidding/bidding-mint-redeemer.json \
    ${network})

echo -e "\033[0;35m${FEE}\033[0m"

#
# exit
#

${cli} conway transaction sign \
    --signing-key-file ../wallets/collat/payment.skey \
    --signing-key-file ${bob_wallet_path}/payment.skey \
    --tx-body-file ./tmp/tx.draft \
    --out-file ./tmp/tx.signed \
    ${network}

#
# exit
#

echo -e "\033[1;36m\nSubmitting\033[0m"
${cli} conway transaction submit \
    ${network} \
    --tx-file ./tmp/tx.signed

echo -e "\033[0;32m\nDone!\033[0m"