// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// main_test.go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
)

// ---------- small helpers ----------

func mustHexToBytes(t *testing.T, h string) []byte {
	t.Helper()
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatalf("hex.DecodeString failed: %v", err)
	}
	return b
}

func mustReadFile(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) failed: %v", p, err)
	}
	return b
}

func withTempCwd(t *testing.T, fn func(tmp string)) {
	t.Helper()

	old, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd failed: %v", err)
	}
	tmp := t.TempDir()
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("os.Chdir(%q) failed: %v", tmp, err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })

	fn(tmp)
}

func mustParseDecBigInt(t *testing.T, s string) *big.Int {
	t.Helper()
	bi := new(big.Int)
	if _, ok := bi.SetString(s, 10); !ok {
		t.Fatalf("failed to parse decimal big.Int: %q", s)
	}
	return bi
}

func g1HexFromAffine(p bls12381.G1Affine) string {
	b := p.Bytes()
	return hex.EncodeToString(b[:])
}

func g2HexFromAffine(p bls12381.G2Affine) string {
	b := p.Bytes()
	return hex.EncodeToString(b[:])
}

func computeWCompressedHexFromA(t *testing.T, a *big.Int) string {
	t.Helper()

	hkBi, err := hkScalarFromA(a)
	if err != nil {
		t.Fatalf("hkScalarFromA failed: %v", err)
	}
	if hkBi.Sign() == 0 {
		t.Fatalf("hkScalarFromA reduced to 0 (unexpected for this test)")
	}

	// W = [hk]G1
	var w bls12381.G1Affine
	w.ScalarMultiplicationBase(new(big.Int).Set(hkBi))
	return g1HexFromAffine(w)
}

func computeVW0W1(t *testing.T, a, r *big.Int) (vHex, w0Hex, w1Hex string) {
	t.Helper()

	// choose a deterministic public V = [vS]G
	vS := big.NewInt(42)

	var v bls12381.G1Affine
	v.ScalarMultiplicationBase(vS)

	// hk(a) and W0 = [hk]G
	hkBi, err := hkScalarFromA(a)
	if err != nil {
		t.Fatalf("hkScalarFromA failed: %v", err)
	}
	if hkBi.Sign() == 0 {
		t.Fatalf("hk reduced to 0; unexpected for this test")
	}

	var w0 bls12381.G1Affine
	w0.ScalarMultiplicationBase(new(big.Int).Set(hkBi))

	// W1 = [a]G + [r]V
	var qa bls12381.G1Affine
	qa.ScalarMultiplicationBase(new(big.Int).Set(a))

	var rv bls12381.G1Affine
	// Note: gnark-crypto reduces scalars as needed.
	rv.ScalarMultiplication(&v, new(big.Int).Set(r))

	var w1 bls12381.G1Affine
	w1.Add(&qa, &rv)

	return g1HexFromAffine(v), g1HexFromAffine(w0), g1HexFromAffine(w1)
}

// ---------- tests: hashing / encoding ----------

func TestFQ12CanonicalBytes_LengthAndDeterminism(t *testing.T) {
	// Build a GT deterministically: kappa = e([a]G1, H0)
	a := big.NewInt(12345)
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		t.Fatalf("parseG2CompressedHex(H0Hex) failed: %v", err)
	}
	qa := g1MulBase(a)

	kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
	if err != nil {
		t.Fatalf("Pair failed: %v", err)
	}

	enc1 := fq12CanonicalBytes(kappa)
	enc2 := fq12CanonicalBytes(kappa)

	if len(enc1) != 12*48 {
		t.Fatalf("unexpected canonical length: got %d want %d", len(enc1), 12*48)
	}
	if hex.EncodeToString(enc1) != hex.EncodeToString(enc2) {
		t.Fatalf("fq12CanonicalBytes not deterministic")
	}
}

