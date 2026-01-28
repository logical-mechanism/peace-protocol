#!/usr/bin/env bash

# Copyright (C) 2025 Logical Mechanism LLC
# SPDX-License-Identifier: GPL-3.0-only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
KEYS_DIR="${SCRIPT_DIR}/keys"
PID_FILE="${DATA_DIR}/node.pid"

# Parse arguments
KEEP_KEYS=false
for arg in "$@"; do
    case $arg in
        --keep-keys)
            KEEP_KEYS=true
            shift
            ;;
    esac
done

echo -e "\033[1;34m=== Stopping Local Cardano Testnet ===\033[0m"

# Check if PID file exists
if [ -f "${PID_FILE}" ]; then
    PID=$(cat "${PID_FILE}")

    # Check if process is running
    if kill -0 "${PID}" 2>/dev/null; then
        echo -e "\033[0;33mStopping cardano-node (PID: ${PID})...\033[0m"
        kill "${PID}"

        # Wait for graceful shutdown (max 30 seconds)
        TIMEOUT=30
        while kill -0 "${PID}" 2>/dev/null && [ ${TIMEOUT} -gt 0 ]; do
            sleep 1
            TIMEOUT=$((TIMEOUT - 1))
        done

        # Force kill if still running
        if kill -0 "${PID}" 2>/dev/null; then
            echo -e "\033[0;31mForce killing cardano-node...\033[0m"
            kill -9 "${PID}" 2>/dev/null || true
        fi

        echo -e "\033[0;32mNode stopped.\033[0m"
    else
        echo -e "\033[0;33mNode not running (stale PID file).\033[0m"
    fi
else
    echo -e "\033[0;33mNo PID file found. Node may not be running.\033[0m"
fi

# Clean up data directory
if [ -d "${DATA_DIR}" ]; then
    echo -e "\033[0;33mCleaning up data directory...\033[0m"
    rm -rf "${DATA_DIR}"
    echo -e "\033[0;32mData directory removed.\033[0m"
fi

# Clean up keys unless --keep-keys is specified
if [ "${KEEP_KEYS}" = false ]; then
    if [ -d "${KEYS_DIR}" ]; then
        echo -e "\033[0;33mCleaning up keys directory...\033[0m"
        rm -rf "${KEYS_DIR}"
        echo -e "\033[0;32mKeys directory removed.\033[0m"
    fi
else
    echo -e "\033[0;36mKeeping keys directory (--keep-keys specified).\033[0m"
fi

# Clean up generated genesis files in config
for genesis_file in "${SCRIPT_DIR}/config/byron-genesis.json" \
                    "${SCRIPT_DIR}/config/shelley-genesis.json" \
                    "${SCRIPT_DIR}/config/alonzo-genesis.json" \
                    "${SCRIPT_DIR}/config/conway-genesis.json" \
                    "${SCRIPT_DIR}/config/byron-genesis"; do
    if [ -e "${genesis_file}" ]; then
        rm -rf "${genesis_file}"
    fi
done

echo -e "\033[1;32m=== Cleanup Complete ===\033[0m"
