#!/usr/bin/env bash
set -e

echo -e "\033[1;36m\nRequirements Check\n\033[0m"

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

# set up the python env
echo -e "\033[1;36m\nPython Env Setup\n\033[0m"
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

source .env

###############################################################################
# Build contracts
###############################################################################
echo -e "\033[1;36m\nContract Building\n\033[0m"

cd contracts

# remove all traces for production
# aiken build --trace-level silent --trace-filter user-defined

# keep all traces for development
aiken build --trace-level verbose --trace-filter all

./compile.sh

cd ..

###############################################################################
# Data Initialization
###############################################################################

echo -e "\033[1;36m\nData Initialization \033[0m"

jq \
--arg ref_hash "$(cat contracts/hashes/reference.hash)" \
--arg enc_hash "$(cat contracts/hashes/encryption.hash)" \
--arg bid_hash "$(cat contracts/hashes/bidding.hash)" \
'.fields[0].bytes=$ref_hash |
.fields[1].bytes=$enc_hash |
.fields[2].bytes=$bid_hash' \
./data/reference/reference-datum.json | sponge ./data/reference/reference-datum.json

reference_hash=$(${cli} conway transaction hash-script-data --script-data-file ./data/reference/reference-datum.json)

echo -e "\033[1;33m\nReference Datum Hash: ${reference_hash} \033[0m"

###############################################################################

echo -e "\033[1;32m\nBuilding Complete! \033[0m"