// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// cli_test.go
package main

import (
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
)

// --- helpers ---

func buildSnarkBin(t *testing.T) string {
	t.Helper()

	tmp := t.TempDir()
	bin := filepath.Join(tmp, "snark-bin")

	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Env = os.Environ()

	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go build failed: %v\n%s", err, string(out))
	}
	return bin
}

func runSnark(t *testing.T, bin string, args ...string) (code int, stdout string, stderr string) {
	t.Helper()

	cmd := exec.Command(bin, args...)

	// Capture both separately
	var outB, errB strings.Builder
	cmd.Stdout = &outB
	cmd.Stderr = &errB

	err := cmd.Run()
	if err == nil {
		return 0, outB.String(), errB.String()
	}
	if ee, ok := err.(*exec.ExitError); ok {
		return ee.ExitCode(), outB.String(), errB.String()
	}
	t.Fatalf("unexpected exec error: %v", err)
	return 999, "", ""
}

var reHex64 = regexp.MustCompile(`^[0-9a-f]{64}\s*$`)

// --- tests ---

func TestCLI_NoArgs_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, out, errOut := runSnark(t, bin /* no args */)
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d (stdout=%q stderr=%q)", code, out, errOut)
	}
}

func TestCLI_UnknownCommand_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, _, _ := runSnark(t, bin, "nope")
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d", code)
	}
}

func TestCLI_Hash_MissingA_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, _, errOut := runSnark(t, bin, "hash")
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d (stderr=%q)", code, errOut)
	}
	if !strings.Contains(errOut, "error: -a is required") {
		t.Fatalf("expected missing -a error, got stderr=%q", errOut)
	}
}

func TestCLI_Hash_BadA_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, _, errOut := runSnark(t, bin, "hash", "-a", "not_a_number")
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d (stderr=%q)", code, errOut)
	}
	if !strings.Contains(errOut, "could not parse -a") {
		t.Fatalf("expected parse error, got stderr=%q", errOut)
	}
}

func TestCLI_Hash_Success_PrintsOnlyHK(t *testing.T) {
	bin := buildSnarkBin(t)

	// Pick a deterministic a
	aStr := "12345"

	// Expected from in-process call
	a := newBigFromBase0(t, aStr)
	wantHK, _, err := gtToHash(a)
	if err != nil {
		t.Fatalf("gtToHash failed: %v", err)
	}

	code, out, errOut := runSnark(t, bin, "hash", "-a", aStr)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d (stdout=%q stderr=%q)", code, out, errOut)
	}
	if errOut != "" {
		t.Fatalf("expected empty stderr, got %q", errOut)
	}
	if !reHex64.MatchString(out) {
		t.Fatalf("expected 56-hex output, got %q", out)
	}
	if strings.TrimSpace(out) != wantHK {
		t.Fatalf("hash mismatch: got %q want %q", strings.TrimSpace(out), wantHK)
	}
}

func TestCLI_Decrypt_MissingRequiredArgs_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, _, errOut := runSnark(t, bin, "decrypt", "-g1b", "00")
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d (stderr=%q)", code, errOut)
	}
	if !strings.Contains(errOut, "error: -g1b, -r1, and -shared are required") {
		t.Fatalf("expected required-args error, got stderr=%q", errOut)
	}
}

func TestCLI_Decrypt_Success_Constructor1(t *testing.T) {
	bin := buildSnarkBin(t)

	// Deterministic valid points
	g1b := g1HexFromAffine(mustG1MulBase(t, 3))
	r1 := g1HexFromAffine(mustG1MulBase(t, 5))
	shared := g2HexFromAffine(mustG2MulBase(t, 7))

	want, err := DecryptToHash(g1b, "", r1, shared)
	if err != nil {
		t.Fatalf("DecryptToHash (in-process) failed: %v", err)
	}

	code, out, errOut := runSnark(t, bin, "decrypt", "-g1b", g1b, "-r1", r1, "-shared", shared)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d (stdout=%q stderr=%q)", code, out, errOut)
	}
	if errOut != "" {
		t.Fatalf("expected empty stderr, got %q", errOut)
	}
	if strings.TrimSpace(out) != want {
		t.Fatalf("decrypt hash mismatch: got %q want %q", strings.TrimSpace(out), want)
	}
}