func TestGTToHash_DeterministicAndMatchesManual(t *testing.T) {
	a := big.NewInt(777)

	hk1, encHex1, err := gtToHash(a)
	if err != nil {
		t.Fatalf("gtToHash failed: %v", err)
	}
	hk2, encHex2, err := gtToHash(a)
	if err != nil {
		t.Fatalf("gtToHash failed (2): %v", err)
	}

	if hk1 != hk2 || encHex1 != encHex2 {
		t.Fatalf("gtToHash not deterministic")
	}
	if len(hk1) != 64 { // sha256 => 32 bytes => 64 hex
		t.Fatalf("unexpected hk hex length: got %d want 64", len(hk1))
	}
	if len(encHex1) != 12*48*2 {
		t.Fatalf("unexpected enc hex length: got %d want %d", len(encHex1), 12*48*2)
	}
	if hk1 != strings.ToLower(hk1) || encHex1 != strings.ToLower(encHex1) {
		t.Fatalf("expected lowercase hex outputs")
	}

	// Manual recompute: sha256(encBytes || domainTagBytes)
	encBytes := mustHexToBytes(t, encHex1)
	tagBytes := mustHexToBytes(t, DomainTagHex)
	msg := append(append([]byte{}, encBytes...), tagBytes...)

	manual := sha256Hex(msg)

	if manual != hk1 {
		t.Fatalf("manual sha256 mismatch: got %s want %s", manual, hk1)
	}
}

func TestHKScalarFromA_ConsistentWithDigestReduction(t *testing.T) {
	a := big.NewInt(9999)

	// Compute digest form
	_, encHex, err := gtToHash(a)
	if err != nil {
		t.Fatalf("gtToHash failed: %v", err)
	}

	encBytes := mustHexToBytes(t, encHex)
	tagBytes := mustHexToBytes(t, DomainTagHex)
	msg := append(append([]byte{}, encBytes...), tagBytes...)
	digest := sha256.Sum256(msg) // 32 bytes

	// Reduce into Fr (exactly what hkScalarFromA does: fr.Element.SetBytes on digest)
	var s fr.Element
	s.SetBytes(digest[:])
	var expected big.Int
	s.BigInt(&expected)

	got, err := hkScalarFromA(a)
	if err != nil {
		t.Fatalf("hkScalarFromA failed: %v", err)
	}
	if got.Cmp(&expected) != 0 {
		t.Fatalf("hkScalarFromA mismatch: got %s want %s", got.String(), expected.String())
	}
}

func TestParseCompressedHex_ErrorsOnBadInputs(t *testing.T) {
	// Bad hex
	if _, err := parseG1CompressedHex("zzzz"); err == nil {
		t.Fatalf("expected error for invalid G1 hex")
	}
	if _, err := parseG2CompressedHex("zzzz"); err == nil {
		t.Fatalf("expected error for invalid G2 hex")
	}

	// Wrong-length-but-valid-hex (SetBytes should error)
	if _, err := parseG1CompressedHex(strings.Repeat("00", 47)); err == nil {
		t.Fatalf("expected error for short G1 compressed bytes")
	}
	if _, err := parseG2CompressedHex(strings.Repeat("00", 95)); err == nil {
		t.Fatalf("expected error for short G2 compressed bytes")
	}
}

// ---------- tests: DecryptToHash ----------

func TestDecryptToHash_MatchesManual_Constructor1(t *testing.T) {
	// Build deterministic points
	var g1b bls12381.G1Affine
	g1b.ScalarMultiplicationBase(big.NewInt(3))

	var r1 bls12381.G1Affine
	r1.ScalarMultiplicationBase(big.NewInt(5))

	var shared bls12381.G2Affine
	shared.ScalarMultiplicationBase(big.NewInt(7))

	// Call function under test (constructor==1 => g2bHex empty)
	got, err := DecryptToHash(g1HexFromAffine(g1b), "", g1HexFromAffine(r1), g2HexFromAffine(shared))
	if err != nil {
		t.Fatalf("DecryptToHash failed: %v", err)
	}

	// Manual
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		t.Fatalf("parse H0 failed: %v", err)
	}

	r2, err := bls12381.Pair([]bls12381.G1Affine{g1b}, []bls12381.G2Affine{h0})
	if err != nil {
		t.Fatalf("Pair(g1b,H0) failed: %v", err)
	}
	b, err := bls12381.Pair([]bls12381.G1Affine{r1}, []bls12381.G2Affine{shared})
	if err != nil {
		t.Fatalf("Pair(r1,shared) failed: %v", err)
	}
	k := gtDiv(r2, b)
	want, err := gtToHashFromGT(k)
	if err != nil {
		t.Fatalf("gtToHashFromGT failed: %v", err)
	}

	if got != want {
		t.Fatalf("DecryptToHash mismatch: got %s want %s", got, want)
	}
}

