#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

# get params
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# alice
alice_wallet_path="../wallets/alice"
alice_address=$(cat ${alice_wallet_path}/payment.addr)
alice_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${alice_wallet_path}/payment.vkey)

# collat wallet
collat_wallet_path="../wallets/collat"
collat_address=$(cat ${collat_wallet_path}/payment.addr)
collat_pkh=$(${cli} conway address key-hash --payment-verification-key-file ${collat_wallet_path}/payment.vkey)

# stake key
stake_key=$(jq -r '.stake_key' ../config.json)

# encryption
encryption_script_path="../contracts/contracts/encryption_contract.plutus"
encryption_script_address=$(${cli} conway address build --payment-script-file ${encryption_script_path} --stake-key-hash ${stake_key} ${network})
encryption_pid=$(cat ../contracts/hashes/encryption.hash)

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

token_name=$(jq -r '.fields[2].bytes' ../data/encryption/encryption-datum.json)
encryption_asset="-1 ${encryption_pid}.${token_name}"
echo -e "\033[1;36m\nBurning Encryption Token: ${encryption_asset} \033[0m"

jq \
--arg tkn "${token_name}" \
'.fields[0].bytes=$tkn' \
../data/encryption/encryption-burn-redeemer.json | sponge ../data/encryption/encryption-burn-redeemer.json

# get script utxo
echo -e "\033[0;36m Gathering Encryption UTxO Information  \033[0m"
${cli} conway query utxo \
    --address ${encryption_script_address} \
    ${network} \
    --out-file ./tmp/encryption_utxo.json
TXNS=$(jq length ./tmp/encryption_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${encryption_script_address} \033[0m \n";
.   exit;
fi

TXIN=$(jq -r --arg alltxin "" --arg policy_id "$encryption_pid" --arg token_name "$token_name" 'to_entries[] | select(.value.value[$policy_id][$token_name] == 1) | .key | . + $alltxin + " --tx-in"' tmp/encryption_utxo.json)
encryption_tx_in=${TXIN::-8}

encryption_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/encryption_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${alice_address} \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in ${alice_utxo} \
    --tx-in ${encryption_tx_in} \
    --spending-tx-in-reference="${encryption_ref_utxo}#1" \
    --spending-plutus-script-v3 \
    --spending-reference-tx-in-inline-datum-present \
    --spending-reference-tx-in-redeemer-file ../data/encryption/encryption-remove-redeemer.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${alice_pkh} \
    --mint="${encryption_asset}" \
    --mint-tx-in-reference="${encryption_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${encryption_pid}" \
    --mint-reference-tx-in-redeemer-file ../data/encryption/encryption-burn-redeemer.json \
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
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/tx.signed

echo -e "\033[0;32m\nDone!\033[0m"