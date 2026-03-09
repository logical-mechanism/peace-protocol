#!/usr/bin/env bash
# Prerequisite checks for Veiled Desktop development.
# Source this from run.sh or build.sh:
#   source "$(dirname "$0")/check-prereqs.sh"
#   check_prerequisites

check_prerequisites() {
  local errors=0

  # Check Node.js
  if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js is not installed. Install from https://nodejs.org/ (v20+ recommended)"
    errors=$((errors + 1))
  else
    local node_major
    node_major=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_major" -lt 20 ]]; then
      echo "WARNING: Node.js $(node -v) detected. v20+ recommended."
    fi
  fi

  # Check npm
  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm is not installed."
    errors=$((errors + 1))
  fi

  # Check Rust toolchain
  if ! command -v cargo &>/dev/null; then
    echo "ERROR: Rust/Cargo is not installed. Install from https://rustup.rs/"
    errors=$((errors + 1))
  fi

  if ! command -v rustc &>/dev/null; then
    echo "ERROR: rustc is not installed. Run: rustup install stable"
    errors=$((errors + 1))
  fi

  # Check sidecar binaries
  local binaries_dir="src-tauri/binaries"
  local required_binaries=(
    "cardano-node"
    "ogmios"
    "kupo"
    "mithril-client"
    "snark"
    "cardano-cli"
  )

  if [[ ! -d "$binaries_dir" ]]; then
    echo "ERROR: Sidecar binaries directory not found: $binaries_dir"
    echo "       These platform-specific binaries (~600MB) are not in git."
    echo "       Contact the team for binary distribution instructions."
    errors=$((errors + 1))
  else
    for bin in "${required_binaries[@]}"; do
      local found
      found=$(find "$binaries_dir" -name "${bin}-*" -type f 2>/dev/null | head -1)
      if [[ -z "$found" ]]; then
        echo "ERROR: Missing sidecar binary: $bin (expected in $binaries_dir/${bin}-<triple>)"
        errors=$((errors + 1))
      elif [[ ! -x "$found" ]]; then
        echo "WARNING: Sidecar binary is not executable: $found"
        echo "         Run: chmod +x $found"
      fi
    done
  fi

  # Check WebKitGTK (Linux only)
  if [[ "$(uname)" == "Linux" ]]; then
    if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
      echo "WARNING: webkit2gtk-4.1 dev headers not found."
      echo "         Install: sudo apt-get install libwebkit2gtk-4.1-dev"
    fi
  fi

  if [[ "$errors" -gt 0 ]]; then
    echo ""
    echo "Found $errors prerequisite error(s). Fix the above issues and try again."
    exit 1
  fi

  echo "All prerequisites satisfied."
}
