#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/config"
DATA_DIR="${SCRIPT_DIR}/data"
KEYS_DIR="${SCRIPT_DIR}/keys"
WALLETS_DIR="${SCRIPT_DIR}/../wallets"
PID_FILE="${DATA_DIR}/node.pid"
SOCKET_PATH="${DATA_DIR}/node.socket"

# Configuration
TESTNET_MAGIC=42
MAX_TX_SIZE=32768
SLOT_LENGTH=1.0
EPOCH_LENGTH=500
SECURITY_PARAM=432
INITIAL_FUNDS=100000000000  # 100,000 ADA per wallet in lovelace

echo -e "\033[1;34m=== Starting Local Cardano Testnet ===\033[0m"
echo -e "\033[0;36mTestnet Magic: ${TESTNET_MAGIC}\033[0m"
echo -e "\033[0;36mMax TX Size: ${MAX_TX_SIZE} bytes\033[0m"

# Check if already running
if [ -f "${PID_FILE}" ]; then
    PID=$(cat "${PID_FILE}")
    if kill -0 "${PID}" 2>/dev/null; then
        echo -e "\033[0;31mError: Node is already running (PID: ${PID})\033[0m"
        echo -e "\033[0;33mRun ./stop.sh first to stop the existing node.\033[0m"
        exit 1
    fi
fi

# Check dependencies
for cmd in cardano-node cardano-cli jq; do
    if ! command -v ${cmd} &> /dev/null; then
        echo -e "\033[0;31mError: ${cmd} not found on PATH\033[0m"
        exit 1
    fi
done

echo -e "\033[0;32mUsing cardano-node: $(cardano-node --version | head -1)\033[0m"
echo -e "\033[0;32mUsing cardano-cli: $(cardano-cli --version | head -1)\033[0m"

# Clean any stale data
if [ -d "${DATA_DIR}" ]; then
    echo -e "\033[0;33mCleaning stale data directory...\033[0m"
    rm -rf "${DATA_DIR}"
fi

# Create directories
echo -e "\033[0;33mCreating directories...\033[0m"
mkdir -p "${DATA_DIR}/db"
mkdir -p "${KEYS_DIR}/genesis"
mkdir -p "${KEYS_DIR}/delegate"
mkdir -p "${KEYS_DIR}/utxo"

# Generate start time (now + 30 seconds to allow setup)
START_TIME=$(date -u -d "+30 seconds" +"%Y-%m-%dT%H:%M:%SZ")
echo -e "\033[0;36mGenesis start time: ${START_TIME}\033[0m"

# ============================================================================
# Generate Keys
# ============================================================================
echo -e "\033[1;33m\n=== Generating Keys ===\033[0m"

# Generate genesis keys (need at least 1 for block production)
echo -e "\033[0;33mGenerating genesis keys...\033[0m"
cardano-cli latest genesis key-gen-genesis \
    --verification-key-file "${KEYS_DIR}/genesis/genesis.vkey" \
    --signing-key-file "${KEYS_DIR}/genesis/genesis.skey"

# Generate stake pool cold keys (required by node issue-op-cert)
echo -e "\033[0;33mGenerating delegate/cold keys...\033[0m"
cardano-cli latest node key-gen \
    --cold-verification-key-file "${KEYS_DIR}/delegate/delegate.vkey" \
    --cold-signing-key-file "${KEYS_DIR}/delegate/delegate.skey" \
    --operational-certificate-issue-counter-file "${KEYS_DIR}/delegate/delegate.counter"

# Generate VRF keys
echo -e "\033[0;33mGenerating VRF keys...\033[0m"
cardano-cli latest node key-gen-VRF \
    --verification-key-file "${KEYS_DIR}/delegate/vrf.vkey" \
    --signing-key-file "${KEYS_DIR}/delegate/vrf.skey"

# Generate KES keys
echo -e "\033[0;33mGenerating KES keys...\033[0m"
cardano-cli latest node key-gen-KES \
    --verification-key-file "${KEYS_DIR}/delegate/kes.vkey" \
    --signing-key-file "${KEYS_DIR}/delegate/kes.skey"

# Generate stake keys (for pool owner/reward account)
echo -e "\033[0;33mGenerating stake keys...\033[0m"
cardano-cli latest stake-address key-gen \
    --verification-key-file "${KEYS_DIR}/delegate/stake.vkey" \
    --signing-key-file "${KEYS_DIR}/delegate/stake.skey"

