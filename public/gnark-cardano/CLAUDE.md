# gnark-cardano — Claude Instructions

This is a toolkit for getting gnark Groth16 proofs onto the Cardano blockchain using Aiken smart contracts. It handles the full pipeline from circuit definition to on-chain verification.

## Project Structure

```
proof.pattern    — User's proof specification (THE INPUT — read this first)
run              — Full pipeline script: build → prove → test
scripts/         — Individual pipeline steps
go/              — Go CLI: circuit compilation, proof generation, JSON export
aiken/           — Aiken on-chain Groth16 verifier (types + pairing check)
python/          — Python datum converters (gnark JSON → Cardano CLI format)
data/            — Generated: Cardano datum files for on-chain use
example/         — Worked example (peace-protocol's proof pattern)
```

## The Workflow

1. User writes `proof.pattern` describing what they want to prove
2. User prompts Claude: "Generate the circuit from proof.pattern"
3. Claude generates `go/circuit.go` + `go/circuit_test.go`
4. User runs `./run` (or the individual scripts below)

The `./run` script handles everything after circuit generation:
- `./scripts/build` — compile Go CLI + trusted setup
- `./scripts/prove` — generate proof, export JSON, convert to Cardano datums, generate circuit-specific Aiken test
- `./scripts/test` — run Aiken + Python tests

## Scripts

```bash
./scripts/check-deps    # verify go, aiken, python3, pytest are available
./scripts/build         # compile Go CLI + trusted setup → go/setup/
./scripts/prove         # prove + export + datums + generate aiken/lib/tests/circuit.ak
./scripts/test          # run aiken check + pytest
./scripts/lint          # go vet + aiken build + ruff
./run                   # all of the above in sequence
```

## Claude's Job

After the user writes `proof.pattern`, Claude generates TWO files:

1. **`go/circuit.go`** — the gnark circuit + `CircuitSetup()` and `CircuitProve()` functions
2. **`go/circuit_test.go`** — Go-level round-trip test (optional but recommended)

Everything else (build, export, datum conversion, Aiken test generation) is handled by the scripts.

## Reading proof.pattern

The proof.pattern file describes a zero-knowledge proof using this format:

```
Secret <Type> Inputs: (<name1>, <name2>, ...)    → circuit private witnesses
Public <Type> Inputs: (<name1>, <name2>, ...)    → circuit public witnesses
Constants:
    <name>  # description                        → hardcoded circuit values
compute: <name> = <expression>                    → in-circuit computation
check: <lhs> == <rhs>                            → equality assertion
```

**Types:** `Int` (Fr scalar), `G1` (BLS12-381 G1 point), `G2` (G2 point), `Fq12` (pairing result)

**Expressions:**
- `e(A, B)` → BLS12-381 pairing (A: G1, B: G2 → Fq12)
- `[scalar]point` → scalar multiplication
- `A + B` → point addition
- `H(x)` → hash function (always MiMC — see below)
- `q^a` → shorthand for `[a]q` (scalar mul of generator)
- `x * y` → field multiplication
- `x >= y` / `x <= y` → range comparison

**Comparisons:** `>=` and `<=` use `api.Cmp()` or bit decomposition. These are expensive in-circuit (many constraints) so use sparingly.

## Hashing: Always Use MiMC

**`H(x)` always means MiMC.** It's the only hash function that's both cheap in-circuit and native to gnark's BLS12-381 field. SHA256 works but costs ~25,000 constraints vs ~300 for MiMC.

When hashing different types, Claude handles the conversion automatically:

| Input to H() | What Claude generates |
|---|---|
| `H(int)` | Write the Fr element to MiMC, call `Sum()` |
| `H(int1, int2, ...)` | Write multiple Fr elements, call `Sum()` |
| `H(fq12_value)` | Decompose Fq12 to 12 Fp elements → convert each to Fr limbs → write all to MiMC → `Sum()`. This is the `Fq12ToFrElements` pattern — Claude generates the decomposition code automatically. |
| `H(g1_point)` | Decompose G1 coordinates to Fr limbs → write to MiMC → `Sum()` |

**The user never needs to know about `Fq12ToFrElements` or type decomposition.** Just write `H(k)` and Claude handles it based on `k`'s type from the `compute:` line above.

## Generating circuit.go from proof.pattern

Map the pattern to gnark circuit code:

### Type Mapping

| Pattern Type | gnark Circuit Field | gnark Assign Type |
|---|---|---|
| `Secret Int` | `A frontend.Variable` | `big.Int` |
| `Public Int` | `Y frontend.Variable \`gnark:",public"\`` | `big.Int` |
| `Public G1` | `V sw_bls12381.G1Affine \`gnark:",public"\`` | `bls12381.G1Affine` |
| `Secret G1` | `P sw_bls12381.G1Affine` | `bls12381.G1Affine` |
| `Public G2` | `H sw_bls12381.G2Affine \`gnark:",public"\`` | `bls12381.G2Affine` |

