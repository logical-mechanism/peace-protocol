// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// ceremony.go implements the multi-party computation (MPC) setup ceremony
// for the Groth16 proving system on BLS12-381. It wraps gnark's mpcsetup
// package to provide a file-based ceremony workflow with two phases:
//   - Phase 1 (Powers of Tau): circuit-independent, produces SRS commons
//   - Phase 2: circuit-specific, produces the final proving and verifying keys
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	mpcsetup "github.com/consensys/gnark/backend/groth16/bls12-381/mpcsetup"
	"github.com/consensys/gnark/constraint"
	cs "github.com/consensys/gnark/constraint/bls12-381"
)

// findContributions returns sorted file paths matching phase{N}_NNNN.bin in dir.
func findContributions(dir string, phase int) ([]string, error) {
	prefix := fmt.Sprintf("phase%d_", phase)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}
	var paths []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".bin") {
			paths = append(paths, filepath.Join(dir, name))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

// latestContribution returns the path and index of the highest-numbered contribution.
func latestContribution(dir string, phase int) (string, int, error) {
	paths, err := findContributions(dir, phase)
	if err != nil {
		return "", 0, err
	}
	if len(paths) == 0 {
		return "", 0, fmt.Errorf("no phase %d contributions found in %s", phase, dir)
	}
	last := paths[len(paths)-1]
	base := filepath.Base(last)
	// Extract NNNN from phase{N}_NNNN.bin
	numStr := strings.TrimPrefix(base, fmt.Sprintf("phase%d_", phase))
	numStr = strings.TrimSuffix(numStr, ".bin")
	idx, err := strconv.Atoi(numStr)
	if err != nil {
		return "", 0, fmt.Errorf("parse contribution index from %s: %w", base, err)
	}
	return last, idx, nil
}

// contributionPath returns the file path for a contribution with the given phase and index.
func contributionPath(dir string, phase, index int) string {
	return filepath.Join(dir, fmt.Sprintf("phase%d_%04d.bin", phase, index))
}

// fileHash computes the SHA-256 hash of a file and returns it as a hex string.
func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- Phase1 I/O ---

func savePhase1(path string, p *mpcsetup.Phase1) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	if _, err := p.WriteTo(f); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func loadPhase1(path string) (*mpcsetup.Phase1, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	p := new(mpcsetup.Phase1)
	if _, err := p.ReadFrom(f); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return p, nil
}

// --- Phase2 I/O ---

func savePhase2(path string, p *mpcsetup.Phase2) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	if _, err := p.WriteTo(f); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func loadPhase2(path string) (*mpcsetup.Phase2, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	p := new(mpcsetup.Phase2)
	if _, err := p.ReadFrom(f); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return p, nil
}

// --- SrsCommons I/O ---

func saveSrsCommons(path string, c *mpcsetup.SrsCommons) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	if _, err := c.WriteTo(f); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func loadSrsCommons(path string) (*mpcsetup.SrsCommons, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	c := new(mpcsetup.SrsCommons)
	if _, err := c.ReadFrom(f); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return c, nil
}

// --- CCS / R1CS I/O ---

func saveCCS(path string, ccs constraint.ConstraintSystem) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer f.Close()
	if _, err := ccs.WriteTo(f); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func loadR1CS(path string) (*cs.R1CS, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	ccs := groth16.NewCS(ecc.BLS12_381)
	if _, err := ccs.ReadFrom(f); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	r1cs, ok := ccs.(*cs.R1CS)
	if !ok {
		return nil, fmt.Errorf("CCS is not *bls12381.R1CS: %T", ccs)
	}
	return r1cs, nil
}

// domainSize computes the FFT domain size from a constraint system.
func domainSize(ccs constraint.ConstraintSystem) uint64 {
	return ecc.NextPowerOfTwo(uint64(ccs.GetNbConstraints()))
}

// --- Ceremony Functions ---

// CeremonyInit compiles the circuit, saves ccs.bin, and creates the initial Phase1 accumulator.
func CeremonyInit(dir string, force bool) error {
	if _, err := os.Stat(filepath.Join(dir, "ccs.bin")); err == nil && !force {
		return fmt.Errorf("ceremony already initialized in %s (use -force to overwrite)", dir)
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	ccs, err := CompileVW0W1Circuit()
	if err != nil {
		return err
	}

	if err := saveCCS(filepath.Join(dir, "ccs.bin"), ccs); err != nil {
		return err
	}

	N := domainSize(ccs)
	p1 := mpcsetup.NewPhase1(N)
	if err := savePhase1(contributionPath(dir, 1, 0), p1); err != nil {
		return err
	}

	fmt.Printf("  constraints: %d\n", ccs.GetNbConstraints())
	fmt.Printf("  domain size: %d\n", N)
	return nil
}

// CeremonyContributePhase1 loads the latest Phase1 accumulator, contributes, and saves the result.
func CeremonyContributePhase1(dir string) (int, string, error) {
	latestPath, idx, err := latestContribution(dir, 1)
	if err != nil {
		return 0, "", err
	}

	p1, err := loadPhase1(latestPath)
	if err != nil {
		return 0, "", fmt.Errorf("load latest phase1: %w", err)
	}

	p1.Contribute()

	nextIdx := idx + 1
	nextPath := contributionPath(dir, 1, nextIdx)
	if err := savePhase1(nextPath, p1); err != nil {
		return 0, "", err
	}

	hash, err := fileHash(nextPath)
	if err != nil {
		return nextIdx, "", fmt.Errorf("hash contribution: %w", err)
	}

	return nextIdx, hash, nil
}

// CeremonyContributePhase2 loads the latest Phase2 accumulator, contributes, and saves the result.
func CeremonyContributePhase2(dir string) (int, string, error) {
	latestPath, idx, err := latestContribution(dir, 2)
	if err != nil {
		return 0, "", err
	}

	p2, err := loadPhase2(latestPath)
	if err != nil {
		return 0, "", fmt.Errorf("load latest phase2: %w", err)
	}

	p2.Contribute()

	nextIdx := idx + 1
	nextPath := contributionPath(dir, 2, nextIdx)
	if err := savePhase2(nextPath, p2); err != nil {
		return 0, "", err
	}

	hash, err := fileHash(nextPath)
	if err != nil {
		return nextIdx, "", fmt.Errorf("hash contribution: %w", err)
	}

	return nextIdx, hash, nil
}

// CeremonyVerifyPhase1 loads all Phase1 contributions and verifies each pair sequentially.
func CeremonyVerifyPhase1(dir string) (int, error) {
	paths, err := findContributions(dir, 1)
	if err != nil {
		return 0, err
	}
	if len(paths) < 2 {
		return 0, fmt.Errorf("need at least 1 contribution beyond the initial (found %d files)", len(paths))
	}

	prev, err := loadPhase1(paths[0])
	if err != nil {
		return 0, fmt.Errorf("load initial: %w", err)
	}

	verified := 0
	for i := 1; i < len(paths); i++ {
		next, err := loadPhase1(paths[i])
		if err != nil {
			return verified, fmt.Errorf("load contribution %d: %w", i, err)
		}
		if err := prev.Verify(next); err != nil {
			return verified, fmt.Errorf("contribution %d invalid: %w", i, err)
		}
		verified++
		prev = next
	}

	return verified, nil
}

// CeremonyVerifyPhase2 loads all Phase2 contributions and verifies each pair sequentially.
func CeremonyVerifyPhase2(dir string) (int, error) {
	paths, err := findContributions(dir, 2)
	if err != nil {
		return 0, err
	}
	if len(paths) < 2 {
		return 0, fmt.Errorf("need at least 1 contribution beyond the initial (found %d files)", len(paths))
	}

	prev, err := loadPhase2(paths[0])
	if err != nil {
		return 0, fmt.Errorf("load initial: %w", err)
	}

	verified := 0
	for i := 1; i < len(paths); i++ {
		next, err := loadPhase2(paths[i])
		if err != nil {
			return verified, fmt.Errorf("load contribution %d: %w", i, err)
		}
		if err := prev.Verify(next); err != nil {
			return verified, fmt.Errorf("contribution %d invalid: %w", i, err)
		}
		verified++
		prev = next
	}

	return verified, nil
}

// CeremonyFinalizePhase1 verifies all Phase1 contributions, seals with the beacon,
// produces SRS commons, and initializes Phase2.
func CeremonyFinalizePhase1(dir string, beacon []byte) error {
	// Load CCS to get domain size
	r1cs, err := loadR1CS(filepath.Join(dir, "ccs.bin"))
	if err != nil {
		return fmt.Errorf("load ccs: %w", err)
	}
	N := domainSize(r1cs)

	// Load all Phase1 contributions (excluding 0000 identity)
	paths, err := findContributions(dir, 1)
	if err != nil {
		return err
	}
	if len(paths) < 2 {
		return fmt.Errorf("need at least 1 contribution beyond the initial (found %d files)", len(paths))
	}

	contributions := make([]*mpcsetup.Phase1, len(paths)-1)
	for i := 1; i < len(paths); i++ {
		p, err := loadPhase1(paths[i])
		if err != nil {
			return fmt.Errorf("load phase1 contribution %d: %w", i, err)
		}
		contributions[i-1] = p
	}

	// Verify and seal
	commons, err := mpcsetup.VerifyPhase1(N, beacon, contributions...)
	if err != nil {
		return fmt.Errorf("verify phase1: %w", err)
	}

	// Save SRS commons
	if err := saveSrsCommons(filepath.Join(dir, "commons.bin"), &commons); err != nil {
		return err
	}

	// Initialize Phase2
	var p2 mpcsetup.Phase2
	p2.Initialize(r1cs, &commons)
	if err := savePhase2(contributionPath(dir, 2, 0), &p2); err != nil {
		return err
	}

	return nil
}

// CeremonyFinalizePhase2 verifies all Phase2 contributions, seals with the beacon,
// and extracts the proving and verifying keys.
func CeremonyFinalizePhase2(dir string, beacon []byte) error {
	// Load CCS
	r1cs, err := loadR1CS(filepath.Join(dir, "ccs.bin"))
	if err != nil {
		return fmt.Errorf("load ccs: %w", err)
	}

	// Load SRS commons
	commons, err := loadSrsCommons(filepath.Join(dir, "commons.bin"))
	if err != nil {
		return fmt.Errorf("load commons: %w", err)
	}

	// Load all Phase2 contributions (excluding 0000 identity)
	paths, err := findContributions(dir, 2)
	if err != nil {
		return err
	}
	if len(paths) < 2 {
		return fmt.Errorf("need at least 1 contribution beyond the initial (found %d files)", len(paths))
	}

	contributions := make([]*mpcsetup.Phase2, len(paths)-1)
	for i := 1; i < len(paths); i++ {
		p, err := loadPhase2(paths[i])
		if err != nil {
			return fmt.Errorf("load phase2 contribution %d: %w", i, err)
		}
		contributions[i-1] = p
	}

	// Verify and seal — extracts PK and VK
	pk, vk, err := mpcsetup.VerifyPhase2(r1cs, commons, beacon, contributions...)
	if err != nil {
		return fmt.Errorf("verify phase2: %w", err)
	}

	// Save PK
	pkPath := filepath.Join(dir, "pk.bin")
	pkFile, err := os.Create(pkPath)
	if err != nil {
		return fmt.Errorf("create pk.bin: %w", err)
	}
	defer pkFile.Close()
	if _, err := pk.WriteTo(pkFile); err != nil {
		return fmt.Errorf("write pk.bin: %w", err)
	}

	// Save VK
	vkPath := filepath.Join(dir, "vk.bin")
	vkFile, err := os.Create(vkPath)
	if err != nil {
		return fmt.Errorf("create vk.bin: %w", err)
	}
	defer vkFile.Close()
	if _, err := vk.WriteTo(vkFile); err != nil {
		return fmt.Errorf("write vk.bin: %w", err)
	}

	// Export vk.json for Aiken
	if err := ExportVKOnly(vk, dir); err != nil {
		return fmt.Errorf("export vk.json: %w", err)
	}

	return nil
}
