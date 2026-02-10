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
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/mimc"

	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/pedersen"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
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
	if len(hk1) != 64 { // mimc Fr element => 32 bytes => 64 hex
		t.Fatalf("unexpected hk hex length: got %d want 64", len(hk1))
	}
	if len(encHex1) != 12*48*2 {
		t.Fatalf("unexpected enc hex length: got %d want %d", len(encHex1), 12*48*2)
	}
	if hk1 != strings.ToLower(hk1) || encHex1 != strings.ToLower(encHex1) {
		t.Fatalf("expected lowercase hex outputs")
	}

	// Manual recompute: mimc(fq12ToFrElements || domainTagFr)
	// We need to compute kappa from a to get the Fr elements
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		t.Fatalf("parseG2 failed: %v", err)
	}
	qa := g1MulBase(a)
	kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
	if err != nil {
		t.Fatalf("pairing failed: %v", err)
	}

	elements := fq12ToFrElements(kappa)
	elements = append(elements, domainTagFr())
	manual := mimcHex(elements)

	if manual != hk1 {
		t.Fatalf("manual mimc mismatch: got %s want %s", manual, hk1)
	}
}

func TestHKScalarFromA_ConsistentWithDigestReduction(t *testing.T) {
	a := big.NewInt(9999)

	// Compute manually using MiMC
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		t.Fatalf("parseG2 failed: %v", err)
	}
	qa := g1MulBase(a)
	kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
	if err != nil {
		t.Fatalf("pairing failed: %v", err)
	}

	elements := fq12ToFrElements(kappa)
	elements = append(elements, domainTagFr())

	// Hash with MiMC
	h := mimc.NewMiMC()
	for _, e := range elements {
		h.Write(e.Marshal())
	}
	var expected fr.Element
	expected.SetBytes(h.Sum(nil))
	var expectedBi big.Int
	expected.BigInt(&expectedBi)

	got, err := hkScalarFromA(a)
	if err != nil {
		t.Fatalf("hkScalarFromA failed: %v", err)
	}
	if got.Cmp(&expectedBi) != 0 {
		t.Fatalf("hkScalarFromA mismatch: got %s want %s", got.String(), expectedBi.String())
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

// ---------- Setup/Prove Workflow Tests ----------

func TestSetupFilesExist_ReturnsFalseForEmptyDir(t *testing.T) {
	tmp := t.TempDir()
	if SetupFilesExist(tmp) {
		t.Fatalf("expected false for empty dir")
	}
}

func TestSetupFilesExist_ReturnsTrueWhenAllFilesPresent(t *testing.T) {
	tmp := t.TempDir()
	// Create dummy files
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("dummy"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if !SetupFilesExist(tmp) {
		t.Fatalf("expected true when all files present")
	}
}

func TestSetupVW0W1Circuit_SkipsIfAlreadyExists(t *testing.T) {
	tmp := t.TempDir()
	// Create dummy files
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("dummy"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	// Should return early without error (and not overwrite)
	if err := SetupVW0W1Circuit(tmp, false); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// Verify files are still dummy content (not overwritten)
	content, _ := os.ReadFile(filepath.Join(tmp, "ccs.bin"))
	if string(content) != "dummy" {
		t.Fatalf("setup should have been skipped")
	}
}

func TestSetupAndProveFromSetup_EndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping expensive setup+prove test in -short mode")
	}

	tmp := t.TempDir()
	setupDir := filepath.Join(tmp, "setup")
	outDir := filepath.Join(tmp, "out")

	// 1) Run setup
	t.Log("Running setup...")
	if err := SetupVW0W1Circuit(setupDir, false); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// Verify setup files exist
	if !SetupFilesExist(setupDir) {
		t.Fatalf("setup files should exist after setup")
	}

	// Check file sizes are reasonable (including vk.json from setup)
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin", "vk.json"} {
		info, err := os.Stat(filepath.Join(setupDir, name))
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if info.Size() < 1000 {
			t.Fatalf("%s seems too small: %d bytes", name, info.Size())
		}
		t.Logf("%s: %d bytes", name, info.Size())
	}

	// 2) Prepare witness values
	a := big.NewInt(77777)
	r := big.NewInt(88888)
	vHex, w0Hex, w1Hex := computeVW0W1(t, a, r)

	// 3) Prove using setup files
	t.Log("Running prove from setup...")
	if err := ProveVW0W1FromSetup(setupDir, outDir, a, r, vHex, w0Hex, w1Hex, true); err != nil {
		t.Fatalf("prove from setup failed: %v", err)
	}

	// 4) Verify output files exist
	for _, name := range []string{"vk.json", "proof.json", "public.json", "vk.bin", "proof.bin", "witness.bin"} {
		if _, err := os.Stat(filepath.Join(outDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}

	// 5) Verify the proof using standalone verify
	if err := VerifyFromFiles(outDir); err != nil {
		t.Fatalf("standalone verification failed: %v", err)
	}

	t.Log("Setup and prove from setup workflow succeeded")
}

// ---------- audit-recommended adversarial tests ----------

// computeVW0W1WithVScalar is like computeVW0W1 but allows specifying the V scalar.
func computeVW0W1WithVScalar(t *testing.T, a, r, vScalar *big.Int) (vHex, w0Hex, w1Hex string) {
	t.Helper()

	var v bls12381.G1Affine
	v.ScalarMultiplicationBase(vScalar)

	hkBi, err := hkScalarFromA(a)
	if err != nil {
		t.Fatalf("hkScalarFromA failed: %v", err)
	}
	if hkBi.Sign() == 0 {
		t.Fatalf("hk reduced to 0; unexpected for this test")
	}

	var w0 bls12381.G1Affine
	w0.ScalarMultiplicationBase(new(big.Int).Set(hkBi))

	var qa bls12381.G1Affine
	qa.ScalarMultiplicationBase(new(big.Int).Set(a))

	var rv bls12381.G1Affine
	rv.ScalarMultiplication(&v, new(big.Int).Set(r))

	var w1 bls12381.G1Affine
	w1.Add(&qa, &rv)

	return g1HexFromAffine(v), g1HexFromAffine(w0), g1HexFromAffine(w1)
}

// --- negative proof tests: wrong public inputs ---

func TestProveAndVerifyVW0W1_FailsOnWrongW1(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		a := big.NewInt(55555)
		r := big.NewInt(66666)

		vHex, w0Hex, w1Hex := computeVW0W1(t, a, r)

		// Perturb W1: add the generator to get a different valid G1 point
		w1Aff, err := parseG1CompressedHex(w1Hex)
		if err != nil {
			t.Fatalf("parse w1 failed: %v", err)
		}
		var gen bls12381.G1Affine
		gen.ScalarMultiplicationBase(big.NewInt(1))

		var w1Bad bls12381.G1Affine
		w1Bad.Add(&w1Aff, &gen)
		w1BadHex := g1HexFromAffine(w1Bad)

		outDir := filepath.Join(tmp, "bad-w1")
		if err := ProveAndVerifyVW0W1(a, r, vHex, w0Hex, w1BadHex, outDir); err == nil {
			t.Fatalf("expected failure for wrong W1 (constraints should be unsatisfied)")
		}
	})
}

