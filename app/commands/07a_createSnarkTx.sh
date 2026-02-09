#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -euo pipefail

# SET UP VARS HERE
source ../.env

TOTAL=130  # a guess
CMD_PID=

run_with_progress() {
  "$@" &
  CMD_PID=$!

  start=$(date +%s)

  while kill -0 "$CMD_PID" 2>/dev/null; do
    now=$(date +%s)
    elapsed=$((now - start))

    percent=$((elapsed * 100 / TOTAL))
    (( percent > 100 )) && percent=100

    filled=$((percent / 2))
    empty=$((50 - filled))

    printf "\r[%.*s%*s] %3d%%" \
      "$filled" "##################################################" \
      "$empty" "" \
      "$percent"
    
    sleep 1
  done

  printf "\r[%.*s] 100%%\n" "50" "##################################################"
  wait "$CMD_PID"
}

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# alice
alice_wallet_path="../wallets/alice"
alice_address=$(cat ${alice_wallet_path}/payment.addr)
alice_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${alice_wallet_path}/payment.vkey)

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

# encryption
encryption_script_path="../contracts/contracts/encryption_contract.plutus"
encryption_script_address=$(${cli} conway address build --payment-script-file ${encryption_script_path} --stake-key-hash ${staking_credential} ${network})
encryption_pid=$(cat ../contracts/hashes/encryption.hash)

# reference
reference_script_path="../contracts/contracts/reference_contract.plutus"
reference_script_address=$(${cli} conway address build --payment-script-file ${reference_script_path} ${network})

groth_script_path="../contracts/contracts/groth_contract.plutus"
groth_address=$(${cli} conway stake-address build --stake-script-file ${groth_script_path} ${network})

rewardBalance=$(${cli} conway query stake-address-info \
    ${network} \
    --address ${groth_address} | jq -r ".[0].rewardAccountBalance")
echo rewardBalance: $rewardBalance

withdrawalString="${groth_address}+${rewardBalance}"
echo "Withdraw: " $withdrawalString

# the genesis token information
tx_id=$(jq -r '.genesis_tx_id' ../config.json)
tx_idx=$(jq -r '.genesis_tx_idx' ../config.json)

genesis_pid=$(cat ../contracts/hashes/genesis.hash)
tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${tx_idx});print(encoded.hex())")
full_genesis_tkn="${tx_idx_cbor}${tx_id}"
genesis_tkn="${full_genesis_tkn:0:64}"

# bidding token
bidding_token=$(cat ../data/bidding.token)

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
TXIN=$(jq -r --arg alltxin "" --arg policy_id "$bidding_pid" --arg token_name "$bidding_token" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/bidding_utxo.json)
bidding_tx_in=${TXIN::-8}

# get script utxo
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

bob_register=$(jq -r '.fields[1]' ../data/bidding/bidding-datum.json)
bob_public_value=$(jq -r '.fields[1].fields[1].bytes' ../data/bidding/bidding-datum.json)

echo -e "\033[0;35m\nCreating Groth16 Witness \033[0m"
export PYTHONPATH="$PROJECT_ROOT"

run_with_progress \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import create_snark_tx, create_reencryption_tx

a1, r1, hk = create_snark_tx('${bob_public_value}')

create_reencryption_tx('${alice_wallet_path}/payment.skey', '${bob_public_value}', '${encryption_token}', a1, r1, hk)
"

lower_timestamp=$(python3 -c "from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) - timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
lower_bound=$(${cli} conway query slot-number ${network} ${lower_timestamp})

upper_timestamp=$(python3 -c "from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) + timedelta(days=0, hours=0, minutes=25)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
upper_bound=$(${cli} conway query slot-number ${network} ${upper_timestamp})

unix_time=$(python3 -c "from datetime import datetime, timedelta, timezone; print(1000*int((datetime.now(timezone.utc) + timedelta(days=0, hours=6, minutes=40)).timestamp()))")

cp ../data/groth/groth-commitment-wires.json ../data/groth/copy.groth-commitment-wires.json
wire_bytearray=$(jq -r '.list[0].int' ../data/groth/groth-commitment-wires.json | python3 -c 'import sys; print(hex(int(sys.stdin.read()))[2:])')

jq \
--arg wire "${wire_bytearray}" \
'.list[0] | {"bytes":$wire}' \
../data/groth/groth-commitment-wires.json | sponge ../data/groth/groth-commitment-wires.json

jq \
--argjson proof "$(cat ../data/groth/groth-proof.json)" \
--argjson wire "$(cat ../data/groth/groth-commitment-wires.json)" \
--argjson public "$(cat ../data/groth/groth-public.json)" \
--argjson ttl "${unix_time}" \
'.fields[0]=$proof |
.fields[1]=$wire |
.fields[2]=$public |
.fields[3].int=$ttl' \
../data/groth/witness-redeemer.json | sponge ../data/groth/witness-redeemer.json

jq \
--argjson proof "$(cat ../data/groth/groth-proof.json)" \
--argjson public "$(cat ../data/groth/groth-public.json)" \
--argjson ttl "${unix_time}" \
'.fields[0]=$proof |
.fields[1]=$public |
.fields[2].int=$ttl' \
../data/encryption/pending-status.json | sponge ../data/encryption/pending-status.json

cp ../data/encryption/encryption-datum.json ../data/encryption/next-encryption-datum.json


jq \
--argjson status "$(cat ../data/encryption/pending-status.json)" \
'.fields[6]=$status' \
../data/encryption/next-encryption-datum.json | sponge ../data/encryption/next-encryption-datum.json

encryption_asset="1 ${encryption_pid}.${encryption_token}"
echo -e "\033[1;36m\nEncryption Token: ${encryption_asset} \033[0m"

utxo_value=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-inline-datum-file ../data/encryption/next-encryption-datum.json \
    --tx-out="${encryption_script_address} + 5000000 + ${encryption_asset}" | tr -dc '0-9')
encryption_script_output="${encryption_script_address} + ${utxo_value} + ${encryption_asset}"

echo -e "\033[0;35m\nEncryption Output: ${encryption_script_output}\033[0m"

encryption_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/encryption_contract-reference-utxo.signed | jq -r '.txhash')
groth_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/groth_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --invalid-before ${lower_bound} \
    --invalid-hereafter ${upper_bound} \
    --out-file ./tmp/tx.draft \
    --change-address ${alice_address} \
    --read-only-tx-in-reference="${reference_tx_in}" \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in ${alice_utxo} \
    --tx-in ${encryption_tx_in} \
    --spending-tx-in-reference="${encryption_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/encryption/encryption-snark-redeemer.json \
    --tx-out="${encryption_script_output}" \
    --tx-out-inline-datum-file ../data/encryption/next-encryption-datum.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${alice_pkh} \
    --withdrawal ${withdrawalString} \
    --withdrawal-tx-in-reference="${groth_ref_utxo}#1" \
    --withdrawal-plutus-script-v3 \
    --withdrawal-reference-tx-in-redeemer-file ../data/groth/witness-redeemer.json \
    ${network})

echo -e "\033[0;35m${FEE}\033[0m"

#
# exit
#

${cli} conway transaction sign \
    --signing-key-file ../wallets/collat/payment.skey \
    --signing-key-file ${alice_wallet_path}/payment.skey \
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

cp ../data/encryption/next-encryption-datum.json ../data/encryption/encryption-datum.json

echo -e "\033[0;32m\nDone!\033[0m"