func TestCLI_Decrypt_Success_Constructor2_WithG2B(t *testing.T) {
	bin := buildSnarkBin(t)

	g1b := g1HexFromAffine(mustG1MulBase(t, 11))
	r1 := g1HexFromAffine(mustG1MulBase(t, 13))
	shared := g2HexFromAffine(mustG2MulBase(t, 17))
	g2b := g2HexFromAffine(mustG2MulBase(t, 19))

	want, err := DecryptToHash(g1b, g2b, r1, shared)
	if err != nil {
		t.Fatalf("DecryptToHash (in-process) failed: %v", err)
	}

	code, out, errOut := runSnark(t, bin, "decrypt", "-g1b", g1b, "-g2b", g2b, "-r1", r1, "-shared", shared)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d (stdout=%q stderr=%q)", code, out, errOut)
	}
	if errOut != "" {
		t.Fatalf("expected empty stderr, got %q", errOut)
	}
	if strings.TrimSpace(out) != want {
		t.Fatalf("decrypt hash mismatch: got %q want %q", strings.TrimSpace(out), want)
	}
}

func TestCLI_Prove_MissingArgs_Exits2(t *testing.T) {
	bin := buildSnarkBin(t)

	code, _, errOut := runSnark(t, bin, "prove", "-a", "1")
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d (stderr=%q)", code, errOut)
	}
	// It prints multiple "error: -x is required" lines
	if !strings.Contains(errOut, "error: -r is required") {
		t.Fatalf("expected missing -r error, got stderr=%q", errOut)
	}
}

func TestCLI_Prove_Success_WritesArtifacts(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping proof CLI test in -short mode (runs gnark proof generation)")
	}

	bin := buildSnarkBin(t)

	// Use in-process math to build consistent public points
	a := "11111"
	r := "22222"
	aBi := newBigFromBase0(t, a)
	rBi := newBigFromBase0(t, r)
	vHex, w0Hex, w1Hex := computeVW0W1(t, aBi, rBi)

	outDir := filepath.Join(t.TempDir(), "out")

	code, out, errOut := runSnark(t, bin,
		"prove",
		"-a", a,
		"-r", r,
		"-v", vHex,
		"-w0", w0Hex,
		"-w1", w1Hex,
		"-out", outDir,
	)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d (stdout=%q stderr=%q)", code, out, errOut)
	}
	if errOut != "" {
		t.Fatalf("expected empty stderr, got %q", errOut)
	}
	if !strings.Contains(out, "SUCCESS: proof verified") {
		t.Fatalf("expected success message, got stdout=%q", out)
	}

	// Ensure artifacts exist
	for _, name := range []string{"vk.json", "proof.json", "public.json"} {
		if _, err := os.Stat(filepath.Join(outDir, name)); err != nil {
			t.Fatalf("expected artifact %s to exist: %v", name, err)
		}
	}
}

// --- small local math helpers (pure go, deterministic) ---

func newBigFromBase0(t *testing.T, s string) *big.Int {
	t.Helper()
	bi := new(big.Int)
	if _, ok := bi.SetString(s, 0); !ok {
		t.Fatalf("failed to parse big.Int %q", s)
	}
	return bi
}

func mustG1MulBase(t *testing.T, n int64) bls12381.G1Affine {
	t.Helper()
	var p bls12381.G1Affine
	p.ScalarMultiplicationBase(big.NewInt(n))
	return p
}

func mustG2MulBase(t *testing.T, n int64) bls12381.G2Affine {
	t.Helper()
	var p bls12381.G2Affine
	p.ScalarMultiplicationBase(big.NewInt(n))
	return p
}