# Generate UTXO keys (for initial funds distribution)
echo -e "\033[0;33mGenerating UTXO keys...\033[0m"
cardano-cli latest genesis key-gen-utxo \
    --verification-key-file "${KEYS_DIR}/utxo/utxo.vkey" \
    --signing-key-file "${KEYS_DIR}/utxo/utxo.skey"

# ============================================================================
# Collect wallet addresses for initial funds
# ============================================================================
echo -e "\033[1;33m\n=== Collecting Wallet Addresses ===\033[0m"

WALLET_ADDRESSES=""
for wallet in alice bob holder collat genesis; do
    WALLET_PATH="${WALLETS_DIR}/${wallet}"
    if [ -f "${WALLET_PATH}/payment.addr" ]; then
        ADDR=$(cat "${WALLET_PATH}/payment.addr")
        # Convert bech32 address to hex using cardano-cli
        ADDR_HEX=$(cardano-cli latest address info --address "${ADDR}" | jq -r '.base16')
        echo -e "\033[0;36m${wallet}: ${ADDR} -> ${ADDR_HEX}\033[0m"
        WALLET_ADDRESSES="${WALLET_ADDRESSES} ${wallet}:${ADDR_HEX}"
    else
        echo -e "\033[0;33mWarning: ${wallet} wallet not found at ${WALLET_PATH}\033[0m"
    fi
done

# ============================================================================
# Create Genesis Files
# ============================================================================
echo -e "\033[1;33m\n=== Creating Genesis Files ===\033[0m"

# Get key hashes
GENESIS_VKEY_HASH=$(cardano-cli latest genesis key-hash --verification-key-file "${KEYS_DIR}/genesis/genesis.vkey")
# For stake pool cold keys, use stake-pool id to get the correct hash
DELEGATE_VKEY_HASH=$(cardano-cli latest stake-pool id --cold-verification-key-file "${KEYS_DIR}/delegate/delegate.vkey" --output-format hex)
VRF_VKEY_HASH=$(cardano-cli latest node key-hash-VRF --verification-key-file "${KEYS_DIR}/delegate/vrf.vkey")
# Stake key hash for pool owner/reward account
STAKE_VKEY_HASH=$(cardano-cli latest stake-address key-hash --stake-verification-key-file "${KEYS_DIR}/delegate/stake.vkey")

echo -e "\033[0;36mGenesis key hash: ${GENESIS_VKEY_HASH}\033[0m"
echo -e "\033[0;36mDelegate key hash (pool id): ${DELEGATE_VKEY_HASH}\033[0m"
echo -e "\033[0;36mStake key hash: ${STAKE_VKEY_HASH}\033[0m"

# Debug: show the key types
# ----------------------------------------------------------------------------
# Create Byron Genesis
# ----------------------------------------------------------------------------
echo -e "\033[0;33mCreating Byron genesis...\033[0m"

# Create a temporary directory for Byron genesis generation
BYRON_GENESIS_DIR="${CONFIG_DIR}/byron-genesis"
rm -rf "${BYRON_GENESIS_DIR}"  # Clean up any previous run

cardano-cli byron genesis genesis \
    --protocol-magic ${TESTNET_MAGIC} \
    --start-time $(date -u -d "${START_TIME}" +%s) \
    --k ${SECURITY_PARAM} \
    --n-poor-addresses 0 \
    --n-delegate-addresses 1 \
    --total-balance 0 \
    --delegate-share 0 \
    --avvm-entry-count 0 \
    --avvm-entry-balance 0 \
    --protocol-parameters-file "${SCRIPT_DIR}/templates/byron-protocol-params.json" \
    --genesis-output-dir "${BYRON_GENESIS_DIR}"

# Move the genesis file
mv "${BYRON_GENESIS_DIR}/genesis.json" "${CONFIG_DIR}/byron-genesis.json"

# ----------------------------------------------------------------------------
# Create Shelley Genesis
# ----------------------------------------------------------------------------
echo -e "\033[0;33mCreating Shelley genesis...\033[0m"

