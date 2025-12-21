#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# reference script
script_path="../contracts/contracts/reference_contract.plutus"
script_address=$(${cli} conway address build --payment-script-file ${script_path} ${network})

# collat wallet
collat_address=$(cat ../wallets/collat/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/collat/payment.vkey)

# return leftover ada address
change_address=$(jq -r '.genesis_change_address' ../config.json)

# the genesis token information
tx_id=$(jq -r '.genesis_tx_id' ../config.json)
tx_idx=$(jq -r '.genesis_tx_idx' ../config.json)

genesis_pid=$(cat ../contracts/hashes/genesis.hash)
tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${tx_idx});print(encoded.hex())")
full_genesis_tkn="${tx_idx_cbor}${tx_id}"
genesis_tkn="${full_genesis_tkn:0:64}"

# get script utxo
echo -e "\033[0;36m Gathering Script UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${script_address} \
    ${network} \
    --out-file ./tmp/script_utxo.json
TXNS=$(jq length ./tmp/script_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${script_address} \033[0m \n";
.   exit;
fi
alltxin=""
TXIN=$(jq -r --arg alltxin "" --arg policy_id "$genesis_pid" --arg token_name "$genesis_tkn" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/script_utxo.json)
reference_tx_in=${TXIN::-8}

# collat info
echo -e "\033[0;36m Gathering Collateral UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${collat_address} \
    --out-file tmp/collat_utxo.json

TXNS=$(jq length tmp/collat_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${collat_address} \033[0m \n";
   exit;
fi
collat_tx_in=$(jq -r 'keys[0]' tmp/collat_utxo.json)

# script reference utxo
reference_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/reference_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${change_address} \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${reference_tx_in} \
    --spending-tx-in-reference="${reference_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/reference/void.json \
    --required-signer-hash ${collat_pkh} \
    ${network})

echo -e "\033[0;35m${FEE}\033[0m"

#
# exit
#

${cli} conway transaction sign \
    --signing-key-file ../wallets/collat/payment.skey \
    --tx-body-file ./tmp/tx.draft \
    --out-file ./tmp/tx.signed \
    ${network}

#
# exit
#

echo -e "\033[1;36m\nSubmitting\033[0m"
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/tx.signed

echo -e "\033[0;32m\nDone!\033[0m"