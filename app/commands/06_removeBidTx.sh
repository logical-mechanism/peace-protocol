#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# SET UP VARS HERE
source ../.env

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
staking_credential=$(jq -r '.staking_credential' ../config.json)

# bidding
bidding_script_path="../contracts/contracts/bidding_contract.plutus"
bidding_script_address=$(${cli} conway address build --payment-script-file ${bidding_script_path} --stake-key-hash ${staking_credential} ${network})
bidding_pid=$(cat ../contracts/hashes/bidding.hash)

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

# should be able to build the tx now
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

token_name=$(jq -r '.fields[2].bytes' ../data/bidding/bidding-datum.json)
bidding_asset="-1 ${bidding_pid}.${token_name}"
echo -e "\033[1;36m\nBurning Bidding Token: ${bidding_asset} \033[0m"

jq \
--arg tkn "${token_name}" \
'.fields[0].bytes=$tkn' \
../data/bidding/bidding-burn-redeemer.json | sponge ../data/bidding/bidding-burn-redeemer.json

# get script utxo
echo -e "\033[0;36m Gathering Bidding UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${bidding_script_address} \
    ${network} \
    --out-file ./tmp/bidding_utxo.json
TXNS=$(jq length ./tmp/bidding_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${bidding_script_address} \033[0m \n";
.   exit;
fi

TXIN=$(jq -r --arg alltxin "" --arg policy_id "$bidding_pid" --arg token_name "$token_name" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/bidding_utxo.json)
bidding_tx_in=${TXIN::-8}

bidding_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/bidding_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${bob_address} \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in ${bob_utxo} \
    --tx-in ${bidding_tx_in} \
    --spending-tx-in-reference="${bidding_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/bidding/bidding-remove-redeemer.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${bob_pkh} \
    --mint="${bidding_asset}" \
    --mint-tx-in-reference="${bidding_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${bidding_pid}" \
    --mint-reference-tx-in-redeemer-file ../data/bidding/bidding-burn-redeemer.json \
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
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/tx.signed

echo -e "\033[0;32m\nDone!\033[0m"