# Create a staked address for the pool (combines UTXO payment key + pool stake key)
# This gives the pool stake for block production leadership
echo -e "\033[0;33mCreating staked address for pool...\033[0m"
POOL_STAKED_ADDR=$(cardano-cli latest address build \
    --payment-verification-key-file "${KEYS_DIR}/utxo/utxo.vkey" \
    --stake-verification-key-file "${KEYS_DIR}/delegate/stake.vkey" \
    --testnet-magic ${TESTNET_MAGIC})
POOL_STAKED_ADDR_HEX=$(cardano-cli latest address info --address "${POOL_STAKED_ADDR}" | jq -r '.base16')
echo -e "\033[0;36mPool staked address: ${POOL_STAKED_ADDR}\033[0m"

# Build initial funds JSON for wallets
INITIAL_FUNDS_JSON="{"
FIRST=true
for wallet_entry in ${WALLET_ADDRESSES}; do
    WALLET_NAME=$(echo ${wallet_entry} | cut -d: -f1)
    WALLET_ADDR=$(echo ${wallet_entry} | cut -d: -f2)

    if [ "${FIRST}" = true ]; then
        FIRST=false
    else
        INITIAL_FUNDS_JSON="${INITIAL_FUNDS_JSON},"
    fi
    INITIAL_FUNDS_JSON="${INITIAL_FUNDS_JSON}\"${WALLET_ADDR}\": ${INITIAL_FUNDS}"
done

# Add the pool's staked address with a large amount for stake
POOL_STAKE_AMOUNT=30000000000000000  # 30 billion ADA to ensure pool has majority stake
INITIAL_FUNDS_JSON="${INITIAL_FUNDS_JSON},\"${POOL_STAKED_ADDR_HEX}\": ${POOL_STAKE_AMOUNT}}"

# Create Shelley genesis with custom maxTxSize
cat > "${CONFIG_DIR}/shelley-genesis.json" << EOF
{
  "activeSlotsCoeff": 1.0,
  "epochLength": ${EPOCH_LENGTH},
  "genDelegs": {
    "${GENESIS_VKEY_HASH}": {
      "delegate": "${DELEGATE_VKEY_HASH}",
      "vrf": "${VRF_VKEY_HASH}"
    }
  },
  "initialFunds": ${INITIAL_FUNDS_JSON},
  "maxKESEvolutions": 62,
  "maxLovelaceSupply": 45000000000000000,
  "networkId": "Testnet",
  "networkMagic": ${TESTNET_MAGIC},
  "protocolParams": {
    "protocolVersion": { "major": 10, "minor": 0 },
    "decentralisationParam": 1,
    "eMax": 18,
    "extraEntropy": { "tag": "NeutralNonce" },
    "maxBlockBodySize": 90112,
    "maxBlockHeaderSize": 1100,
    "maxTxSize": ${MAX_TX_SIZE},
    "minFeeA": 44,
    "minFeeB": 155381,
    "minPoolCost": 340000000,
    "minUTxOValue": 1000000,
    "nOpt": 150,
    "poolDeposit": 500000000,
    "keyDeposit": 2000000,
    "a0": 0.3,
    "rho": 0.003,
    "tau": 0.2
  },
  "securityParam": ${SECURITY_PARAM},
  "slotLength": ${SLOT_LENGTH},
  "slotsPerKESPeriod": 129600,
  "staking": {
    "pools": {
      "${DELEGATE_VKEY_HASH}": {
        "cost": 340000000,
        "margin": 0,
        "metadata": null,
        "owners": ["${STAKE_VKEY_HASH}"],
        "pledge": 0,
        "publicKey": "${DELEGATE_VKEY_HASH}",
        "relays": [],
        "rewardAccount": {
          "credential": {
            "keyHash": "${STAKE_VKEY_HASH}"
          },
          "network": "Testnet"
        },
        "vrf": "${VRF_VKEY_HASH}"
      }
    },
    "stake": {
      "${STAKE_VKEY_HASH}": "${DELEGATE_VKEY_HASH}"
    }
  },
  "systemStart": "${START_TIME}",
  "updateQuorum": 1
}
EOF

# ----------------------------------------------------------------------------
# Create Alonzo Genesis (Plutus cost models)
# ----------------------------------------------------------------------------
echo -e "\033[0;33mCreating Alonzo genesis...\033[0m"