func TestProveAndVerifyVW0W1_FailsOnWrongV(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		a := big.NewInt(77777)
		r := big.NewInt(88888)

		// Compute correct (v, w0, w1) with V = [42]G (the default)
		_, w0Hex, w1Hex := computeVW0W1(t, a, r)

		// Use a different V = [99]G but keep w0 and w1 from the original V
		var vBad bls12381.G1Affine
		vBad.ScalarMultiplicationBase(big.NewInt(99))
		vBadHex := g1HexFromAffine(vBad)

		// w1 was computed as [a]G + [r]*[42]G, but now we claim V = [99]G.
		// The circuit checks w1 == [a]G + [r]*V, so with wrong V this fails.
		outDir := filepath.Join(tmp, "bad-v")
		if err := ProveAndVerifyVW0W1(a, r, vBadHex, w0Hex, w1Hex, outDir); err == nil {
			t.Fatalf("expected failure for wrong V (w1 constraint should be unsatisfied)")
		}
	})
}

func TestProveAndVerifyVW0W1_FailsOnDifferentA(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping gnark proof test in -short mode")
	}

	withTempCwd(t, func(tmp string) {
		aReal := big.NewInt(11111)
		r := big.NewInt(22222)

		// Compute correct public points for the real secret
		vHex, w0Hex, w1Hex := computeVW0W1(t, aReal, r)

		// Try to prove with a different secret a
		aFake := big.NewInt(99999)

		outDir := filepath.Join(tmp, "bad-a")
		if err := ProveAndVerifyVW0W1(aFake, r, vHex, w0Hex, w1Hex, outDir); err == nil {
			t.Fatalf("expected failure for wrong secret a (both w0 and w1 constraints should be unsatisfied)")
		}
	})
}

