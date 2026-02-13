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

**Copyright (C) 2025 Logical Mechanism LLC**

**SPDX-License-Identifier: CC-BY-4.0**