cat > "${CONFIG_DIR}/alonzo-genesis.json" << 'EOF'
{
  "lovelacePerUTxOWord": 34482,
  "executionPrices": {
    "prSteps": { "numerator": 721, "denominator": 10000000 },
    "prMem": { "numerator": 577, "denominator": 10000 }
  },
  "maxTxExUnits": { "exUnitsMem": 14000000, "exUnitsSteps": 10000000000 },
  "maxBlockExUnits": { "exUnitsMem": 62000000, "exUnitsSteps": 20000000000 },
  "maxValueSize": 5000,
  "collateralPercentage": 150,
  "maxCollateralInputs": 3,
  "costModels": {
    "PlutusV1": [205665,812,1,1,1000,571,0,1,1000,24177,4,1,1000,32,117366,10475,4,23000,100,23000,100,23000,100,23000,100,23000,100,23000,100,100,100,23000,100,19537,32,175354,32,46417,4,221973,511,0,1,89141,32,497525,14068,4,2,196500,453240,220,0,1,1,1000,28662,4,2,245000,216773,62,1,1060367,12586,1,208512,421,1,187000,1000,52998,1,80436,32,43249,32,1000,32,80556,1,57667,4,1000,10,197145,156,1,197145,156,1,204924,473,1,208896,511,1,52467,32,64832,32,65493,32,22558,32,16563,32,76511,32,196500,453240,220,0,1,1,69522,11687,0,1,60091,32,196500,453240,220,0,1,1,196500,453240,220,0,1,1,1159724,392670,0,2,806990,30482,4,1927926,82523,4,265318,0,4,0,85931,32,205665,812,1,1,41182,32,212342,32,31220,32,32696,32,43357,32,32247,32,38314,32,20000000000,20000000000],
    "PlutusV2": [205665,812,1,1,1000,571,0,1,1000,24177,4,1,1000,32,117366,10475,4,23000,100,23000,100,23000,100,23000,100,23000,100,23000,100,100,100,23000,100,19537,32,175354,32,46417,4,221973,511,0,1,89141,32,497525,14068,4,2,196500,453240,220,0,1,1,1000,28662,4,2,245000,216773,62,1,1060367,12586,1,208512,421,1,187000,1000,52998,1,80436,32,43249,32,1000,32,80556,1,57667,4,1000,10,197145,156,1,197145,156,1,204924,473,1,208896,511,1,52467,32,64832,32,65493,32,22558,32,16563,32,76511,32,196500,453240,220,0,1,1,69522,11687,0,1,60091,32,196500,453240,220,0,1,1,196500,453240,220,0,1,1,1159724,392670,0,2,806990,30482,4,1927926,82523,4,265318,0,4,0,85931,32,205665,812,1,1,41182,32,212342,32,31220,32,32696,32,43357,32,32247,32,38314,32,35892428,10,57996947,18975,10,38887044,32947,10,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807,9223372036854775807]
  }
}
EOF

# ----------------------------------------------------------------------------
# Create Conway Genesis (Governance)
# ----------------------------------------------------------------------------
echo -e "\033[0;33mCreating Conway genesis...\033[0m"

