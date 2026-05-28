#!/usr/bin/env bash

# Copyright (C) 2025-2026 Logical Mechanism LLC
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

# mainnet: no traces; local/preprod: full traces
if [ "${NETWORK}" = "mainnet" ]; then
    aiken build --trace-level silent --trace-filter user-defined
else
    aiken build --trace-level verbose --trace-filter all
fi

# Bootstrap order (post-M-01):
#   1. Read genesis (tx_id, tx_idx) from config and validate tx_idx range.
#   2. Build reference.ak first — it is parameterised by the same
#      (tx_id, tx_idx) so its hash is computable without knowing the
#      genesis policy_id. This breaks the bootstrap cycle introduced when
#      genesis.ak gained a reference_hash parameter.
#   3. Build genesis.ak with (tx_id, tx_idx, reference_hash).
#   4. Compute the genesis token name off-chain using the SAME bytewise
#      construction as lib/util.construct_token_name (`bytearray.push(idx)`
#      then truncate to 31 bytes). This replaces the older CBOR-encoded
#      tx_idx concatenation, which diverged from the on-chain semantic
#      whenever tx_idx >= 24 (CBOR major-type-0 emits two bytes there).
#   5. Build encryption / bidding / groth with (genesis_pid, genesis_tkn).
echo -e "\033[1;36m\nReading Genesis Bootstrap Parameters\033[0m"
genesis_tx_id=$(jq -r '.genesis_tx_id' ${CONFIG_JSON})
genesis_tx_idx=$(jq -r '.genesis_tx_idx' ${CONFIG_JSON})

# I-08: assert tx_idx fits in a single byte. The on-chain
# util.construct_token_name uses `bytearray.push(idx)`, which Plutus V3
# rejects for idx outside [0, 255]. Asserting here matches the on-chain
# constraint and keeps the off-chain token-name builder in lockstep.
python3 -c "idx=${genesis_tx_idx}; assert 0 <= idx <= 255, f'genesis_tx_idx must be in [0, 255], got {idx}'"

genesis_tx_id_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_tx_id}'));print(encoded.hex())")
genesis_tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${genesis_tx_idx});print(encoded.hex())")

echo -e "\033[1;33mGenesis UTxO: ${genesis_tx_id}#${genesis_tx_idx} \033[0m"
echo -e "\033[1;33mGenesis CBOR: tx_id=${genesis_tx_id_cbor} tx_idx=${genesis_tx_idx_cbor} \033[0m"

# I-08 fix: build the token name by mirroring `bytearray.push(idx)`
# byte-for-byte instead of relying on CBOR encoding of tx_idx, which
# silently expands to 2 bytes for tx_idx in [24, 255].
genesis_token_name=$(python3 -c "
idx = ${genesis_tx_idx}
tx_id_hex = '${genesis_tx_id}'
assert 0 <= idx <= 255
tkn = bytes([idx]).hex() + tx_id_hex
print(tkn[:64])
")
echo -e "\033[1;37mGenesis Token Name: ${genesis_token_name} \033[0m"
genesis_tkn_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_token_name}'));print(encoded.hex())")

echo -e "\033[1;36m\nBuilding Reference Contract \033[0m"
# Reference takes the same (tx_id, tx_idx) as genesis (M-01 / bootstrap
# cycle break). Build it BEFORE genesis so we can thread its hash into
# the genesis policy.
aiken blueprint apply -o plutus.json -m reference "${genesis_tx_id_cbor}"
aiken blueprint apply -o plutus.json -m reference "${genesis_tx_idx_cbor}"
aiken blueprint convert -m reference > contracts/reference_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/reference_contract.plutus > hashes/reference.hash
reference_hash=$(cat hashes/reference.hash)
echo -e "\033[1;37m Reference Contract Hash: ${reference_hash} \033[0m"
reference_hash_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${reference_hash}'));print(encoded.hex())")

echo -e "\033[1;36m\nBuilding Genesis Contract\033[0m"
# M-01: thread reference_hash as the third parameter so the genesis
# policy can on-chain verify ReferenceDatum.reference == reference_hash.
aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_id_cbor}"
aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_idx_cbor}"
aiken blueprint apply -o plutus.json -m genesis "${reference_hash_cbor}"
aiken blueprint convert -m genesis > contracts/genesis_contract.plutus

cardano-cli conway transaction policyid --script-file contracts/genesis_contract.plutus > hashes/genesis.hash
genesis_policy_id=$(cat hashes/genesis.hash)
echo -e "\033[1;37mGenesis Contract Hash: ${genesis_policy_id} \033[0m"

genesis_pid_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_policy_id}'));print(encoded.hex())")

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
