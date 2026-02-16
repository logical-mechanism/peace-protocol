#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# SET UP VARS HERE
source ../.env

echo -e "\n \033[0;31m Reference Datum Updating Deprecated\n";
exit;

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# alice
alice_wallet_path="../wallets/alice"
alice_address=$(cat ${alice_wallet_path}/payment.addr)
alice_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${alice_wallet_path}/payment.vkey)

# reference contract
reference_script_path="../contracts/contracts/reference_contract.plutus"
reference_script_address=$(${cli} conway address build --payment-script-file ${reference_script_path} ${network})
reference_hash=$(cat ../contracts/hashes/reference.hash)

# collat wallet
collat_address=$(cat ../wallets/collat/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/collat/payment.vkey)

# the genesis token information
tx_id=$(jq -r '.genesis_tx_id' ${CONFIG_JSON})
tx_idx=$(jq -r '.genesis_tx_idx' ${CONFIG_JSON})

genesis_pid=$(cat ../contracts/hashes/genesis.hash)
tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${tx_idx});print(encoded.hex())")
full_genesis_tkn="${tx_idx_cbor}${tx_id}"
genesis_tkn="${full_genesis_tkn:0:64}"

genesis_asset="1 ${genesis_pid}.${genesis_tkn}"

echo -e "\033[0;36m Gathering Alice UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${alice_address} \
    --out-file ./tmp/alice_utxo.json
TXNS=$(jq length ./tmp/alice_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${alice_address} \033[0m \n";
   exit;
fi
TXIN=$(jq -r --arg alltxin "" 'keys[] | . + $alltxin + " --tx-in"' ./tmp/alice_utxo.json)
alice_utxo=${TXIN::-8}

# get script utxo
echo -e "\033[0;36m Gathering Script UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${reference_script_address} \
    ${network} \
    --out-file ./tmp/script_utxo.json
TXNS=$(jq length ./tmp/script_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${reference_script_address} \033[0m \n";
.   exit;
fi

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

utxo_value=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-inline-datum-file ../data/reference/reference-datum.json \
    --tx-out="${reference_script_address} + 5000000 + ${genesis_asset}" | tr -dc '0-9')
reference_script_output="${reference_script_address} + ${utxo_value} + ${genesis_asset}"
echo -e "\033[0;35m\nGenesis Output: ${reference_script_output}\033[0m"

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${alice_address} \
    --tx-in-collateral ${collat_tx_in} \
    --tx-in ${alice_utxo} \
    --tx-in ${reference_tx_in} \
    --spending-tx-in-reference="${reference_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/reference/void.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${alice_pkh} \
    --tx-out="${reference_script_output}" \
    --tx-out-inline-datum-file ../data/reference/reference-datum.json \
    ${network})

echo -e "\033[0;35m${FEE}\033[0m"

#
# exit
#

${cli} conway transaction sign \
    --signing-key-file ../wallets/collat/payment.skey \
    --signing-key-file ../wallets/alice/payment.skey \
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