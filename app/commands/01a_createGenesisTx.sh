#!/usr/bin/env bash

# Copyright (C) 2025-2026 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# reference contract
reference_script_path="../contracts/contracts/reference_contract.plutus"
reference_script_address=$(${cli} conway address build --payment-script-file ${reference_script_path} ${network})
reference_hash=$(cat ../contracts/hashes/reference.hash)

# genesis wallet
genesis_address=$(cat ../wallets/genesis/payment.addr)
genesis_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/genesis/payment.vkey)

# collat wallet
collat_address=$(cat ../wallets/collat/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ../wallets/collat/payment.vkey)

# genesis change address
change_address=$(jq -r '.genesis_change_address' ${CONFIG_JSON})

# the genesis token information
tx_id=$(jq -r '.genesis_tx_id' ${CONFIG_JSON})
tx_idx=$(jq -r '.genesis_tx_idx' ${CONFIG_JSON})

genesis_pid=$(cat ../contracts/hashes/genesis.hash)
# I-08: mirror on-chain util.construct_token_name (`bytearray.push(idx)`).
# The old `cbor2.dumps(idx)` form diverged from on-chain whenever
# tx_idx >= 24, since CBOR major-type-0 emits two bytes there.
tx_idx_byte=$(python3 -c "idx=${tx_idx}; assert 0 <= idx <= 255, f'tx_idx must be in [0, 255], got {idx}'; print(bytes([idx]).hex())")
full_genesis_tkn="${tx_idx_byte}${tx_id}"
genesis_tkn="${full_genesis_tkn:0:64}"

mint_asset="1 ${genesis_pid}.${genesis_tkn}"
echo -e "\033[0;33m\nMinting: ${mint_asset}\033[0m"

#
# exit
#

utxo_value=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-inline-datum-file ../data/reference/reference-datum.json \
    --tx-out="${reference_script_address} + 5000000 + ${mint_asset}" | tr -dc '0-9')
reference_script_output="${reference_script_address} + ${utxo_value} + ${mint_asset}"

echo -e "\033[0;35m\nGenesis Output: ${reference_script_output}\033[0m"

#
# exit
#

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

genesis_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/genesis_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${change_address} \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in="${tx_id}#${tx_idx}" \
    --tx-out="${reference_script_output}" \
    --tx-out-inline-datum-file ../data/reference/reference-datum.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${genesis_pkh} \
    --mint="${mint_asset}" \
    --mint-tx-in-reference="${genesis_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${genesis_pid}" \
    --mint-reference-tx-in-redeemer-file ../data/reference/void.json \
    ${network})

echo -e "\033[0;35m${FEE}\033[0m"

#
# exit
#

${cli} conway transaction sign \
    --signing-key-file ../wallets/genesis/payment.skey \
    --signing-key-file ../wallets/collat/payment.skey \
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