cat > "${CONFIG_DIR}/conway-genesis.json" << 'EOF'
{
  "poolVotingThresholds": {
    "committeeNormal": 0.51,
    "committeeNoConfidence": 0.51,
    "hardForkInitiation": 0.51,
    "motionNoConfidence": 0.51,
    "ppSecurityGroup": 0.51
  },
  "dRepVotingThresholds": {
    "motionNoConfidence": 0.67,
    "committeeNormal": 0.67,
    "committeeNoConfidence": 0.6,
    "updateToConstitution": 0.75,
    "hardForkInitiation": 0.6,
    "ppNetworkGroup": 0.67,
    "ppEconomicGroup": 0.67,
    "ppTechnicalGroup": 0.67,
    "ppGovGroup": 0.75,
    "treasuryWithdrawal": 0.67
  },
  "committeeMinSize": 0,
  "committeeMaxTermLength": 146,
  "govActionLifetime": 6,
  "govActionDeposit": 100000000000,
  "dRepDeposit": 2000000,
  "dRepActivity": 20,
  "minFeeRefScriptCostPerByte": 15,
  "plutusV3CostModel": [100788,420,1,1,1000,173,0,1,1000,59957,4,1,11183,32,201305,8356,4,16000,100,16000,100,16000,100,16000,100,16000,100,16000,100,100,100,16000,100,94375,32,132994,32,61462,4,72010,178,0,1,22151,32,91189,769,4,2,85848,123203,7305,-900,1716,549,57,85848,0,1,1,1000,42921,4,2,24548,29498,38,1,898148,27279,1,51775,558,1,39184,1000,60594,1,141895,32,83150,32,15299,32,76049,1,13169,4,22100,10,28999,74,1,28999,74,1,43285,552,1,44749,541,1,33852,32,68246,32,72362,32,7243,32,7391,32,11546,32,85848,123203,7305,-900,1716,549,57,85848,0,1,90434,519,0,1,74433,32,85848,123203,7305,-900,1716,549,57,85848,0,1,1,85848,123203,7305,-900,1716,549,57,85848,0,1,955506,213312,0,2,270652,22588,4,1457325,64566,4,20467,1,4,0,141992,32,100788,420,1,1,81663,32,59498,32,20142,32,24588,32,20744,32,25933,32,24623,32,43053543,10,53384111,14333,10,43574283,26308,10,16000,100,16000,100,962335,18,2780678,6,442008,1,52538055,3756,18,267929,18,76433006,8868,18,52948122,18,1995836,36,3227919,12,901022,1,166917843,4307,36,284546,36,158221314,26549,36,74698472,36,333849714,1,254006273,72,2174038,72,2261318,64571,4,207616,8310,4,1293828,28716,63,0,1,1006041,43623,251,0,1,100181,726,719,0,1,100181,726,719,0,1,100181,726,719,0,1,107878,680,0,1,95336,1,281145,18848,0,1,180194,159,1,1,158519,8942,0,1,159378,8813,0,1,107490,3298,1,106057,655,1,1964219,24520,3],
  "constitution": {
    "anchor": {
      "dataHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "url": ""
    },
    "script": null
  },
  "committee": {
    "members": {},
    "threshold": { "numerator": 0, "denominator": 1 }
  }
}
EOF

# ============================================================================
# Generate Operational Certificate
# ============================================================================
echo -e "\033[1;33m\n=== Generating Operational Certificate ===\033[0m"

cardano-cli latest node issue-op-cert \
    --kes-verification-key-file "${KEYS_DIR}/delegate/kes.vkey" \
    --cold-signing-key-file "${KEYS_DIR}/delegate/delegate.skey" \
    --operational-certificate-issue-counter-file "${KEYS_DIR}/delegate/delegate.counter" \
    --kes-period 0 \
    --out-file "${KEYS_DIR}/delegate/node.opcert"

# ============================================================================
# Start the Node
# ============================================================================
echo -e "\033[1;33m\n=== Starting Cardano Node ===\033[0m"

cardano-node run \
    --config "${CONFIG_DIR}/node-config.json" \
    --topology "${CONFIG_DIR}/topology.json" \
    --database-path "${DATA_DIR}/db" \
    --socket-path "${SOCKET_PATH}" \
    --shelley-kes-key "${KEYS_DIR}/delegate/kes.skey" \
    --shelley-vrf-key "${KEYS_DIR}/delegate/vrf.skey" \
    --shelley-operational-certificate "${KEYS_DIR}/delegate/node.opcert" \
    --port 3001 \
    +RTS -N -RTS \
    > "${DATA_DIR}/node.log" 2>&1 &

NODE_PID=$!
echo "${NODE_PID}" > "${PID_FILE}"

echo -e "\033[0;32mNode started with PID: ${NODE_PID}\033[0m"
echo -e "\033[0;36mLog file: ${DATA_DIR}/node.log\033[0m"

# ============================================================================
# Wait for Socket
# ============================================================================
echo -e "\033[0;33m\nWaiting for node socket to be available...\033[0m"

WAIT_TIMEOUT=120
WAIT_COUNT=0
while [ ! -S "${SOCKET_PATH}" ] && [ ${WAIT_COUNT} -lt ${WAIT_TIMEOUT} ]; do
    # Check if node is still running
    if ! kill -0 "${NODE_PID}" 2>/dev/null; then
        echo -e "\033[0;31mError: Node process died unexpectedly\033[0m"
        echo -e "\033[0;33mCheck logs at: ${DATA_DIR}/node.log\033[0m"
        tail -50 "${DATA_DIR}/node.log"
        exit 1
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $((WAIT_COUNT % 10)) -eq 0 ]; then
        echo -e "\033[0;33mStill waiting... (${WAIT_COUNT}s)\033[0m"
    fi
