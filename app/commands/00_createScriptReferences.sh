#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

mkdir -p ./tmp
${cli} conway query protocol-parameters ${network} --out-file ./tmp/protocol.json

# Addresses
payment_wallet_name="holder"
payment_address=$(cat ../wallets/${payment_wallet_name}/payment.addr)
script_reference_output_address=$(cat ../wallets/${payment_wallet_name}/payment.addr)

echo -e "\033[0;35m\nGathering UTxO Information  \033[0m"
${cli} conway query utxo \
    ${network} \
    --address ${payment_address} \
    --out-file ./tmp/payment_utxo.json

TXNS=$(jq length ./tmp/payment_utxo.json)
if [ "${TXNS}" -eq "0" ]; then
   echo -e "\n \033[0;31m NO UTxOs Found At ${payment_address} \033[0m \n";
   exit;
fi
alltxin=""
TXIN=$(jq -r --arg alltxin "" 'to_entries[] | select(.value.value | length < 2) | .key | . + $alltxin + " --tx-in"' ./tmp/payment_utxo.json)
ref_tx_in=${TXIN::-8}

# we need this to chain everything together
changeAmount=$(jq '[.. | objects | .lovelace] | add' ./tmp/payment_utxo.json)

# Loop through each file in the directory
echo -e "\033[0;33m\nStart Building Tx Chain \033[0m"
for contract in $(ls "../contracts/contracts/"* | sort -V)
do 
    # file_name=$(basename "$contract")
    filename=$(basename "$contract" .plutus)

    echo -e "\033[1;37m--------------------------------------------------------------------------------\033[0m"
    echo -e "\033[1;35m\n${contract}\033[0m" 
    
    # get the required lovelace
    min_utxo=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-reference-script-file ${contract} \
    --tx-out="${script_reference_output_address} + 1000000" | tr -dc '0-9')
    # build the utxo
    script_reference_utxo="${script_reference_output_address} + ${min_utxo}"
    echo -e "\033[0;32m\nCreating ${file_name} Script:\n" ${script_reference_utxo} " \033[0m"

    ${cli} conway transaction build-raw \
    --protocol-params-file ./tmp/protocol.json \
    --out-file ./tmp/tx.draft \
    --tx-in ${ref_tx_in} \
    --tx-out="${payment_address} + ${changeAmount}" \
    --tx-out="${script_reference_utxo}" \
    --tx-out-reference-script-file ${contract} \
    --fee 1000000

    size=$(jq -r '.cborHex' ${contract} | awk '{print length($0)*8}')

    fee=$(${cli} conway transaction calculate-min-fee \
        --tx-body-file ./tmp/tx.draft \
        --protocol-params-file ./tmp/protocol.json \
        --reference-script-size ${size} \
        --witness-count 1 | jq -r '.fee')
    echo -e "\033[0;35mFee: ${fee} \033[0m"

    changeAmount=$((${changeAmount} - ${min_utxo} - ${fee}))

    ${cli} conway transaction build-raw \
        --protocol-params-file ./tmp/protocol.json \
        --out-file ./tmp/tx.draft \
        --tx-in ${ref_tx_in} \
        --tx-out="${payment_address} + ${changeAmount}" \
        --tx-out="${script_reference_utxo}" \
        --tx-out-reference-script-file ${contract} \
        --fee ${fee}

    ${cli} conway transaction sign \
        --signing-key-file ../wallets/${payment_wallet_name}/payment.skey \
        --tx-body-file ./tmp/tx.draft \
        --out-file ./tmp/${filename}-reference-utxo.signed \
        ${network}

    txid=$(${cli} conway transaction txid --tx-body-file ./tmp/tx.draft | jq -r '.txhash')
    ref_tx_in=${txid}#0
    echo 
    echo -e "\033[0;36mScript UTxO: ${txid}#1 \033[0m"
done

echo -e "\033[1;37m--------------------------------------------------------------------------------\033[0m"
# now submit them in that order
for contract in $(ls "../contracts/contracts/"* | sort -V)
do
    filename=$(basename "$contract" .plutus)
    echo -e "\nSubmitting ${filename}"
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/${filename}-reference-utxo.signed
done

echo -e "\033[0;32m\nDone!\033[0m"
