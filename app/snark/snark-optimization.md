# SNARK Memory Optimization Plan

## Problem Statement

The gnark SNARK prover works correctly but exceeds WASM32's 4GB memory limit. The binary prover uses ~2+ GiB during proving. Go doesn't compile to WASM64, so we need to reduce memory overhead while maintaining functionality.

**Important Note:** Tests take ~4 minutes per setup/prover call. Future work should account for this.

---

## Results Summary

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Constraint count | 1,603,057 | 1,084,616 | 518,441 (32%) |

---

## Completed Optimizations

### ✅ Step 2: Replace SHA256 with MiMC (Completed)

**Files Modified:** `kappa.go`, `main_test.go`

Replaced SHA256 with MiMC for the kappa→hk hash path. MiMC is a SNARK-friendly hash function that requires ~1 constraint per field element vs ~25,000+ constraints for SHA256.

**Changes Made:**

1. **New imports in kappa.go:**
   - Added `github.com/consensys/gnark-crypto/ecc/bls12-381/fr/mimc` (out-of-circuit)
   - Added `stdmimc "github.com/consensys/gnark/std/hash/mimc"` (in-circuit)
   - Kept `crypto/sha256` and `sha2` for `wFromHKCircuit` which still uses SHA256

2. **New out-of-circuit helpers:**
   - `fq12ToFrElements()` - Converts GT element's 12 Fp coefficients to Fr elements
   - `domainTagFr()` - Returns domain tag as Fr element for MiMC input
   - `mimcHashFr()` - Hashes Fr elements using MiMC
   - `mimcHex()` - Returns MiMC hash as hex string

3. **New in-circuit helpers:**
   - `fq12ToNativeFrElements()` - Converts in-circuit GTEl to native Fr elements for MiMC
   - `hashToFrMiMC()` - In-circuit MiMC returning emulated Fr

4. **Updated functions:**
   - `gtToHash()` - Uses MiMC instead of SHA256
   - `hkScalarFromA()` - Uses MiMC instead of SHA256
   - `gtToHashFromGT()` - Uses MiMC instead of SHA256
   - `vw0w1Circuit.Define()` - Uses MiMC for in-circuit hashing

5. **Test updates:**
   - Added MiMC import to `main_test.go`
   - Updated `TestGTToHash_DeterministicAndMatchesManual` to verify MiMC
   - Updated `TestHKScalarFromA_ConsistentWithDigestReduction` to use MiMC

### ✅ Removed Unnecessary On-Curve Assertions

**Prerequisite:** The contract validates all points are on-curve before passing to the prover.

Removed 5 expensive `AssertIsOnG1`/`AssertIsOnG2` calls:

1. **Public input assertions (3):**
   - `g1.AssertIsOnCurve(&v)` - for V point
   - `g1.AssertIsOnCurve(&w0)` - for W0 point
   - `g1.AssertIsOnCurve(&w1)` - for W1 point

2. **Pairing input assertions (2):**
   - `g1.AssertIsOnCurve(&qa)` - for Qa point (already validated by scalar multiplication)
   - `g2.AssertIsOnCurve(&h0)` - for H0 point (constant, always valid)

**Note:** This optimization is safe because:
- V, W0, W1 come from the contract which validates them
- Qa is derived from scalar multiplication of the generator (always on-curve)
- H0 is a hardcoded constant

---

## Pending Optimizations

### Step 1: GOGC/GOMEMLIMIT Tuning

**Status:** Not yet implemented

**File:** `wasm_main.go`

Add Go runtime memory controls to reduce peak heap usage.

```go
func init() {
    debug.SetGCPercent(50)
    debug.SetMemoryLimit(3 << 30)
}
```

**Expected Impact:** 10-25% memory reduction, low risk.

---

## Current Memory Profile

| Component | Size/Usage |
|-----------|------------|
| Proving Key (pk.bin) | 613 MiB |
| Constraint System (ccs.bin) | 85 MiB |
| prover.wasm | ~20 MiB |
| Peak memory during prove | TBD (needs re-measurement) |
| Constraint count | 1,084,616 |

**Root Cause:** In-circuit BLS12-381 pairing alone costs ~1 million constraints. This is the dominant factor and is unavoidable without protocol changes.

---

## Verification Checklist

- [x] `go build` succeeds
- [x] `go test -v ./...` passes (after setup regeneration)
- [x] New pk.bin/vk.bin/ccs.bin generated
- [x] prover.wasm builds
- [ ] WASM proving works in browser
- [ ] Memory usage reduced (measure with browser dev tools)

---

## Architecture Notes

### Hash Flow (After MiMC Migration)

**Out-of-circuit flow:**
```
kappa (GT element)
  → fq12ToFrElements() → 12 Fr elements
  → append domainTagFr() → 13 Fr elements
  → mimcHashFr() → single Fr element
  → interpret as scalar
```

**In-circuit flow:**
```
kappa (GTEl)
  → fq12ToNativeFrElements() → 12 native Fr elements
  → append domainTag as native Fr
  → hashToFrMiMC() → emulated Fr element
```

### wFromHKCircuit (Unchanged)

The `wFromHKCircuit` still uses SHA256 for hashing compressed W points. This is a separate circuit and was not part of the MiMC migration.

---

## Summary

| Strategy | Constraint/Memory Reduction | Status |
|----------|----------------------------|--------|
| **MiMC hash** | **~390,000 constraints** | ✅ Complete |
| **Remove on-curve assertions** | **~128,000 constraints** | ✅ Complete |
| GOGC tuning | 10-25% memory | Pending |
| **Total** | **518,441 constraints (32%)** | |

**Note:** The pairing operation (~1M constraints) is unavoidable without protocol changes. Further constraint reduction would require gnark API changes or fundamental protocol modifications.