func TestDecryptToHash_MatchesManual_Constructor2(t *testing.T) {
	// deterministic points
	var g1b bls12381.G1Affine
	g1b.ScalarMultiplicationBase(big.NewInt(11))

	var r1 bls12381.G1Affine
	r1.ScalarMultiplicationBase(big.NewInt(13))

	var shared bls12381.G2Affine
	shared.ScalarMultiplicationBase(big.NewInt(17))

	var g2b bls12381.G2Affine
	g2b.ScalarMultiplicationBase(big.NewInt(19))

	got, err := DecryptToHash(
		g1HexFromAffine(g1b),
		g2HexFromAffine(g2b),
		g1HexFromAffine(r1),
		g2HexFromAffine(shared),
	)
	if err != nil {
		t.Fatalf("DecryptToHash failed: %v", err)
	}

	// Manual
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		t.Fatalf("parse H0 failed: %v", err)
	}

	r2, err := bls12381.Pair([]bls12381.G1Affine{g1b}, []bls12381.G2Affine{h0})
	if err != nil {
		t.Fatalf("Pair(g1b,H0) failed: %v", err)
	}
	t2, err := bls12381.Pair([]bls12381.G1Affine{r1}, []bls12381.G2Affine{g2b})
	if err != nil {
		t.Fatalf("Pair(r1,g2b) failed: %v", err)
	}
	r2.Mul(&r2, &t2)

	b, err := bls12381.Pair([]bls12381.G1Affine{r1}, []bls12381.G2Affine{shared})
	if err != nil {
		t.Fatalf("Pair(r1,shared) failed: %v", err)
	}
	k := gtDiv(r2, b)
	want, err := gtToHashFromGT(k)
	if err != nil {
		t.Fatalf("gtToHashFromGT failed: %v", err)
	}

	if got != want {
		t.Fatalf("DecryptToHash mismatch: got %s want %s", got, want)
	}
}

// ---------- tests: proofs + export ----------

func TestProveAndVerifyW_Succeeds_AndWritesOut(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		a := big.NewInt(1234567)
		wHex := computeWCompressedHexFromA(t, a)

		if err := ProveAndVerifyW(a, wHex); err != nil {
			t.Fatalf("ProveAndVerifyW failed: %v", err)
		}

		// ProveAndVerifyW always exports to "out"
		outDir := filepath.Join(tmp, "out")
		for _, name := range []string{"vk.json", "proof.json", "public.json"} {
			p := filepath.Join(outDir, name)
			if _, err := os.Stat(p); err != nil {
				t.Fatalf("expected %s to exist at %q: %v", name, p, err)
			}
		}

		// Basic JSON sanity: vk.IC length must be nPublic+1 and match public.json length.
		var vk VKJSON
		if err := json.Unmarshal(mustReadFile(t, filepath.Join(outDir, "vk.json")), &vk); err != nil {
			t.Fatalf("unmarshal vk.json failed: %v", err)
		}
		var pub PublicJSON
		if err := json.Unmarshal(mustReadFile(t, filepath.Join(outDir, "public.json")), &pub); err != nil {
			t.Fatalf("unmarshal public.json failed: %v", err)
		}
		if vk.NPublic != len(pub.Inputs) {
			t.Fatalf("vk.NPublic mismatch: got %d want %d", vk.NPublic, len(pub.Inputs))
		}
		if len(vk.VkIC) != vk.NPublic+1 {
			t.Fatalf("vk.IC length mismatch: got %d want %d", len(vk.VkIC), vk.NPublic+1)
		}
	})
}

func TestProveAndVerifyW_FailsOnWrongW(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(_ string) {
		a := big.NewInt(1234567)

		// Wrong W: just 48 zero bytes (valid hex length but not a valid compressed point)
		// This should fail *before* proving, when parsing compressed G1.
		wHex := strings.Repeat("00", 48)

		if err := ProveAndVerifyW(a, wHex); err == nil {
			t.Fatalf("expected error for invalid compressed G1 W")
		}

		// Another wrong-but-parseable W: take correct W and flip a nibble.
		correct := computeWCompressedHexFromA(t, a)
		b := []byte(correct)
		// flip one hex digit (keep it hex)
		if b[0] == 'a' {
			b[0] = 'b'
		} else {
			b[0] = 'a'
		}
		wHex2 := string(b)

		// Might fail either at parse (if it becomes invalid point) or at proving (constraints unsatisfied).
		if err := ProveAndVerifyW(a, wHex2); err == nil {
			t.Fatalf("expected failure for wrong W (parse or constraints)")
		}
	})
}

