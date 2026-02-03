# SNARK Memory Optimization Plan

## Problem Statement

The gnark SNARK prover works correctly but exceeds WASM32's 4GB memory limit. The binary prover uses ~2+ GiB during proving. Go doesn't compile to WASM64, so we need to reduce memory overhead while maintaining functionality.

**Important Note:** Tests take ~4 minutes per setup/prover call. Future work should account for this.

---

## Current Memory Profile

| Component | Size/Usage |
|-----------|------------|
| Proving Key (pk.bin) | 613 MiB |
| Constraint System (ccs.bin) | 85 MiB |
| prover.wasm | ~20 MiB |
| Peak memory during prove | 2+ GiB |
| Constraint count | 1-2 million |

**Root Cause:** In-circuit BLS12-381 pairing alone costs ~2 million constraints. Combined with SHA256 hashing of ~600 bytes and scalar multiplications, this creates the large memory footprint.

---

## Step 1: GOGC/GOMEMLIMIT Tuning

**File:** `wasm_main.go`

Add Go runtime memory controls to reduce peak heap usage.

### Subtasks

#### 1.1 Read current wasm_main.go imports
- Open `wasm_main.go`
- Note the existing imports (lines 14-28)

#### 1.2 Add runtime/debug import
- Add `"runtime/debug"` to the import block
- Place it alphabetically with other standard library imports

#### 1.3 Add init() function
- Add after the import block, before line 30
- Insert this code:

```go
func init() {
    debug.SetGCPercent(50)
    debug.SetMemoryLimit(3 << 30)
}
```

#### 1.4 Verify build compiles
- Run: `cd snark && go build -o /dev/null .`
- Ensure no compilation errors

#### 1.5 Rebuild WASM
- Run: `GOOS=js GOARCH=wasm go build -o prover.wasm .`
- Verify prover.wasm is created

### Expected Result
- `wasm_main.go` has new init() function
- WASM builds successfully
- No functional changes to proving logic

---

## Step 2: Replace SHA256 with MiMC (Primary Solution)

**Files:** `kappa.go`, `main_test.go`

Replace all SHA256 usage with MiMC for ~85-95% hash constraint reduction.

### Understanding the Current Architecture

**Out-of-circuit flow:**
```
kappa (GT element)
  → fq12CanonicalBytes() → 576 bytes (12 Fp × 48 bytes each)
  → append domainTagBytes (14 bytes)
  → sha256.Sum256() → 32 bytes
  → interpret as Fr scalar
```

**In-circuit flow:**
```
kappa (GTEl)
  → fq12CanonicalBytesInCircuit() → 576 uints.U8
  → append domainTag as uints.U8
  → hashToFrSha256() → emulated Fr element
```

**New MiMC flow (both):**
```
kappa (GT/GTEl)
  → extract 12 Fp coefficients
  → convert each Fp to Fr element (mod r)
  → append domainTag as Fr element
  → MiMC hash → single Fr element
```

### Subtasks

#### 2.1 Update imports in kappa.go

**Remove:**
```go
"crypto/sha256"                              // line 8
"github.com/consensys/gnark/std/hash/sha2"   // line 26
```

**Add:**
```go
"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/mimc"  // out-of-circuit MiMC
"github.com/consensys/gnark/std/hash/mimc"                 // in-circuit MiMC
```

#### 2.2 Create out-of-circuit fq12ToFrElements() helper

**Location:** After `fq12CanonicalBytes()` (around line 110)

**Purpose:** Convert GT element's 12 Fp coefficients to Fr elements for MiMC input.

```go
// fq12ToFrElements extracts the 12 Fp coefficients from a GT element
// and converts each to an Fr element (reduced mod r).
// This is the MiMC-compatible representation of the pairing output.
func fq12ToFrElements(k bls12381.GT) []fr.Element {
    elements := make([]fr.Element, 0, 13) // 12 coefficients + domain tag

    appendFpAsFr := func(e fp.Element) {
        var bi big.Int
        e.ToBigIntRegular(&bi)
        var frEl fr.Element
        frEl.SetBigInt(&bi) // automatically reduces mod r
        elements = append(elements, frEl)
    }

    // Same order as fq12CanonicalBytes for consistency
    appendFpAsFr(k.C0.B0.A0)
    appendFpAsFr(k.C0.B0.A1)
    appendFpAsFr(k.C0.B1.A0)
    appendFpAsFr(k.C0.B1.A1)
    appendFpAsFr(k.C0.B2.A0)
    appendFpAsFr(k.C0.B2.A1)
    appendFpAsFr(k.C1.B0.A0)
    appendFpAsFr(k.C1.B0.A1)
    appendFpAsFr(k.C1.B1.A0)
    appendFpAsFr(k.C1.B1.A1)
    appendFpAsFr(k.C1.B2.A0)
    appendFpAsFr(k.C1.B2.A1)

    return elements
}
```

#### 2.3 Create domainTagFr() helper

**Location:** Near other domain tag helpers