### Expression Mapping

| Pattern | gnark Code |
|---|---|
| `e(A, B)` | `pairing.Pair([]*sw_bls12381.G1Affine{&A}, []*sw_bls12381.G2Affine{&B})` |
| `[s]P` | `sw_bls12381.ScalarMulBase(api, s)` or `ScalarMul(api, P, s)` |
| `A + B` | `sw_bls12381.Add(api, A, B)` |
| `H(x)` | MiMC: `mimc.Write(x)` then `mimc.Sum()` — type-dependent decomposition as above |
| `x >= y` | `api.AssertIsLessOrEqual(y, x)` or bit decomposition |
| `check: a == b` | `api.AssertIsEqual(a, b)` or point equality assertion |

### G1 Public Inputs as Limbs

G1 points cannot be directly used as public inputs in gnark. They must be decomposed into coordinate limbs:

```go
// In circuit struct — 6 limbs per coordinate (X, Y)
VLimbs [12]frontend.Variable `gnark:",public"`

// In Define() — reconstruct the G1 point from limbs
V := sw_bls12381.G1Affine{
    X: fields_bls12381.E{Limbs: circuit.VLimbs[0:6]},
    Y: fields_bls12381.E{Limbs: circuit.VLimbs[6:12]},
}
```

### Commitment Extension (Pedersen)

If any secret inputs should be committed (for CCA security), use gnark's commitment API:

```go
// In circuit struct
A frontend.Variable `gnark:"a,secret"`  // committed secret

// In compile options
ccs, err := frontend.Compile(ecc.BLS12_381, r1cs.NewBuilder, &circuit,
    frontend.WithCommitment(commitment.Pedersen, "a"))
```

This adds commitment fields to the proof (D point + PoK) that the Aiken verifier checks.

## Aiken Test Generation

The `./scripts/prove` script automatically generates `aiken/lib/tests/circuit.ak` from the proof artifacts. Claude does NOT need to generate this file.

The existing `aiken/lib/tests/groth.ak` contains known-good hardcoded tests that validate the generic verifier. The generated `circuit.ak` tests the specific circuit you built.

**If you need to understand the test format** (e.g., for debugging), here's the mapping:
- `out/vk.json` hex strings → Aiken `#"..."` byte literals (direct copy)
- `out/public.json` `inputs[1:]` → public values list (skip leading "1")
- `out/public.json` `commitmentWire` → commitment wire integer
- gnark's `nPublic` includes the implicit witness[0]=1; the Aiken public values list does NOT include it

## Aiken Verifier Details

The generic verifier in `aiken/lib/gnark_cardano/groth.ak` performs:

**Main Groth16 check:**
```
e(A, B) * e(vk_x, -gamma) * e(C, -delta) == e(alpha, beta)
```
where `vk_x = IC[0] + sum(IC[i+1] * pub[i]) + sum(IC[nPublic+j] * wire[j]) + sum(D[k])`

**Commitment PoK check:**
```
e(D_sum, gSigmaNeg) * e(PoK, g) == 1
```

Both use Cardano's built-in BLS12-381 primitives (no stdlib imports needed beyond `aiken/builtin`).

## Python Converters

The Python package converts gnark's JSON output to Cardano CLI datum format:

- `vk_to_datum(vk_dict)` → SnarkVerificationKey datum
- `gnark_proof_to_aiken(proof_dict)` → GrothProof datum
- `gnark_public_to_aiken(public_dict)` → List<Int> datum
- `gnark_commitment_wires_to_aiken(public_dict)` → List<Int> datum
- `convert_all(proof_path, public_path, output_dir)` → writes all datum files

## Important gnark Quirks

1. **Implicit "1" wire:** gnark's public witness includes witness[0]=1 implicitly. The export code handles this via `ChoosePublicInputs()`. The Aiken verifier multiplies IC[0] by 1 (identity).

2. **Commitment wire:** When using Pedersen commitments, gnark computes `hash_to_field(D.Marshal() || committed_publics.Marshal())` as an additional public input. This must be passed separately to the Aiken verifier.

3. **IC length:** `len(vk.IC) = nPublic + nCommitments`. The first `nPublic` ICs correspond to regular public inputs, the remaining to commitment wires.

4. **Point compression:** All G1 points are 48-byte IETF compressed (96 hex chars). All G2 points are 96-byte IETF compressed (192 hex chars). gnark-crypto's `.Bytes()` method produces this format.

## License

Apache-2.0. This code is independent of any GPL-licensed project.