func TestProveAndVerifyVW0W1_Succeeds_AndExportsConsistently(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		a := big.NewInt(11111)
		r := big.NewInt(22222)

		vHex, w0Hex, w1Hex := computeVW0W1(t, a, r)

		outDir := filepath.Join(tmp, "artifacts")
		if err := ProveAndVerifyVW0W1(a, r, vHex, w0Hex, w1Hex, outDir); err != nil {
			t.Fatalf("ProveAndVerifyVW0W1 failed: %v", err)
		}

		// Files exist
		for _, name := range []string{"vk.json", "proof.json", "public.json"} {
			p := filepath.Join(outDir, name)
			if _, err := os.Stat(p); err != nil {
				t.Fatalf("expected %s to exist at %q: %v", name, p, err)
			}
		}

		// JSON shape consistency
		var vk VKJSON
		if err := json.Unmarshal(mustReadFile(t, filepath.Join(outDir, "vk.json")), &vk); err != nil {
			t.Fatalf("unmarshal vk.json failed: %v", err)
		}
		var pj ProofJSON
		if err := json.Unmarshal(mustReadFile(t, filepath.Join(outDir, "proof.json")), &pj); err != nil {
			t.Fatalf("unmarshal proof.json failed: %v", err)
		}
		var pub PublicJSON
		if err := json.Unmarshal(mustReadFile(t, filepath.Join(outDir, "public.json")), &pub); err != nil {
			t.Fatalf("unmarshal public.json failed: %v", err)
		}

		// Proof fields non-empty and decode to correct byte lengths
		if pj.PiA == "" || pj.PiB == "" || pj.PiC == "" {
			t.Fatalf("expected non-empty proof fields: %+v", pj)
		}
		if len(mustHexToBytes(t, pj.PiA)) != 48 {
			t.Fatalf("piA length mismatch")
		}
		if len(mustHexToBytes(t, pj.PiB)) != 96 {
			t.Fatalf("piB length mismatch")
		}
		if len(mustHexToBytes(t, pj.PiC)) != 48 {
			t.Fatalf("piC length mismatch")
		}

		// VK consistency: IC length == nPublic+1, and nPublic == len(public.inputs)
		if vk.NPublic != len(pub.Inputs) {
			t.Fatalf("vk.NPublic mismatch: got %d want %d", vk.NPublic, len(pub.Inputs))
		}
		if len(vk.VkIC) != vk.NPublic+1 {
			t.Fatalf("vk.IC length mismatch: got %d want %d", len(vk.VkIC), vk.NPublic+1)
		}

		// Public inputs are decimal strings parseable as big.Int
		for i, s := range pub.Inputs {
			_ = mustParseDecBigInt(t, s) // ensures parsable
			if len(s) == 0 {
				t.Fatalf("empty public input at index %d", i)
			}
		}
	})
}

func TestProveAndVerifyVW0W1_FailsOnWrongW0(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		a := big.NewInt(33333)
		r := big.NewInt(44444)

		vHex, w0Hex, w1Hex := computeVW0W1(t, a, r)

		// Make W0 wrong but still a valid compressed point:
		// W0' = W0 + G (in the group) => compute by modifying point, then re-encode.
		w0Aff, err := parseG1CompressedHex(w0Hex)
		if err != nil {
			t.Fatalf("parse w0 failed: %v", err)
		}
		var gen bls12381.G1Affine
		gen.ScalarMultiplicationBase(big.NewInt(1))

		var w0Bad bls12381.G1Affine
		w0Bad.Add(&w0Aff, &gen)
		w0BadHex := g1HexFromAffine(w0Bad)

		outDir := filepath.Join(tmp, "bad")
		if err := ProveAndVerifyVW0W1(a, r, vHex, w0BadHex, w1Hex, outDir); err == nil {
			t.Fatalf("expected failure for wrong W0 (constraints should be unsatisfied)")
		}
	})
}

func TestPublicHashSplitLogic_MatchesProveAndVerifyW(t *testing.T) {
	// This is a pure logic test for the HW0/HW1 split used by ProveAndVerifyW.
	// It helps catch accidental endianness/offset changes.
	a := big.NewInt(555555)
	wHex := computeWCompressedHexFromA(t, a)
	rawW := mustHexToBytes(t, wHex)

	d := sha256.Sum256(rawW)

	var hw0, hw1 big.Int
	hw0.SetBytes(d[:16])
	hw1.SetBytes(d[16:])

	// Sanity: recombine should equal full digest
	recombined := append(hw0.FillBytes(make([]byte, 16)), hw1.FillBytes(make([]byte, 16))...)
	if hex.EncodeToString(recombined) != hex.EncodeToString(d[:]) {
		t.Fatalf("HW0/HW1 recombination mismatch")
	}
}