```go
// domainTagFr returns the domain tag as an Fr element for MiMC hashing.
func domainTagFr() fr.Element {
    tagBytes, _ := hex.DecodeString(DomainTagHex)
    var tag fr.Element
    tag.SetBytes(tagBytes)
    return tag
}
```

#### 2.4 Create out-of-circuit mimcHashFr() function

**Location:** Replace `sha256Hex()` (line 112-114)

```go
// mimcHashFr hashes a slice of Fr elements using MiMC and returns the result.
func mimcHashFr(elements []fr.Element) fr.Element {
    h := mimc.NewMiMC()
    for _, e := range elements {
        h.Write(e.Marshal())
    }
    var result fr.Element
    result.SetBytes(h.Sum(nil))
    return result
}

// mimcHex hashes Fr elements and returns the result as lowercase hex.
func mimcHex(elements []fr.Element) string {
    result := mimcHashFr(elements)
    return hex.EncodeToString(result.Marshal())
}
```

#### 2.5 Update gtToHash() function

**Location:** lines 125-154

**Current signature:** `func gtToHash(a *big.Int) (hkHex string, kappaEncHex string, err error)`

**Changes:**
- Replace `fq12CanonicalBytes()` with `fq12ToFrElements()`
- Replace `sha256.Sum256()` with `mimcHashFr()`
- Update return value format (MiMC output is 32 bytes, not 32 bytes)

```go
func gtToHash(a *big.Int) (hkHex string, kappaEncHex string, err error) {
    if a == nil || a.Sign() == 0 {
        return "", "", fmt.Errorf("a must be > 0")
    }

    h0, err := parseG2CompressedHex(H0Hex)
    if err != nil {
        return "", "", err
    }

    qa := g1MulBase(a)

    kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
    if err != nil {
        return "", "", fmt.Errorf("pairing: %w", err)
    }

    // Convert kappa to Fr elements for MiMC
    elements := fq12ToFrElements(kappa)
    elements = append(elements, domainTagFr())

    // Hash with MiMC
    hk := mimcHashFr(elements)

    // For kappaEncHex, still use the byte encoding for compatibility
    enc := fq12CanonicalBytes(kappa)

    return hex.EncodeToString(hk.Marshal()), hex.EncodeToString(enc), nil
}
```

#### 2.6 Update hkScalarFromA() function

**Location:** lines 159-193

**Changes:** Same pattern as gtToHash but returns the Fr element as big.Int

```go
func hkScalarFromA(a *big.Int) (*big.Int, error) {
    if a == nil || a.Sign() == 0 {
        return nil, fmt.Errorf("a must be > 0")
    }

    h0, err := parseG2CompressedHex(H0Hex)
    if err != nil {
        return nil, err
    }

    qa := g1MulBase(a)
    kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
    if err != nil {
        return nil, fmt.Errorf("pairing: %w", err)
    }

    elements := fq12ToFrElements(kappa)
    elements = append(elements, domainTagFr())

    hk := mimcHashFr(elements)

    var bi big.Int
    hk.BigInt(&bi)
    return &bi, nil
}
```

#### 2.7 Update gtToHashFromGT() function

**Location:** lines 365-377

```go
func gtToHashFromGT(k bls12381.GT) (string, error) {
    elements := fq12ToFrElements(k)
    elements = append(elements, domainTagFr())

    hk := mimcHashFr(elements)
    return hex.EncodeToString(hk.Marshal()), nil
}
```

#### 2.8 Create in-circuit fq12ToFrElementsInCircuit() helper

**Location:** Replace or modify `fq12CanonicalBytesInCircuit()` (lines 493-510)

**Purpose:** Convert in-circuit GTEl to frontend.Variable slice for MiMC

```go
// fq12ToFrElementsInCircuit extracts the 12 Fp coefficients from an in-circuit
// GT element and returns them as frontend.Variable for MiMC hashing.
func fq12ToFrElementsInCircuit(api frontend.API, k *sw_bls12381.GTEl) ([]frontend.Variable, error) {
    ext12 := fields_bls12381.NewExt12(api)
    tower := ext12.ToTower(k) // [12]*baseEl

    elements := make([]frontend.Variable, 0, 13) // 12 coeffs + domain tag

    frField, err := emulated.NewField[emparams.BLS12381Fr](api)
    if err != nil {
        return nil, err
    }

    for i := 0; i < 12; i++ {
        // tower[i] is an Fp element, reduce to Fr
        // The limbs of the Fp element can be reconstructed and reduced mod r
        reduced := frField.Reduce(tower[i])
        elements = append(elements, reduced.Limbs...)
    }

    return elements, nil
}
```

**Note:** This is the trickiest part. The exact implementation depends on how gnark's emulated fields expose their limbs. May need to use `frField.FromBits()` or similar. Test carefully.

#### 2.9 Create in-circuit hashToFrMiMC() function

**Location:** Replace `hashToFrSha256()` (lines 514-549)

