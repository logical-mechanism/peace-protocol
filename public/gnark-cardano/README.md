# gnark-cardano

A toolkit for verifying [gnark](https://github.com/Consensys/gnark) Groth16 proofs on the Cardano blockchain using [Aiken](https://aiken-lang.org) smart contracts.

## What This Does

gnark is a Go framework for building zero-knowledge proofs. Cardano has built-in BLS12-381 cryptographic primitives. This toolkit bridges the two:

1. **Go CLI** — Exports gnark Groth16 proofs, verifying keys, and public inputs to a JSON format compatible with Cardano
2. **Aiken Verifier** — Generic on-chain Groth16 verification using Cardano's native BLS12-381 builtins
3. **Python Converters** — Transforms gnark JSON output into Cardano CLI datum format

Supports gnark's Pedersen commitment extension (proof-of-knowledge check) out of the box.

## Quick Start

```bash
# 1. Check you have go, aiken, python3, pytest
./scripts/check-deps

# 2. Write your proof specification
vim proof.pattern

# 3. Prompt Claude:
#    "Generate the circuit from proof.pattern"

# 4. Run the full pipeline
./run
```

That's it. `./run` handles: build → setup → prove → export → datum conversion → Aiken test generation → test.

## The Pipeline

```
./scripts/check-deps                              # 1. verify go, aiken, python3
vim proof.pattern                                  # 2. write your proof spec
"Generate the circuit from proof.pattern"          # 3. prompt Claude
./run                                              # 4. everything else
```

`./run` executes these scripts in order:

| Script | What it does |
|--------|-------------|
| `scripts/check-deps` | Verifies go, aiken, python3, venv are on PATH |
| `scripts/build` | Creates python venv, installs deps, compiles Go CLI, runs trusted setup |
| `scripts/prove` | Generates test proof, exports JSON, converts to Cardano datums in `data/`, generates `aiken/lib/tests/circuit.ak` |
| `scripts/test` | Runs `aiken check` + `pytest` |

Each script is also runnable on its own. `scripts/lint` (go vet, aiken build, ruff) is available separately.

## What proof.pattern Looks Like

```
Secret Int Inputs: (x)
Public Int Inputs: (y)
compute: result = x * x
check: y == result
```

See `example/proof.pattern` for a real-world example using BLS12-381 pairings.

## Project Structure

```
proof.pattern              — Your proof specification (the input)
run                        — Full pipeline: build → prove → test
scripts/
  check-deps               — Verify go, aiken, python3, pytest are available
  build                    — Compile Go CLI + trusted setup
  prove                    — Generate proof, export JSON, convert datums, gen Aiken test
  test                     — Run Aiken + Python tests
  lint                     — Format/type checks
go/
  circuit.go               — Generated: gnark circuit from proof.pattern
  main.go                  — CLI: setup, prove, verify, re-export
  export.go                — Generic: proof/VK/public → JSON
  commitment.go            — Generic: commitment wire computation
  helpers.go               — Generic: BLS12-381 point compression
  types.go                 — Generic: JSON shape definitions
  serialize.go             — Generic: binary save/load
  orchestrate.go           — Generic: ExportAll, ExportVKOnly, ReExportJSON
aiken/
  lib/gnark_cardano/
    groth.ak               — Generic Groth16 verifier (types + pairing checks)
  lib/tests/
    groth.ak               — Known-good tests (hardcoded proof data)
    circuit.ak             — Generated: your circuit's test (from ./scripts/prove)
python/
  gnark_cardano/
    vk_convert.py           — VK JSON → Cardano datum
    groth_convert.py        — Proof/public JSON → Cardano datum
  tests/                    — Converter tests
data/                       — Generated: Cardano datum files for on-chain use
example/
  proof.pattern             — Worked example (from the peace-protocol project)
CLAUDE.md                   — Instructions for Claude to generate circuits
```

## On-Chain Verification

The Aiken verifier performs two checks:

**Groth16 pairing check:**
```
e(A, B) * e(vk_x, -gamma) * e(C, -delta) == e(alpha, beta)
```

**Commitment PoK check** (when using Pedersen commitments):
```
e(D_sum, gSigmaNeg) * e(PoK, g) == 1
```

Both use Cardano's built-in BLS12-381 primitives with no external dependencies beyond `aiken-lang/stdlib`.

## Requirements

- **Go** >= 1.21 with gnark v0.14.0
- **Aiken** v1.1.21 (Plutus v3)
- **Python** >= 3.11 with pytest (for converters)

Check with: `./scripts/check-deps`

## License

Apache-2.0 — see [LICENSE](LICENSE)