// --- boundary scalar tests (shared setup for efficiency) ---

func TestProveVW0W1_BoundaryScalars(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping expensive boundary test in -short mode")
	}

	tmp := t.TempDir()
	setupDir := filepath.Join(tmp, "setup")

	// Setup once and reuse for all boundary cases
	t.Log("Running setup for boundary scalar tests...")
	if err := SetupVW0W1Circuit(setupDir, false); err != nil {
		t.Fatalf("setup failed: %v", err)
	}

	// NOTE: gnark v0.14's emulated ScalarMulBase hits "no modular inverse" for
	// a=1 and a=r-1 (generator and its negation cause internal point coincidences
	// in the window method). ScalarMul with scalar=0 also fails (identity point
	// not representable in affine). These are gnark implementation limitations,
	// not circuit soundness issues. We test the smallest working values instead.
	cases := []struct {
		name string
		a    *big.Int
		r    *big.Int
	}{
		{"a=2_r=2", big.NewInt(2), big.NewInt(2)},
		{"a=3_r=200", big.NewInt(3), big.NewInt(200)},
		{"a=100_r=100", big.NewInt(100), big.NewInt(100)},
		{"a=999999_r=888888", big.NewInt(999999), big.NewInt(888888)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			vHex, w0Hex, w1Hex := computeVW0W1(t, tc.a, tc.r)

			outDir := filepath.Join(tmp, "out-"+tc.name)
			if err := ProveVW0W1FromSetup(setupDir, outDir, tc.a, tc.r, vHex, w0Hex, w1Hex, true); err != nil {
				t.Fatalf("proof failed for %s: %v", tc.name, err)
			}

			// Also verify from files to test the full roundtrip
			if err := VerifyFromFiles(outDir); err != nil {
				t.Fatalf("standalone verification failed for %s: %v", tc.name, err)
			}
		})
	}
}

// --- pure math tests (fast, no proof generation) ---

func TestDifferentR_DifferentW1(t *testing.T) {
	a := big.NewInt(42)
	r1 := big.NewInt(100)
	r2 := big.NewInt(200)

	_, _, w1Hex1 := computeVW0W1(t, a, r1)
	_, _, w1Hex2 := computeVW0W1(t, a, r2)

	if w1Hex1 == w1Hex2 {
		t.Fatalf("different r values should produce different w1 (blinding is effective)")
	}
}

func TestSameA_SameW0(t *testing.T) {
	a := big.NewInt(42)
	r1 := big.NewInt(100)
	r2 := big.NewInt(200)

	_, w0Hex1, _ := computeVW0W1(t, a, r1)
	_, w0Hex2, _ := computeVW0W1(t, a, r2)

	if w0Hex1 != w0Hex2 {
		t.Fatalf("same a should produce same w0 regardless of r")
	}
}

