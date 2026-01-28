#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

# SET UP VARS HERE
source ../.env

# get current parameters
mkdir -p ./tmp
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# alice
alice_wallet_path="../wallets/alice"
alice_address=$(cat ${alice_wallet_path}/payment.addr)
alice_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${alice_wallet_path}/payment.vkey)

# collat wallet
collat_wallet_path="../wallets/collat"
collat_address=$(cat ${collat_wallet_path}/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${collat_wallet_path}/payment.vkey)

# groth
groth_script_path="../contracts/contracts/groth_contract.plutus"
groth_pid=$(cat ../contracts/hashes/groth.hash)

deposit="$(jq -r '.stakeAddressDeposit' ./tmp/protocol.json)"

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

${cli} conway stake-address registration-certificate \
  --stake-script-file ${groth_script_path} \
  --key-reg-deposit-amt "$deposit" \
  --out-file ./tmp/groth.stake.reg.cert

jq \
--arg script "${groth_pid}" \
'.fields[0].bytes=$script' \
../data/groth/register-redeemer.json | sponge ../data/groth/register-redeemer.json


groth_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/groth_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
  ${network} \
  --tx-in-collateral="${collat_utxo}" \
  --tx-in "$alice_utxo" \
  --change-address "$alice_address" \
  --certificate ./tmp/groth.stake.reg.cert \
  --certificate-tx-in-reference="${groth_ref_utxo}#1" \
  --certificate-plutus-script-v3 \
  --certificate-reference-tx-in-redeemer-file ../data/groth/register-redeemer.json \
  --out-file ./tmp/tx.reg.raw)

echo -e "\033[0;35m${FEE}\033[0m"

${cli} conway transaction sign \
  --tx-body-file ./tmp/tx.reg.raw \
  --signing-key-file ../wallets/collat/payment.skey \
  --signing-key-file ${alice_wallet_path}/payment.skey \
  ${network} \
  --out-file ./tmp/tx.reg.signed

echo -e "\033[1;36m\nSubmitting\033[0m"
${cli} conway transaction submit \
  ${network} \
  --tx-file ./tmp/tx.reg.signed
