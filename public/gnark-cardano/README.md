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

## After the Pipeline: What You Get

Once `./run` completes and tests pass, here's what you have and how to use it.

### For your prover (off-chain)

| Artifact | Location | What it's for |
|----------|----------|---------------|
| `go/snark` | Compiled binary | Generate proofs in production: `./snark prove -setup setup -out out -input secrets.json` |
| `go/setup/` | `ccs.bin`, `pk.bin`, `vk.bin` | Trusted setup keys. The prover needs all three. Distribute `pk.bin` to anyone who needs to generate proofs. |

The `-input` flag takes a JSON file with your circuit's secret and public values. The `--test` flag (used by `./scripts/prove`) uses hardcoded test values — in production you supply real ones.

### For your Aiken smart contract (on-chain)

| Artifact | Location | What it's for |
|----------|----------|---------------|
| `aiken/lib/gnark_cardano/groth.ak` | Verifier library | Copy into your Aiken project's `lib/` or add as a dependency. Provides `verify_groth16()` and `verify_commitments()`. |
| `data/vk-datum.json` | VK as Cardano datum | Store on-chain once as a reference input. This is your verifying key in Plutus datum format. |

In your Aiken validator, import and call:

```aiken
use gnark_cardano/groth

// In your validator's spend/withdraw handler:
groth.verify_groth16(snark_vk, proof, public_inputs, commitment_wires)
```

The types you'll use: `SnarkVerificationKey`, `GrothProof`, `GrothPublic`, `GrothCommitmentWire`, `CommitmentKey`.

### For transaction submission (runtime)

| Artifact | Location | What it's for |
|----------|----------|---------------|
| `data/vk-datum.json` | VK datum | Submit once to store the VK on-chain as a reference input |
| `python/` converters | `gnark_cardano` package | Convert each new proof to datum format before submitting a transaction |

Each time you generate a proof, convert it before submission:

```python
from gnark_cardano.groth_convert import convert_all

# After ./snark prove produces out/proof.json and out/public.json:
convert_all("out/proof.json", "out/public.json", "out/datums/")
# → groth-proof.json, groth-public.json, groth-commitment-wires.json
```

These datum files go into your transaction redeemer.

### For the MPC ceremony (production setup)

The single-party `./snark setup` is fine for development, but for production
you should run a multi-party ceremony so that no single machine ever knows
the toxic waste. The `go/snark` binary supports the full ceremony flow:

```bash
./snark ceremony init       -dir ceremony
./snark ceremony contribute -dir ceremony -phase 1   # each contributor runs this
./snark ceremony verify     -dir ceremony -phase 1   # anyone can verify
./snark ceremony finalize   -dir ceremony -phase 1 -beacon <hex>
# repeat for phase 2:
./snark ceremony contribute -dir ceremony -phase 2
./snark ceremony verify     -dir ceremony -phase 2
./snark ceremony finalize   -dir ceremony -phase 2 -beacon <hex> -out setup
```

The output goes to `setup/` in the same format as `./snark setup`, so the
rest of the pipeline (`./scripts/prove`, etc.) works unchanged.

See [CEREMONY.md](CEREMONY.md) for the full step-by-step guide, including
how to coordinate contributors, choose beacon values, and publish the
transcript.

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
