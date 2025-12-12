#!/usr/bin/env bash
set -e

# SET UP VARS HERE
source ../.env

secret_message="This is a secret message."

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

# find token name from inputs
first_utxo=$(jq -r 'keys[0]' ./tmp/alice_utxo.json)

string=${first_utxo}
IFS='#' read -ra array <<< "$string"

tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${array[1]});print(encoded.hex())")
full_tkn="${tx_idx_cbor}${array[0]}"
token_name="${full_tkn:0:64}"
encryption_asset="1 ${encryption_pid}.${token_name}"
echo -e "\033[1;36m\nEncryption Token: ${encryption_asset} \033[0m"

# encrypt the message

jq \
--arg alice_pkh "${alice_pkh}" \
--arg token_name "${token_name}" \
'.fields[0].bytes=$alice_pkh |
.fields[2].bytes=$token_name |
.fields[3].list=[]' \
../data/encryption/encryption-datum.json | sponge ../data/encryption/encryption-datum.json