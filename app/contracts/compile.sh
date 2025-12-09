#!/usr/bin/env bash
set -e

if command -v jq &> /dev/null; then
    echo -e "\033[1;35m jq is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m jq is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m sudo apt install -y jq \033[0m"
    exit 1;
fi

if command -v python3 &> /dev/null; then
    echo -e "\033[1;35m python3 is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m python3 is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m sudo apt install -y python3 \033[0m"
    exit 1;
fi

if python3 -c "import cbor2" 2>/dev/null; then
    echo -e "\033[1;35m cbor2 is installed and available for python3. \033[0m"
else
    echo -e "\033[1;31m cbor2 is not installed or not available for python3. \033[0m"
    echo -e "\033[1;33m sudo apt-get install python3-cbor2 \033[0m"
    exit 1;
fi

if command -v sponge &> /dev/null; then
    echo -e "\033[1;35m sponge is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m sponge is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m sudo apt-get install more-utils \033[0m"
    exit 1;
fi

if command -v aiken &> /dev/null; then
    echo -e "\033[1;35m aiken is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m aiken is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m https://github.com/aiken-lang/aiken \033[0m"
    exit 1;
fi

if command -v cardano-cli &> /dev/null; then
    echo -e "\033[1;35m cardano-cli is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m cardano-cli is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m https://github.com/IntersectMBO/cardano-cli \033[0m"
    exit 1;
fi

if command -v sha256sum &> /dev/null; then
    echo -e "\033[1;35m sha256sum is installed and available on the PATH. \033[0m"
else
    echo -e "\033[1;31m sha256sum is not installed or not available on the PATH. \033[0m"
    echo -e "\033[1;33m sudo apt install coreutils \033[0m"
    exit 1;
fi

# create directories if dont exist
mkdir -p contracts
mkdir -p hashes

# remove old files
rm contracts/* || true
rm hashes/* || true
rm -fr build/ || true

###############################################################################

# remove all traces for production
# aiken build --trace-level silent --trace-filter user-defined

# keep all traces for development
aiken build --trace-level verbose --trace-filter all

###############################################################################

genesis_tx_id=$(jq -r '.genesis_tx_id' config.json)
genesis_tx_idx=$(jq -r '.genesis_tx_idx' config.json)
genesis_tx_id_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_tx_id}'));print(encoded.hex())")
genesis_tx_idx_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(${genesis_tx_idx});print(encoded.hex())")
echo -e "\033[1;33m\nGenesis UTxO: ${genesis_tx_id}#${genesis_tx_idx} \033[0m"
echo -e "\033[1;33mGenesis CBOR: tx_id=${genesis_tx_id_cbor} tx_idx=${genesis_tx_idx_cbor} \033[0m"
echo -e "\033[1;36m\nBuilding Genesis Contract \033[0m"
aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_id_cbor}"
aiken blueprint apply -o plutus.json -m genesis "${genesis_tx_idx_cbor}"
aiken blueprint convert -m genesis > contracts/genesis_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/genesis_contract.plutus > hashes/genesis.hash
echo -e "\033[1;37mGenesis Contract Hash: $(cat hashes/genesis.hash) \033[0m"

genesis_policy_id=$(cat hashes/genesis.hash)
genesis_token_name=$(python3 -c "tkn='${genesis_tx_idx_cbor}' + '${genesis_tx_id}';print(tkn[0:64])")
echo -e "\033[1;33m\nGenesis Token Name: ${genesis_token_name} \033[0m"

# we will need these to prove uniqueness in the other contracts
genesis_pid_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_policy_id}'));print(encoded.hex())")
genesis_tkn_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${genesis_token_name}'));print(encoded.hex())")

echo -e "\033[1;36m\nBuilding Reference Contract \033[0m"
aiken blueprint apply -o plutus.json -m reference "${genesis_pid_cbor}"
aiken blueprint apply -o plutus.json -m reference "${genesis_tkn_cbor}"
aiken blueprint convert -m reference > contracts/reference_contract.plutus
cardano-cli conway transaction policyid --script-file contracts/reference_contract.plutus > hashes/reference.hash
echo -e "\033[1;37m Reference Contract Hash: $(cat hashes/reference.hash) \033[0m"

# the reference contract hash
reference_hash=$(cat hashes/reference.hash)
reference_hash_cbor=$(python3 -c "import cbor2;encoded=cbor2.dumps(bytes.fromhex('${reference_hash}'));print(encoded.hex())")


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