#!/usr/bin/env bash
set -euo pipefail

# SET UP VARS HERE
source ../.env

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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
staking_credential=$(jq -r '.staking_credential' ../config.json)

# encryption
encryption_script_path="../contracts/contracts/encryption_contract.plutus"
encryption_script_address=$(${cli} conway address build --payment-script-file ${encryption_script_path} --stake-key-hash ${staking_credential} ${network})
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

# find token name from inputs
first_utxo=$(jq -r 'keys[0]' ./tmp/alice_utxo.json)

string=${first_utxo}
IFS='#' read -ra array <<< "$string"

tx_idx_cbor=$(../venv/bin/python -c "import cbor2;encoded=cbor2.dumps(${array[1]});print(encoded.hex())")
full_tkn="${tx_idx_cbor}${array[0]}"
token_name="${full_tkn:0:64}"
echo $token_name > ../data/encryption.token
encryption_asset="1 ${encryption_pid}.${token_name}"
echo -e "\033[1;36m\nEncryption Token: ${encryption_asset} \033[0m"

# encrypt the message
secret_message="This is a secret message."

# generate the register
PYTHONPATH="$PROJECT_ROOT" \
"$PROJECT_ROOT/venv/bin/python" -c \
"
from src.commands import create_encryption_tx

create_encryption_tx('${alice_wallet_path}/payment.skey', '${secret_message}', '${token_name}')
"

jq \
--arg alice_pkh "${alice_pkh}" \
--arg token_name "${token_name}" \
--argjson register "$(cat ../data/register.json)" \
--argjson capsule "$(cat ../data/capsule.json)" \
--argjson half_level "$(cat ../data/half-level.json)" \
'.fields[0].bytes=$alice_pkh |
.fields[1]=$register |
.fields[2].bytes=$token_name |
.fields[3].list=[$half_level] |
.fields[4]=$capsule' \
../data/encryption/encryption-datum.json | sponge ../data/encryption/encryption-datum.json

jq \
--argjson schnorr "$(cat ../data/schnorr.json)" \
--argjson binding "$(cat ../data/binding.json)" \
'.fields[0]=$schnorr |
.fields[1]=$binding' \
../data/encryption/encryption-mint-redeemer.json | sponge ../data/encryption/encryption-mint-redeemer.json

# should be able to build the tx now
utxo_value=$(${cli} conway transaction calculate-min-required-utxo \
    --protocol-params-file ./tmp/protocol.json \
    --tx-out-inline-datum-file ../data/encryption/encryption-datum.json \
    --tx-out="${encryption_script_address} + 5000000 + ${encryption_asset}" | tr -dc '0-9')
encryption_script_output="${encryption_script_address} + ${utxo_value} + ${encryption_asset}"

echo -e "\033[0;35m\nEncryption Output: ${encryption_script_output}\033[0m"

encryption_ref_utxo=$(${cli} conway transaction txid --tx-file tmp/encryption_contract-reference-utxo.signed | jq -r '.txhash')

echo -e "\033[0;36m Building Tx \033[0m"
FEE=$(${cli} conway transaction build \
    --out-file ./tmp/tx.draft \
    --change-address ${alice_address} \
    --tx-in-collateral="${collat_utxo}" \
    --tx-in ${alice_utxo} \
    --tx-out="${encryption_script_output}" \
    --tx-out-inline-datum-file ../data/encryption/encryption-datum.json \
    --required-signer-hash ${collat_pkh} \
    --required-signer-hash ${alice_pkh} \
    --mint="${encryption_asset}" \
    --mint-tx-in-reference="${encryption_ref_utxo}#1" \
    --mint-plutus-script-v3 \
    --policy-id="${encryption_pid}" \
    --mint-reference-tx-in-redeemer-file ../data/encryption/encryption-mint-redeemer.json \
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
    # Perform operations on each file
    ${cli} conway transaction submit \
        ${network} \
        --tx-file ./tmp/tx.signed

echo -e "\033[0;32m\nDone!\033[0m"