done

if [ ! -S "${SOCKET_PATH}" ]; then
    echo -e "\033[0;31mError: Socket not available after ${WAIT_TIMEOUT} seconds\033[0m"
    echo -e "\033[0;33mCheck logs at: ${DATA_DIR}/node.log\033[0m"
    exit 1
fi

echo -e "\033[0;32mSocket is available!\033[0m"

# Wait a bit more for the node to sync
sleep 5

# ============================================================================
# Display Connection Info
# ============================================================================
echo -e "\033[1;32m\n=== Local Testnet Ready ===\033[0m"
echo ""
echo -e "\033[1;36mConnection Details:\033[0m"
echo -e "  Socket Path: ${SOCKET_PATH}"
echo -e "  Testnet Magic: ${TESTNET_MAGIC}"
echo -e "  Max TX Size: ${MAX_TX_SIZE} bytes"
echo ""
echo -e "\033[1;36mTo use with existing commands:\033[0m"
echo -e "  export CARDANO_NODE_SOCKET_PATH=\"${SOCKET_PATH}\""
echo -e "  # Modify .env: network=\"--testnet-magic ${TESTNET_MAGIC}\""
echo ""
echo -e "\033[1;36mQuery tip:\033[0m"
echo -e "  cardano-cli latest query tip --testnet-magic ${TESTNET_MAGIC}"
echo ""

# Try to query tip
export CARDANO_NODE_SOCKET_PATH="${SOCKET_PATH}"
echo -e "\033[0;33mCurrent tip:\033[0m"
cardano-cli latest query tip --testnet-magic ${TESTNET_MAGIC} 2>/dev/null || echo "(Node still syncing...)"

# ============================================================================
# Update config.json with genesis UTXO
# ============================================================================
echo -e "\033[1;33m\n=== Updating config.json with Genesis UTXO ===\033[0m"

CONFIG_JSON_FILE="${SCRIPT_DIR}/../config.json"
GENESIS_WALLET_ADDR=$(cat "${WALLETS_DIR}/genesis/payment.addr")

# Query the genesis wallet UTXOs
UTXO_OUTPUT=$(cardano-cli latest query utxo --address "${GENESIS_WALLET_ADDR}" --testnet-magic ${TESTNET_MAGIC} --out-file /dev/stdout 2>/dev/null)

if [ -n "${UTXO_OUTPUT}" ] && [ "${UTXO_OUTPUT}" != "{}" ]; then
    # Get the first UTXO key (format: "txhash#index")
    FIRST_UTXO_KEY=$(echo "${UTXO_OUTPUT}" | jq -r 'keys[0]')

    if [ -n "${FIRST_UTXO_KEY}" ] && [ "${FIRST_UTXO_KEY}" != "null" ]; then
        # Split into tx_id and tx_idx
        GENESIS_TX_ID=$(echo "${FIRST_UTXO_KEY}" | cut -d'#' -f1)
        GENESIS_TX_IDX=$(echo "${FIRST_UTXO_KEY}" | cut -d'#' -f2)

        echo -e "\033[0;36mGenesis UTXO: ${GENESIS_TX_ID}#${GENESIS_TX_IDX}\033[0m"

        # Update config.json
        jq --arg tx_id "${GENESIS_TX_ID}" \
           --argjson tx_idx "${GENESIS_TX_IDX}" \
           '.genesis_tx_id = $tx_id | .genesis_tx_idx = $tx_idx' \
           "${CONFIG_JSON_FILE}" > "${CONFIG_JSON_FILE}.tmp" && \
           mv "${CONFIG_JSON_FILE}.tmp" "${CONFIG_JSON_FILE}"

        echo -e "\033[0;32mUpdated config.json with genesis UTXO\033[0m"
    else
        echo -e "\033[0;33mWarning: Could not parse UTXO key\033[0m"
    fi
else
    echo -e "\033[0;33mWarning: No UTXOs found at genesis wallet yet\033[0m"
fi

echo ""
echo -e "\033[1;32mDone! Node is running in the background.\033[0m"
echo -e "\033[0;33mRun ./stop.sh to stop the node and clean up.\033[0m"
