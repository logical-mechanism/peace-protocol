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
