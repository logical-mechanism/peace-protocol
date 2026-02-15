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

# 2. Contributors add entropy to Phase 1 (Powers of Tau), one at a time
./snark ceremony contribute -dir ceremony -phase 1
./snark ceremony contribute -dir ceremony -phase 1

# 3. Anyone can verify the Phase 1 contribution chain
./snark ceremony verify -dir ceremony -phase 1

# 4. Coordinator seals Phase 1 with a random beacon and initializes Phase 2
./snark ceremony finalize -dir ceremony -phase 1 -beacon <hex>

# 5. Contributors add entropy to Phase 2 (circuit-specific)
./snark ceremony contribute -dir ceremony -phase 2

# 6. Verify the Phase 2 contribution chain
./snark ceremony verify -dir ceremony -phase 2

# 7. Coordinator seals Phase 2 and extracts the proving/verifying keys
./snark ceremony finalize -dir ceremony -phase 2 -beacon <hex>

# 8. Use the ceremony keys for proving (same as setup-produced keys)
./snark prove -setup ceremony -a <secret> -r <secret> -v <hex> -w0 <hex> -w1 <hex> -out proof
```

The `-beacon` value should be a publicly verifiable source of randomness committed to after all contributions are collected (e.g. a future block hash).

The ceremony directory contains sequentially numbered contribution files (`phase1_0000.bin`, `phase1_0001.bin`, ...) that form a verifiable chain. After finalization, `pk.bin`, `vk.bin`, and `vk.json` are written to the same directory.

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**