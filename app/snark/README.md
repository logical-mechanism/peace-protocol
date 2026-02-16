# SNARK

Let's use GNARK to build a SNARK. 

Statement to prove:

```py
Secret Int Inputs: (a, r)
Public G1 Inputs: (v, w0, w1)
Constants:
    q   # G1 generator
    h0  # Fixed G2 Point

# k is a secret
compute: k = e(q^a, h0)

# hk is a secret
compute: hk = H(k)  # H can be whatever hash function works here

compute: p0 = [hk]q

compute: p1 = [a]q + [r]v

check: w0 == p0
check: w1 == p1
```

This SNARK combined with the binding proofs should be enough to make it CCA secure.

## Install GNARK

(GNARK GitHub)[https://github.com/Consensys/gnark]

(Getting Started)[https://docs.gnark.consensys.net/HowTo/get_started]

## Building

```bash
go mod tidy
go build -o snark
GOOS=js GOARCH=wasm go build -o prover.wasm .
```

## Testing

```bash
go test -v -count=1 -timeout=120m
```

## Setup Ceremony

The default `setup` command runs a single-party trusted setup suitable for testing. For production, use the MPC ceremony to distribute trust across multiple contributors. As long as at least one contributor is honest, the setup is secure.

### Workflow

```bash
# 1. Coordinator initializes the ceremony
./snark ceremony init -dir ceremony

# 2. Contributors add entropy to Phase 1 (Powers of Tau), one at a time (20-40 mins)
./snark ceremony contribute -dir ceremony -phase 1

# 3. Anyone can verify the Phase 1 contribution chain (15-30 mins)
./snark ceremony verify -dir ceremony -phase 1

# 4. Coordinator seals Phase 1 with a random beacon and initializes Phase 2 (45-75 mins)
./snark ceremony finalize -dir ceremony -phase 1 -beacon 40066bc169373272f9941d5d0d2af612a722f2db0707066bae24e4f571895ed9

# 5. Contributors add entropy to Phase 2 (1-3 mins)
./snark ceremony contribute -dir ceremony -phase 2

# 6. Verify the Phase 2 contribution chain (1-3 mins)
./snark ceremony verify -dir ceremony -phase 2

# 7. Coordinator seals Phase 2 and extracts the proving/verifying keys (30-60 mins)
./snark ceremony finalize -dir ceremony -phase 2 -beacon ca46b2c4e5aa84764d4d7893a2c7413d2f02f41167389a3f377634f15e93b996

# 8. Archive the ceremony
# Full archive for reproducibility (all contributions, ~2GB+)
tar -czf ceremony-full.tar.gz -C ceremony .
# Minimal archive for proving (just the keys needed to generate proofs)
tar -czf ceremony-keys.tar.gz -C ceremony ccs.bin pk.bin vk.bin vk.json
```

The `-beacon` value should be a publicly verifiable source of randomness committed to after all contributions are collected (e.g. a future block hash).

The ceremony directory contains sequentially numbered contribution files (`phase1_0000.bin`, `phase1_0001.bin`, ...) that form a verifiable chain. After finalization, `pk.bin`, `vk.bin`, and `vk.json` are written to the same directory.

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**