```go
// hashToFrMiMC hashes field elements using MiMC and returns an emulated Fr.
func hashToFrMiMC(api frontend.API, elements []frontend.Variable) (emulated.Element[emparams.BLS12381Fr], error) {
    h, err := mimc.NewMiMC(api)
    if err != nil {
        return emulated.Element[emparams.BLS12381Fr]{}, err
    }

    h.Write(elements...)
    digest := h.Sum()

    // Convert MiMC output (native field element) to emulated Fr
    frField, err := emulated.NewField[emparams.BLS12381Fr](api)
    if err != nil {
        return emulated.Element[emparams.BLS12381Fr]{}, err
    }

    // MiMC output is already a field element, wrap it
    hk := frField.FromBits(api.ToBinary(digest, 256)...)
    hk = frField.Reduce(hk)

    return *hk, nil
}
```

**Note:** The exact conversion from MiMC output to emulated Fr needs care. MiMC in gnark outputs a native field element. You may need to handle the field mismatch (native vs emulated).

#### 2.10 Update vw0w1Circuit.Define() to use MiMC

**Location:** lines 593-616 in the Define() method

**Current code:**
```go
kappaBytes, err := fq12CanonicalBytesInCircuit(api, kappa)
// ... build msg ...
hk, err := hashToFrSha256(api, msg)
```

**New code:**
```go
// Convert kappa to field elements for MiMC
kappaElements, err := fq12ToFrElementsInCircuit(api, kappa)
if err != nil {
    return fmt.Errorf("kappa to elements: %w", err)
}

// Add domain tag as field element
tagBytes, _ := hex.DecodeString(DomainTagHex)
var tagBigInt big.Int
tagBigInt.SetBytes(tagBytes)
tagElement := api.Constant(&tagBigInt)
kappaElements = append(kappaElements, tagElement)

// Hash with MiMC
hk, err := hashToFrMiMC(api, kappaElements)
if err != nil {
    return fmt.Errorf("hashToFrMiMC: %w", err)
}
```

#### 2.11 Update wFromHKCircuit.Define() if used

**Location:** lines 250-278

Check if this circuit is still in use. If so, update similarly to use MiMC.

#### 2.12 Update test helpers in main_test.go

**Location:** lines 8, 204, 522

- Remove `"crypto/sha256"` import
- Update any test that manually computes SHA256 to use MiMC
- Example at line 204:
```go
// Old:
d := sha256.Sum256(rawW)

// New: convert rawW to Fr elements and use mimcHashFr
```

#### 2.13 Run tests to verify correctness

```bash
cd snark
go test -v -run TestGTToHash ./...
```

**Expected:** Tests may fail initially because hash outputs changed. This is expected - the circuit semantics changed.

#### 2.14 Regenerate trusted setup

```bash
cd snark
./snark setup
```

**Time:** ~4 minutes

This generates new `ccs.bin`, `pk.bin`, `vk.bin` files.

#### 2.15 Run full test suite

```bash
cd snark
go test -v ./...
```

**Time:** ~8-12 minutes (multiple prove operations)

All tests should pass with the new MiMC-based hashing.

#### 2.16 Rebuild WASM

```bash
cd snark
GOOS=js GOARCH=wasm go build -o prover.wasm .
```

#### 2.17 Test WASM in browser

- Load the new prover.wasm
- Load new pk.bin and ccs.bin
- Run a proof generation
- Verify it completes without OOM

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `wasm_main.go` | Add `runtime/debug` import, add `init()` with GC tuning |
| `kappa.go` | Replace sha256→mimc imports, add helpers, update 6 functions |
| `main_test.go` | Update test helpers to use MiMC |

---

## Verification Checklist

- [ ] `go build` succeeds
- [ ] `go test -v ./...` passes (after setup regeneration)
- [ ] New pk.bin/vk.bin/ccs.bin generated
- [ ] prover.wasm builds
- [ ] WASM proving works in browser
- [ ] Memory usage reduced (measure with browser dev tools)

---

## Potential Issues & Solutions

### Issue: Emulated field conversion complexity
The in-circuit `fq12ToFrElementsInCircuit()` may be complex due to field element representation differences.

**Solution:** If direct conversion is too complex, consider:
1. Keep the byte-based representation but use MiMC on bytes (less optimal but simpler)
2. Consult gnark documentation on emulated field interop

### Issue: MiMC output is native field, need emulated Fr
gnark's in-circuit MiMC outputs a native field element, but you need an emulated BLS12-381 Fr.

**Solution:** Use `api.ToBinary()` to get bits, then `frField.FromBits()` to construct emulated Fr.

### Issue: Domain tag representation
The domain tag bytes need to become a field element consistently.

**Solution:** Use `fr.Element.SetBytes()` out-of-circuit and `api.Constant()` in-circuit.

---

## Summary

| Strategy | Constraint/Memory Reduction | Risk | Effort |
|----------|----------------------------|------|--------|
| GOGC tuning | 10-25% memory | Low | 1 hour |
| **MiMC hash** | **85-95% hash constraints (~150k-250k fewer)** | Low-Medium | 1-2 days |

**Note:** MiMC is the highest-impact change. The pairing (~2M constraints) is unavoidable, but removing ~200k hash constraints is significant.