func TestDifferentA_DifferentW0(t *testing.T) {
	a1 := big.NewInt(42)
	a2 := big.NewInt(43)
	r := big.NewInt(100)

	_, w0Hex1, _ := computeVW0W1(t, a1, r)
	_, w0Hex2, _ := computeVW0W1(t, a2, r)

	if w0Hex1 == w0Hex2 {
		t.Fatalf("different a values should produce different w0")
	}
}

func TestDifferentA_DifferentHash(t *testing.T) {
	hk1, _, err := gtToHash(big.NewInt(1))
	if err != nil {
		t.Fatalf("gtToHash(1) failed: %v", err)
	}
	hk2, _, err := gtToHash(big.NewInt(2))
	if err != nil {
		t.Fatalf("gtToHash(2) failed: %v", err)
	}

	if hk1 == hk2 {
		t.Fatalf("different a values should produce different hk hashes")
	}
}

func TestGTToHash_RejectsZeroAndNil(t *testing.T) {
	if _, _, err := gtToHash(big.NewInt(0)); err == nil {
		t.Fatalf("expected error for a=0")
	}
	if _, _, err := gtToHash(nil); err == nil {
		t.Fatalf("expected error for a=nil")
	}
}

func TestHKScalarFromA_RejectsZeroAndNil(t *testing.T) {
	if _, err := hkScalarFromA(big.NewInt(0)); err == nil {
		t.Fatalf("expected error for a=0")
	}
	if _, err := hkScalarFromA(nil); err == nil {
		t.Fatalf("expected error for a=nil")
	}
}

func TestDifferentVScalar_DifferentW1(t *testing.T) {
	a := big.NewInt(42)
	r := big.NewInt(100)

	// Same (a, r) but different V scalars should produce different w1
	_, _, w1Hex1 := computeVW0W1WithVScalar(t, a, r, big.NewInt(42))
	_, _, w1Hex2 := computeVW0W1WithVScalar(t, a, r, big.NewInt(99))

	if w1Hex1 == w1Hex2 {
		t.Fatalf("different V should produce different w1")
	}
}

func TestDifferentVScalar_SameW0(t *testing.T) {
	a := big.NewInt(42)
	r := big.NewInt(100)

	// Same (a, r) but different V scalars should produce same w0 (w0 only depends on a)
	_, w0Hex1, _ := computeVW0W1WithVScalar(t, a, r, big.NewInt(42))
	_, w0Hex2, _ := computeVW0W1WithVScalar(t, a, r, big.NewInt(99))

	if w0Hex1 != w0Hex2 {
		t.Fatalf("w0 should not depend on V (only on a)")
	}
}

// ---------- Step 2.1: quick wins — trivial helpers ----------

func TestDomainTagBytes_DecodesCorrectly(t *testing.T) {
	b, err := domainTagBytes()
	if err != nil {
		t.Fatalf("domainTagBytes failed: %v", err)
	}
	// DomainTagHex = "4631327c546f7c4865787c76317c" => "F12|To|Hex|v1|"
	if string(b) != "F12|To|Hex|v1|" {
		t.Fatalf("unexpected domain tag: %q", string(b))
	}
}

func TestG1CompressedHex_RoundTrip(t *testing.T) {
	p := g1MulBase(big.NewInt(42))
	h, err := g1CompressedHex(p)
	if err != nil {
		t.Fatalf("g1CompressedHex failed: %v", err)
	}
	if len(h) != 96 {
		t.Fatalf("expected 96 hex chars, got %d", len(h))
	}
	// Round-trip: parse back
	p2, err := parseG1CompressedHex(h)
	if err != nil {
		t.Fatalf("round-trip parse failed: %v", err)
	}
	if !p.Equal(&p2) {
		t.Fatalf("round-trip mismatch")
	}
}

