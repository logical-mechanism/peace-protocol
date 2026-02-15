// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// ceremony_test.go
package main

import (
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

// ---------- file discovery tests (fast, no crypto) ----------

func TestFindContributions_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	paths, err := findContributions(dir, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(paths) != 0 {
		t.Fatalf("expected 0 paths, got %d", len(paths))
	}
}

func TestFindContributions_SortOrder(t *testing.T) {
	dir := t.TempDir()
	// Create files out of order
	for _, name := range []string{"phase1_0002.bin", "phase1_0000.bin", "phase1_0001.bin"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Also create a phase2 file that should NOT appear
	if err := os.WriteFile(filepath.Join(dir, "phase2_0000.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	paths, err := findContributions(dir, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(paths) != 3 {
		t.Fatalf("expected 3 paths, got %d", len(paths))
	}
	// Check sorted order
	for i, want := range []string{"phase1_0000.bin", "phase1_0001.bin", "phase1_0002.bin"} {
		if filepath.Base(paths[i]) != want {
			t.Fatalf("paths[%d] = %s, want %s", i, filepath.Base(paths[i]), want)
		}
	}
}

func TestLatestContribution_ReturnsHighest(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"phase1_0000.bin", "phase1_0001.bin", "phase1_0003.bin"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	path, idx, err := latestContribution(dir, 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if idx != 3 {
		t.Fatalf("expected index 3, got %d", idx)
	}
	if filepath.Base(path) != "phase1_0003.bin" {
		t.Fatalf("expected phase1_0003.bin, got %s", filepath.Base(path))
	}
}

func TestLatestContribution_NoFiles(t *testing.T) {
	dir := t.TempDir()
	_, _, err := latestContribution(dir, 1)
	if err == nil {
		t.Fatal("expected error for empty dir")
	}
}

func TestContributionPath_Formatting(t *testing.T) {
	got := contributionPath("/tmp/ceremony", 1, 42)
	want := "/tmp/ceremony/phase1_0042.bin"
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}

	got2 := contributionPath("/tmp/ceremony", 2, 0)
	want2 := "/tmp/ceremony/phase2_0000.bin"
	if got2 != want2 {
		t.Fatalf("got %s, want %s", got2, want2)
	}
}

// ---------- ceremony init tests ----------

func TestCeremonyInit_CreatesFiles(t *testing.T) {
	if testing.Short() {
		t.Skip("skip circuit compilation in -short mode")
	}
	dir := filepath.Join(t.TempDir(), "ceremony")
	if err := CeremonyInit(dir, false); err != nil {
		t.Fatalf("CeremonyInit failed: %v", err)
	}

	// Check files exist
	for _, name := range []string{"ccs.bin", "phase1_0000.bin"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
		if info.Size() == 0 {
			t.Fatalf("%s is empty", name)
		}
	}
}

func TestCeremonyInit_RefusesOverwrite(t *testing.T) {
	if testing.Short() {
		t.Skip("skip circuit compilation in -short mode")
	}
	dir := filepath.Join(t.TempDir(), "ceremony")
	if err := CeremonyInit(dir, false); err != nil {
		t.Fatalf("first init failed: %v", err)
	}
	// Second init without force should fail
	if err := CeremonyInit(dir, false); err == nil {
		t.Fatal("expected error on second init without -force")
	}
}

// ---------- end-to-end ceremony test (expensive) ----------

func TestCeremonyEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skip expensive ceremony test in -short mode")
	}

	dir := filepath.Join(t.TempDir(), "ceremony")

	// 1. Init
	t.Log("Init...")
	if err := CeremonyInit(dir, false); err != nil {
		t.Fatalf("init: %v", err)
	}

	// 2. Two Phase1 contributions
	t.Log("Phase1 contribute #1...")
	idx1, hash1, err := CeremonyContributePhase1(dir)
	if err != nil {
		t.Fatalf("phase1 contribute 1: %v", err)
	}
	if idx1 != 1 || hash1 == "" {
		t.Fatalf("unexpected idx=%d hash=%s", idx1, hash1)
	}

	t.Log("Phase1 contribute #2...")
	idx2, hash2, err := CeremonyContributePhase1(dir)
	if err != nil {
		t.Fatalf("phase1 contribute 2: %v", err)
	}
	if idx2 != 2 || hash2 == "" {
		t.Fatalf("unexpected idx=%d hash=%s", idx2, hash2)
	}
	if hash1 == hash2 {
		t.Fatal("two contributions should have different hashes")
	}

	// 3. Verify Phase1
	t.Log("Phase1 verify...")
	count, err := CeremonyVerifyPhase1(dir)
	if err != nil {
		t.Fatalf("phase1 verify: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 verified, got %d", count)
	}

	// 4. Finalize Phase1
	t.Log("Phase1 finalize...")
	beacon1 := []byte("test beacon phase1")
	if err := CeremonyFinalizePhase1(dir, beacon1); err != nil {
		t.Fatalf("phase1 finalize: %v", err)
	}

	// Check commons.bin and phase2_0000.bin exist
	for _, name := range []string{"commons.bin", "phase2_0000.bin"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("missing %s after phase1 finalize: %v", name, err)
		}
	}

	// 5. Phase2 contribution
	t.Log("Phase2 contribute #1...")
	idx3, hash3, err := CeremonyContributePhase2(dir)
	if err != nil {
		t.Fatalf("phase2 contribute: %v", err)
	}
	if idx3 != 1 || hash3 == "" {
		t.Fatalf("unexpected idx=%d hash=%s", idx3, hash3)
	}

	// 6. Verify Phase2
	t.Log("Phase2 verify...")
	count2, err := CeremonyVerifyPhase2(dir)
	if err != nil {
		t.Fatalf("phase2 verify: %v", err)
	}
	if count2 != 1 {
		t.Fatalf("expected 1 verified, got %d", count2)
	}

	// 7. Finalize Phase2
	t.Log("Phase2 finalize...")
	beacon2 := []byte("test beacon phase2")
	if err := CeremonyFinalizePhase2(dir, beacon2); err != nil {
		t.Fatalf("phase2 finalize: %v", err)
	}

	// Check pk.bin, vk.bin, vk.json exist
	for _, name := range []string{"pk.bin", "vk.bin", "vk.json"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("missing %s after phase2 finalize: %v", name, err)
		}
		if info.Size() == 0 {
			t.Fatalf("%s is empty", name)
		}
	}

	// 8. Prove and verify using ceremony-produced keys
	t.Log("Prove with ceremony keys...")
	a := big.NewInt(11111)
	r := big.NewInt(22222)
	vHex, w0Hex, w1Hex := computeVW0W1(t, a, r)

	outDir := filepath.Join(t.TempDir(), "proof")
	if err := ProveVW0W1FromSetup(dir, outDir, a, r, vHex, w0Hex, w1Hex, true); err != nil {
		t.Fatalf("prove from ceremony setup: %v", err)
	}

	// 9. Standalone verify
	if err := VerifyFromFiles(outDir); err != nil {
		t.Fatalf("standalone verification: %v", err)
	}

	t.Log("Ceremony end-to-end succeeded")
}

