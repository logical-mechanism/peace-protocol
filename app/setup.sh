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

source .env

mkdir -p wallets

###############################################################################
# Build contracts
###############################################################################
cd contracts

# remove all traces for production
# aiken build --trace-level silent --trace-filter user-defined

# keep all traces for development
aiken build --trace-level verbose --trace-filter all

./compile.sh

cd ..

###############################################################################
# Wallet Creation
###############################################################################

# create alice
folder=wallets/alice
mkdir -p ${folder}

if [ ! -f ${folder}/payment.skey ]; then
    ${cli} address key-gen --verification-key-file ${folder}/payment.vkey --signing-key-file ${folder}/payment.skey
    ${cli} address build --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.addr ${network}
    ${cli} address key-hash --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.hash
fi
echo -e "\033[1;33m\nAlice: $(cat ${folder}/payment.hash) \033[0m"


# create bob
folder=wallets/bob
mkdir -p ${folder}

if [ ! -f ${folder}/payment.skey ]; then
    ${cli} address key-gen --verification-key-file ${folder}/payment.vkey --signing-key-file ${folder}/payment.skey
    ${cli} address build --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.addr ${network}
    ${cli} address key-hash --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.hash
fi
echo -e "\033[1;33mBob: $(cat ${folder}/payment.hash) \033[0m"

# create collat
folder=wallets/collat
mkdir -p ${folder}

if [ ! -f ${folder}/payment.skey ]; then
    ${cli} address key-gen --verification-key-file ${folder}/payment.vkey --signing-key-file ${folder}/payment.skey
    ${cli} address build --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.addr ${network}
    ${cli} address key-hash --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.hash
fi
echo -e "\033[1;33mCollateral: $(cat ${folder}/payment.hash) \033[0m"

# create reference
folder=wallets/reference
mkdir -p ${folder}

if [ ! -f ${folder}/payment.skey ]; then
    ${cli} address key-gen --verification-key-file ${folder}/payment.vkey --signing-key-file ${folder}/payment.skey
    ${cli} address build --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.addr ${network}
    ${cli} address key-hash --payment-verification-key-file ${folder}/payment.vkey --out-file ${folder}/payment.hash
fi
echo -e "\033[1;33mReference: $(cat ${folder}/payment.hash) \033[0m"