#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

source ../.env

# create directories if dont exist
mkdir -p contracts
mkdir -p hashes

# remove old files
rm contracts/* || true
rm hashes/* || true
rm -fr build/ || true

# remove all traces for production
# aiken build --trace-level silent --trace-filter user-defined

# keep all traces for development
aiken build --trace-level verbose --trace-filter all

echo -e "\033[1;36m\nBuilding Genesis Contract\033[0m"
genesis_tx_id=$(jq -r '.genesis_tx_id' ${CONFIG_JSON})
genesis_tx_idx=$(jq -r '.genesis_tx_idx' ${CONFIG_JSON})
genesis_tx_id_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_tx_id}'));print(encoded.hex())")
genesis_tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${genesis_tx_idx});print(encoded.hex())")

echo -e "\033[1;33mGenesis UTxO: ${genesis_tx_id}#${genesis_tx_idx} \033[0m"
echo -e "\033[1;33mGenesis CBOR: tx_id=${genesis_tx_id_cbor} tx_idx=${genesis_tx_idx_cbor} \033[0m"

aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_id_cbor}"
aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_idx_cbor}"
aiken blueprint convert -m genesis > contracts/genesis_contract.plutus

cardano-cli conway transaction policyid --script-file contracts/genesis_contract.plutus > hashes/genesis.hash
genesis_policy_id=$(cat hashes/genesis.hash)
echo -e "\033[1;37mGenesis Contract Hash: ${genesis_policy_id} \033[0m"

genesis_token_name=$(python3 -c "tkn='${genesis_tx_idx_cbor}' + '${genesis_tx_id}';print(tkn[0:64])")
echo -e "\033[1;37mGenesis Token Name: ${genesis_token_name} \033[0m"

genesis_pid_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_policy_id}'));print(encoded.hex())")
genesis_tkn_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_token_name}'));print(encoded.hex())")

echo -e "\033[1;36m\nBuilding Reference Contract \033[0m"
aiken blueprint apply -o plutus.json -m reference "${genesis_pid_cbor}"
aiken blueprint apply -o plutus.json -m reference "${genesis_tkn_cbor}"
aiken blueprint convert -m reference > contracts/reference_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/reference_contract.plutus > hashes/reference.hash
echo -e "\033[1;37m Reference Contract Hash: $(cat hashes/reference.hash) \033[0m"

echo -e "\033[1;36m\nBuilding Encryption Contract \033[0m"
aiken blueprint apply -o plutus.json -m encryption "${genesis_pid_cbor}"
aiken blueprint apply -o plutus.json -m encryption "${genesis_tkn_cbor}"
aiken blueprint convert -m encryption > contracts/encryption_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/encryption_contract.plutus > hashes/encryption.hash
echo -e "\033[1;37m Encryption Contract Hash: $(cat hashes/encryption.hash) \033[0m"

echo -e "\033[1;36m\nBuilding Bidding Contract \033[0m"
aiken blueprint apply -o plutus.json -m bidding "${genesis_pid_cbor}"
aiken blueprint apply -o plutus.json -m bidding "${genesis_tkn_cbor}"
aiken blueprint convert -m bidding > contracts/bidding_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/bidding_contract.plutus > hashes/bidding.hash
echo -e "\033[1;37m Bidding Contract Hash: $(cat hashes/bidding.hash) \033[0m"

echo -e "\033[1;36m\nBuilding Groth Contract \033[0m"
aiken blueprint apply -o plutus.json -m groth "${genesis_pid_cbor}"
aiken blueprint apply -o plutus.json -m groth "${genesis_tkn_cbor}"
aiken blueprint convert -m groth > contracts/groth_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/groth_contract.plutus > hashes/groth.hash
echo -e "\033[1;37m Groth Contract Hash: $(cat hashes/groth.hash) \033[0m"