// ---------- error path tests ----------

func TestCeremonyContributePhase1_NoCeremony(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noexist")
	_, _, err := CeremonyContributePhase1(dir)
	if err == nil {
		t.Fatal("expected error for missing ceremony dir")
	}
}

func TestCeremonyContributePhase2_NoCeremony(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noexist")
	_, _, err := CeremonyContributePhase2(dir)
	if err == nil {
		t.Fatal("expected error for missing ceremony dir")
	}
}

func TestCeremonyVerifyPhase1_NotEnoughContributions(t *testing.T) {
	dir := t.TempDir()
	// Create only the identity file
	if err := os.WriteFile(filepath.Join(dir, "phase1_0000.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := CeremonyVerifyPhase1(dir)
	if err == nil {
		t.Fatal("expected error for single file (no contributions)")
	}
}

func TestCeremonyVerifyPhase2_NotEnoughContributions(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "phase2_0000.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := CeremonyVerifyPhase2(dir)
	if err == nil {
		t.Fatal("expected error for single file (no contributions)")
	}
}

func TestCeremonyFinalizePhase1_NoCeremony(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noexist")
	err := CeremonyFinalizePhase1(dir, []byte("beacon"))
	if err == nil {
		t.Fatal("expected error for missing ceremony dir")
	}
}

func TestCeremonyFinalizePhase2_NoCeremony(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "noexist")
	err := CeremonyFinalizePhase2(dir, []byte("beacon"))
	if err == nil {
		t.Fatal("expected error for missing ceremony dir")
	}
}