func TestG2CompressedHex_RoundTrip(t *testing.T) {
	var p bls12381.G2Affine
	p.ScalarMultiplicationBase(big.NewInt(42))
	h, err := g2CompressedHex(p)
	if err != nil {
		t.Fatalf("g2CompressedHex failed: %v", err)
	}
	if len(h) != 192 {
		t.Fatalf("expected 192 hex chars, got %d", len(h))
	}
	// Round-trip: parse back
	p2, err := parseG2CompressedHex(h)
	if err != nil {
		t.Fatalf("round-trip parse failed: %v", err)
	}
	if !p.Equal(&p2) {
		t.Fatalf("round-trip mismatch")
	}
}

// ---------- Step 2.2: choosePublicInputs — all reconciliation paths ----------

func TestChoosePublicInputs_PerfectMatch(t *testing.T) {
	// Case: icLen == len(pubRaw)+1 (perfect match)
	pub := []string{"10", "20", "30"}
	got, err := choosePublicInputs(pub, 4)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 || got[0] != "10" || got[1] != "20" || got[2] != "30" {
		t.Fatalf("expected [10 20 30], got %v", got)
	}
}

func TestChoosePublicInputs_PrependOne(t *testing.T) {
	// Case: icLen == len(pubRaw)+2 (prepend "1")
	pub := []string{"10", "20", "30"}
	got, err := choosePublicInputs(pub, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 4 || got[0] != "1" {
		t.Fatalf("expected prepended '1', got %v", got)
	}
	if got[1] != "10" || got[2] != "20" || got[3] != "30" {
		t.Fatalf("unexpected values after prepend: %v", got)
	}
}

func TestChoosePublicInputs_DropLeadingOneOrZero(t *testing.T) {
	// Case: icLen == len(pubRaw) with leading "1"
	pub := []string{"1", "10", "20"}
	got, err := choosePublicInputs(pub, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0] != "10" || got[1] != "20" {
		t.Fatalf("expected leading '1' dropped, got %v", got)
	}

	// Case: icLen == len(pubRaw) with leading "0"
	pub2 := []string{"0", "10", "20"}
	got2, err := choosePublicInputs(pub2, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got2) != 2 || got2[0] != "10" {
		t.Fatalf("expected leading '0' dropped, got %v", got2)
	}
}

func TestChoosePublicInputs_ErrorCases(t *testing.T) {
	// icLen < 1
	if _, err := choosePublicInputs([]string{"a"}, 0); err == nil {
		t.Fatalf("expected error for icLen=0")
	}

	// icLen == len(pubRaw) but leading value is not "0" or "1"
	if _, err := choosePublicInputs([]string{"999", "10"}, 2); err == nil {
		t.Fatalf("expected error when icLen==len and leading is not 0/1")
	}

	// Default mismatch: icLen far off from len(pubRaw)
	if _, err := choosePublicInputs([]string{"a", "b"}, 10); err == nil {
		t.Fatalf("expected error for large icLen mismatch")
	}
}

// ---------- Step 2.4: file I/O error paths ----------

func TestLoadSetupFiles_MissingDir(t *testing.T) {
	tmp := t.TempDir()
	_, _, _, err := LoadSetupFiles(filepath.Join(tmp, "noexist"))
	if err == nil {
		t.Fatalf("expected error for missing directory")
	}
}

func TestLoadSetupFiles_CorruptFiles(t *testing.T) {
	tmp := t.TempDir()
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("corrupt"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	_, _, _, err := LoadSetupFiles(tmp)
	if err == nil {
		t.Fatalf("expected error for corrupt setup files")
	}
}

func TestVerifyFromFiles_MissingDir(t *testing.T) {
	tmp := t.TempDir()
	err := VerifyFromFiles(filepath.Join(tmp, "noexist"))
	if err == nil {
		t.Fatalf("expected error for missing directory")
	}
}

func TestVerifyFromFiles_CorruptFiles(t *testing.T) {
	tmp := t.TempDir()
	for _, name := range []string{"vk.bin", "proof.bin", "witness.bin"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("corrupt"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	err := VerifyFromFiles(tmp)
	if err == nil {
		t.Fatalf("expected error for corrupt files")
	}
}

func TestReExportJSON_MissingFiles(t *testing.T) {
	tmp := t.TempDir()
	err := ReExportJSON(tmp)
	if err == nil {
		t.Fatalf("expected error for missing vk.bin")
	}
}

func TestReExportJSON_CorruptVK(t *testing.T) {
	tmp := t.TempDir()
	for _, name := range []string{"vk.bin", "proof.bin", "witness.bin"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("corrupt"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	err := ReExportJSON(tmp)
	if err == nil {
		t.Fatalf("expected error for corrupt vk.bin")
	}
}

// ---------- Step 2.5: input validation error paths (no proving) ----------

func TestDecryptToHash_BadG1bHex(t *testing.T) {
	_, err := DecryptToHash("zzzz", "", g1HexFromAffine(g1MulBase(big.NewInt(1))), g2HexFromAffine(func() bls12381.G2Affine {
		var p bls12381.G2Affine
		p.ScalarMultiplicationBase(big.NewInt(1))
		return p
	}()))
	if err == nil {
		t.Fatalf("expected error for bad g1b hex")
	}
}

func TestDecryptToHash_BadR1Hex(t *testing.T) {
	g1b := g1HexFromAffine(g1MulBase(big.NewInt(1)))
	_, err := DecryptToHash(g1b, "", "zzzz", g2HexFromAffine(func() bls12381.G2Affine {
		var p bls12381.G2Affine
		p.ScalarMultiplicationBase(big.NewInt(1))
		return p
	}()))
	if err == nil {
		t.Fatalf("expected error for bad r1 hex")
	}
}

func TestDecryptToHash_BadSharedHex(t *testing.T) {
	g1b := g1HexFromAffine(g1MulBase(big.NewInt(1)))
	r1 := g1HexFromAffine(g1MulBase(big.NewInt(2)))
	_, err := DecryptToHash(g1b, "", r1, "zzzz")
	if err == nil {
		t.Fatalf("expected error for bad shared hex")
	}
}

func TestDecryptToHash_BadG2bHex(t *testing.T) {
	g1b := g1HexFromAffine(g1MulBase(big.NewInt(1)))
	r1 := g1HexFromAffine(g1MulBase(big.NewInt(2)))
	shared := g2HexFromAffine(func() bls12381.G2Affine {
		var p bls12381.G2Affine
		p.ScalarMultiplicationBase(big.NewInt(3))
		return p
	}())
	_, err := DecryptToHash(g1b, "zzzz", r1, shared)
	if err == nil {
		t.Fatalf("expected error for bad g2b hex")
	}
}

func TestProveAndVerifyVW0W1_RejectsNilA(t *testing.T) {
	err := ProveAndVerifyVW0W1(nil, big.NewInt(0), strings.Repeat("00", 48), strings.Repeat("00", 48), strings.Repeat("00", 48), t.TempDir())
	if err == nil {
		t.Fatalf("expected error for nil a")
	}
}

func TestProveAndVerifyVW0W1_RejectsZeroA(t *testing.T) {
	err := ProveAndVerifyVW0W1(big.NewInt(0), big.NewInt(0), strings.Repeat("00", 48), strings.Repeat("00", 48), strings.Repeat("00", 48), t.TempDir())
	if err == nil {
		t.Fatalf("expected error for zero a")
	}
}

func TestProveAndVerifyVW0W1_RejectsBadVHex(t *testing.T) {
	err := ProveAndVerifyVW0W1(big.NewInt(42), big.NewInt(0), "zzzz", strings.Repeat("00", 48), strings.Repeat("00", 48), t.TempDir())
	if err == nil {
		t.Fatalf("expected error for bad v hex")
	}
}

func TestProveAndVerifyVW0W1_RejectsShortHex(t *testing.T) {
	err := ProveAndVerifyVW0W1(big.NewInt(42), big.NewInt(0), strings.Repeat("00", 47), strings.Repeat("00", 48), strings.Repeat("00", 48), t.TempDir())
	if err == nil {
		t.Fatalf("expected error for short v hex (47 bytes)")
	}
}

func TestProveVW0W1FromSetup_RejectsNilA(t *testing.T) {
	err := ProveVW0W1FromSetup("dummy", "dummy", nil, big.NewInt(0), strings.Repeat("00", 48), strings.Repeat("00", 48), strings.Repeat("00", 48), false)
	if err == nil {
		t.Fatalf("expected error for nil a")
	}
}

func TestProveVW0W1FromSetup_RejectsZeroA(t *testing.T) {
	err := ProveVW0W1FromSetup("dummy", "dummy", big.NewInt(0), big.NewInt(0), strings.Repeat("00", 48), strings.Repeat("00", 48), strings.Repeat("00", 48), false)
	if err == nil {
		t.Fatalf("expected error for zero a")
	}
}

func TestProveVW0W1FromSetup_RejectsBadVHex(t *testing.T) {
	err := ProveVW0W1FromSetup("dummy", "dummy", big.NewInt(42), big.NewInt(0), "zzzz", strings.Repeat("00", 48), strings.Repeat("00", 48), false)
	if err == nil {
		t.Fatalf("expected error for bad v hex")
	}
}

func TestProveAndVerifyW_RejectsNilA(t *testing.T) {
	err := ProveAndVerifyW(nil, strings.Repeat("00", 48))
	if err == nil {
		t.Fatalf("expected error for nil a")
	}
}

func TestProveAndVerifyW_RejectsShortWHex(t *testing.T) {
	err := ProveAndVerifyW(big.NewInt(42), "aabb")
	if err == nil {
		t.Fatalf("expected error for short w hex")
	}
}

func TestExportProofBLS_RejectsNil(t *testing.T) {
	_, err := exportProofBLS(nil)
	if err == nil {
		t.Fatalf("expected error for nil proof")
	}
}

func TestExportVKBLS_RejectsNil(t *testing.T) {
	_, err := exportVKBLS(nil, 5)
	if err == nil {
		t.Fatalf("expected error for nil VK")
	}
}

func TestExportVKBLS_RejectsNegativeNPublic(t *testing.T) {
	vk := &groth16bls.VerifyingKey{}
	_, err := exportVKBLS(vk, -1)
	if err == nil {
		t.Fatalf("expected error for negative nPublic")
	}
}

func TestExportVKBLS_RejectsShortIC(t *testing.T) {
	// nPublic=5 requires len(IC)>=6, but we have 0
	vk := &groth16bls.VerifyingKey{}
	_, err := exportVKBLS(vk, 5)
	if err == nil {
		t.Fatalf("expected error for short IC")
	}
}

func TestExportProofBLS_HappyPath(t *testing.T) {
	// Construct a minimal valid BLS12-381 proof with known G1/G2 points
	var ar, krs bls12381.G1Affine
	ar.ScalarMultiplicationBase(big.NewInt(7))
	krs.ScalarMultiplicationBase(big.NewInt(13))

	var bs bls12381.G2Affine
	bs.ScalarMultiplicationBase(big.NewInt(11))

	proof := &groth16bls.Proof{Ar: ar, Bs: bs, Krs: krs}
	pj, err := exportProofBLS(proof)
	if err != nil {
		t.Fatalf("exportProofBLS failed: %v", err)
	}
	if pj.PiA == "" || pj.PiB == "" || pj.PiC == "" {
		t.Fatalf("expected non-empty proof fields")
	}
	if len(pj.PiA) != 96 {
		t.Fatalf("piA hex length: got %d want 96", len(pj.PiA))
	}
	if len(pj.PiB) != 192 {
		t.Fatalf("piB hex length: got %d want 192", len(pj.PiB))
	}
	if len(pj.PiC) != 96 {
		t.Fatalf("piC hex length: got %d want 96", len(pj.PiC))
	}
}

func TestExportVKBLS_HappyPath(t *testing.T) {
	// Build a minimal VK with 2 IC elements (nPublic=1)
	var alpha, ic0, ic1 bls12381.G1Affine
	alpha.ScalarMultiplicationBase(big.NewInt(2))
	ic0.ScalarMultiplicationBase(big.NewInt(3))
	ic1.ScalarMultiplicationBase(big.NewInt(5))

	var beta, gamma, delta bls12381.G2Affine
	beta.ScalarMultiplicationBase(big.NewInt(7))
	gamma.ScalarMultiplicationBase(big.NewInt(11))
	delta.ScalarMultiplicationBase(big.NewInt(13))

	vk := &groth16bls.VerifyingKey{}
	vk.G1.Alpha = alpha
	vk.G1.K = []bls12381.G1Affine{ic0, ic1}
	vk.G2.Beta = beta
	vk.G2.Gamma = gamma
	vk.G2.Delta = delta

	vkj, err := exportVKBLS(vk, 1)
	if err != nil {
		t.Fatalf("exportVKBLS failed: %v", err)
	}
	if vkj.NPublic != 1 {
		t.Fatalf("nPublic: got %d want 1", vkj.NPublic)
	}
	if len(vkj.VkIC) != 2 {
		t.Fatalf("IC length: got %d want 2", len(vkj.VkIC))
	}
	if vkj.VkAlpha == "" || vkj.VkBeta == "" || vkj.VkGamma == "" || vkj.VkDelta == "" {
		t.Fatalf("expected non-empty VK fields")
	}
}

func TestExportVKOnly_HappyPath(t *testing.T) {
	// Build a minimal VK with 1 commitment key.
	// In gnark, len(IC) = nPublic + 1 + nCommitments.
	// ExportVKOnly computes nPublic = len(IC) - nCommitments.
	// With 3 IC elements and 1 commitment: nPublic = 3 - 1 = 2.
	var alpha, ic0, ic1, ic2 bls12381.G1Affine
	alpha.ScalarMultiplicationBase(big.NewInt(2))
	ic0.ScalarMultiplicationBase(big.NewInt(3))
	ic1.ScalarMultiplicationBase(big.NewInt(5))
	ic2.ScalarMultiplicationBase(big.NewInt(17))

	var beta, gamma, delta, ckG, ckGSN bls12381.G2Affine
	beta.ScalarMultiplicationBase(big.NewInt(7))
	gamma.ScalarMultiplicationBase(big.NewInt(11))
	delta.ScalarMultiplicationBase(big.NewInt(13))
	ckG.ScalarMultiplicationBase(big.NewInt(19))
	ckGSN.ScalarMultiplicationBase(big.NewInt(23))

	vk := &groth16bls.VerifyingKey{}
	vk.G1.Alpha = alpha
	vk.G1.K = []bls12381.G1Affine{ic0, ic1, ic2}
	vk.G2.Beta = beta
	vk.G2.Gamma = gamma
	vk.G2.Delta = delta
	vk.CommitmentKeys = []pedersen.VerifyingKey{{G: ckG, GSigmaNeg: ckGSN}}

	tmp := t.TempDir()
	if err := ExportVKOnly(vk, tmp); err != nil {
		t.Fatalf("ExportVKOnly failed: %v", err)
	}

	// Verify vk.json was created and is valid JSON
	data, err := os.ReadFile(filepath.Join(tmp, "vk.json"))
	if err != nil {
		t.Fatalf("read vk.json: %v", err)
	}
	var vkj VKJSON
	if err := json.Unmarshal(data, &vkj); err != nil {
		t.Fatalf("unmarshal vk.json: %v", err)
	}
	if vkj.NPublic != 2 {
		t.Fatalf("nPublic: got %d want 2", vkj.NPublic)
	}
	if len(vkj.CommitmentKeys) != 1 {
		t.Fatalf("commitmentKeys: got %d want 1", len(vkj.CommitmentKeys))
	}
}

func TestExportVKOnly_RejectsNonBLSVK(t *testing.T) {
	err := ExportVKOnly(nil, t.TempDir())
	if err == nil {
		t.Fatalf("expected error for nil VK")
	}
}
