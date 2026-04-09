// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

// ceremony.go implements multi-party computation (MPC) ceremony commands
// for Groth16 trusted setup on BLS12-381. This replaces the single-party
// setup with a ceremony where multiple participants contribute randomness,
// ensuring security as long as at least one participant is honest.

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/groth16/bls12-381/mpcsetup"
	cs_bls12381 "github.com/consensys/gnark/constraint/bls12-381"
)

// CeremonyInit compiles the circuit and initializes Phase 1 of the ceremony.
// Creates: ccs.bin (compiled circuit) and phase1/0000.ph1 (initial state).
func CeremonyInit(dir string) error {
	ccs, err := CompileCircuit()
	if err != nil {
		return fmt.Errorf("compile: %w", err)
	}
	fmt.Printf("Circuit compiled: %d constraints\n", ccs.GetNbConstraints())

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := writeToFile(filepath.Join(dir, "ccs.bin"), ccs); err != nil {
		return fmt.Errorf("write ccs.bin: %w", err)
	}

	domainSize := ecc.NextPowerOfTwo(uint64(ccs.GetNbConstraints()))

	p1Dir := filepath.Join(dir, "phase1")
	if err := os.MkdirAll(p1Dir, 0o755); err != nil {
		return err
	}

	p1 := mpcsetup.NewPhase1(domainSize)
	if err := writeToFile(filepath.Join(p1Dir, "0000.ph1"), p1); err != nil {
		return fmt.Errorf("write 0000.ph1: %w", err)
	}

	fmt.Printf("Phase 1 initialized: domain size %d\n", domainSize)
	fmt.Println("Distribute phase1/0000.ph1 to the first contributor.")
	return nil
}

// CeremonyContributePhase1 loads the latest Phase 1 state, adds a contribution,
// and saves the result as the next numbered file.
func CeremonyContributePhase1(dir string) error {
	p1Dir := filepath.Join(dir, "phase1")
	latest, num, err := latestFile(p1Dir, ".ph1")
	if err != nil {
		return fmt.Errorf("find latest phase1: %w", err)
	}

	p1 := new(mpcsetup.Phase1)
	if err := readFromFile(latest, p1); err != nil {
		return fmt.Errorf("load %s: %w", filepath.Base(latest), err)
	}

	p1.Contribute()

	nextNum := num + 1
	outPath := filepath.Join(p1Dir, fmt.Sprintf("%04d.ph1", nextNum))
	if err := writeToFile(outPath, p1); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(outPath), err)
	}

	fmt.Printf("Phase 1 contribution #%d saved: %s\n", nextNum, filepath.Base(outPath))
	return nil
}

// CeremonyContributePhase2 loads the latest Phase 2 state, adds a contribution,
// and saves the result as the next numbered file.
func CeremonyContributePhase2(dir string) error {
	p2Dir := filepath.Join(dir, "phase2")
	latest, num, err := latestFile(p2Dir, ".ph2")
	if err != nil {
		return fmt.Errorf("find latest phase2: %w", err)
	}

	p2 := new(mpcsetup.Phase2)
	if err := readFromFile(latest, p2); err != nil {
		return fmt.Errorf("load %s: %w", filepath.Base(latest), err)
	}

	p2.Contribute()

	nextNum := num + 1
	outPath := filepath.Join(p2Dir, fmt.Sprintf("%04d.ph2", nextNum))
	if err := writeToFile(outPath, p2); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(outPath), err)
	}

	fmt.Printf("Phase 2 contribution #%d saved: %s\n", nextNum, filepath.Base(outPath))
	return nil
}

// CeremonyVerifyPhase1 verifies all Phase 1 contributions form a valid chain.
func CeremonyVerifyPhase1(dir string) error {
	p1Dir := filepath.Join(dir, "phase1")
	files, err := listNumberedFiles(p1Dir, ".ph1")
	if err != nil {
		return err
	}
	if len(files) < 2 {
		return fmt.Errorf("need at least one contribution (found %d files)", len(files))
	}

	prev := new(mpcsetup.Phase1)
	if err := readFromFile(files[0], prev); err != nil {
		return fmt.Errorf("load %s: %w", filepath.Base(files[0]), err)
	}

	for i := 1; i < len(files); i++ {
		next := new(mpcsetup.Phase1)
		if err := readFromFile(files[i], next); err != nil {
			return fmt.Errorf("load %s: %w", filepath.Base(files[i]), err)
		}
		if err := prev.Verify(next); err != nil {
			return fmt.Errorf("contribution #%d (%s) invalid: %w", i, filepath.Base(files[i]), err)
		}
		fmt.Printf("  contribution #%d (%s): valid\n", i, filepath.Base(files[i]))
		prev = next
	}

	fmt.Printf("Phase 1: all %d contributions verified\n", len(files)-1)
	return nil
}

// CeremonyVerifyPhase2 verifies all Phase 2 contributions form a valid chain.
func CeremonyVerifyPhase2(dir string) error {
	p2Dir := filepath.Join(dir, "phase2")
	files, err := listNumberedFiles(p2Dir, ".ph2")
	if err != nil {
		return err
	}
	if len(files) < 2 {
		return fmt.Errorf("need at least one contribution (found %d files)", len(files))
	}

	prev := new(mpcsetup.Phase2)
	if err := readFromFile(files[0], prev); err != nil {
		return fmt.Errorf("load %s: %w", filepath.Base(files[0]), err)
	}

	for i := 1; i < len(files); i++ {
		next := new(mpcsetup.Phase2)
		if err := readFromFile(files[i], next); err != nil {
			return fmt.Errorf("load %s: %w", filepath.Base(files[i]), err)
		}
		if err := prev.Verify(next); err != nil {
			return fmt.Errorf("contribution #%d (%s) invalid: %w", i, filepath.Base(files[i]), err)
		}
		fmt.Printf("  contribution #%d (%s): valid\n", i, filepath.Base(files[i]))
		prev = next
	}

	fmt.Printf("Phase 2: all %d contributions verified\n", len(files)-1)
	return nil
}

// CeremonyFinalizePhase1 verifies all Phase 1 contributions, applies the beacon,
// and outputs the SRS. Then initializes Phase 2 for the circuit.
func CeremonyFinalizePhase1(dir string, beacon []byte) error {
	ccs, err := loadCeremCCS(dir)
	if err != nil {
		return err
	}
	domainSize := ecc.NextPowerOfTwo(uint64(ccs.GetNbConstraints()))

	// Load contributions (0001.ph1 onward, not the initial 0000.ph1)
	p1Dir := filepath.Join(dir, "phase1")
	files, err := listNumberedFiles(p1Dir, ".ph1")
	if err != nil {
		return err
	}
	if len(files) < 2 {
		return fmt.Errorf("need at least one contribution before finalizing")
	}

	contribs := make([]*mpcsetup.Phase1, len(files)-1)
	for i := 1; i < len(files); i++ {
		contribs[i-1] = new(mpcsetup.Phase1)
		if err := readFromFile(files[i], contribs[i-1]); err != nil {
			return fmt.Errorf("load %s: %w", filepath.Base(files[i]), err)
		}
	}

	fmt.Printf("Verifying %d Phase 1 contributions and applying beacon...\n", len(contribs))

	srs, err := mpcsetup.VerifyPhase1(domainSize, beacon, contribs...)
	if err != nil {
		return fmt.Errorf("phase 1 verification failed: %w", err)
	}

	if err := writeToFile(filepath.Join(dir, "srs.bin"), &srs); err != nil {
		return fmt.Errorf("write srs.bin: %w", err)
	}
	fmt.Println("Phase 1 finalized: srs.bin written")

	// Initialize Phase 2
	p2Dir := filepath.Join(dir, "phase2")
	if err := os.MkdirAll(p2Dir, 0o755); err != nil {
		return err
	}

	var p2 mpcsetup.Phase2
	p2.Initialize(ccs, &srs)

	if err := writeToFile(filepath.Join(p2Dir, "0000.ph2"), &p2); err != nil {
		return fmt.Errorf("write 0000.ph2: %w", err)
	}

	fmt.Println("Phase 2 initialized: phase2/0000.ph2 written")
	fmt.Println("Distribute phase2/0000.ph2 to the first contributor.")
	return nil
}

// CeremonyFinalizePhase2 verifies all Phase 2 contributions, applies the beacon,
// and extracts the final proving key and verifying key.
func CeremonyFinalizePhase2(dir string, beacon []byte, setupDir string) error {
	ccs, err := loadCeremCCS(dir)
	if err != nil {
		return err
	}

	srs := new(mpcsetup.SrsCommons)
	if err := readFromFile(filepath.Join(dir, "srs.bin"), srs); err != nil {
		return fmt.Errorf("load srs.bin: %w (run 'ceremony finalize -phase 1' first)", err)
	}

	// Load contributions (0001.ph2 onward)
	p2Dir := filepath.Join(dir, "phase2")
	files, err := listNumberedFiles(p2Dir, ".ph2")
	if err != nil {
		return err
	}
	if len(files) < 2 {
		return fmt.Errorf("need at least one contribution before finalizing")
	}

	contribs := make([]*mpcsetup.Phase2, len(files)-1)
	for i := 1; i < len(files); i++ {
		contribs[i-1] = new(mpcsetup.Phase2)
		if err := readFromFile(files[i], contribs[i-1]); err != nil {
			return fmt.Errorf("load %s: %w", filepath.Base(files[i]), err)
		}
	}

	fmt.Printf("Verifying %d Phase 2 contributions and applying beacon...\n", len(contribs))

	pk, vk, err := mpcsetup.VerifyPhase2(ccs, srs, beacon, contribs...)
	if err != nil {
		return fmt.Errorf("phase 2 verification failed: %w", err)
	}

	// Write keys to setup directory
	if err := os.MkdirAll(setupDir, 0o755); err != nil {
		return err
	}

	// Copy CCS to setup dir (needed by prove command)
	ccsSrc, err := os.ReadFile(filepath.Join(dir, "ccs.bin"))
	if err != nil {
		return fmt.Errorf("read ccs.bin: %w", err)
	}
	if err := os.WriteFile(filepath.Join(setupDir, "ccs.bin"), ccsSrc, 0o644); err != nil {
		return fmt.Errorf("copy ccs.bin to setup: %w", err)
	}

	if err := writeToFile(filepath.Join(setupDir, "pk.bin"), pk); err != nil {
		return fmt.Errorf("write pk.bin: %w", err)
	}
	if err := writeToFile(filepath.Join(setupDir, "vk.bin"), vk); err != nil {
		return fmt.Errorf("write vk.bin: %w", err)
	}

	if err := ExportVKOnly(vk, setupDir); err != nil {
		return fmt.Errorf("export vk.json: %w", err)
	}

	fmt.Printf("Phase 2 finalized. Keys written to %s/\n", setupDir)
	fmt.Println("You can now run: ./snark prove -setup", setupDir)
	return nil
}

// ---------- file helpers ----------

type writerable interface {
	WriteTo(io.Writer) (int64, error)
}

type readable interface {
	ReadFrom(io.Reader) (int64, error)
}

func writeToFile(path string, obj writerable) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = obj.WriteTo(f)
	return err
}

func readFromFile(path string, obj readable) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = obj.ReadFrom(f)
	return err
}

func loadCeremCCS(dir string) (*cs_bls12381.R1CS, error) {
	ccs := groth16.NewCS(ecc.BLS12_381)
	if err := readFromFile(filepath.Join(dir, "ccs.bin"), ccs); err != nil {
		return nil, fmt.Errorf("load ccs.bin: %w", err)
	}
	r1cs, ok := ccs.(*cs_bls12381.R1CS)
	if !ok {
		return nil, fmt.Errorf("unexpected constraint system type: %T", ccs)
	}
	return r1cs, nil
}

// listNumberedFiles returns all NNNN.ext files in dir, sorted by number.
func listNumberedFiles(dir, ext string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}

	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ext) {
			continue
		}
		numStr := strings.TrimSuffix(name, ext)
		if _, err := strconv.Atoi(numStr); err != nil {
			continue
		}
		files = append(files, filepath.Join(dir, name))
	}

	sort.Slice(files, func(i, j int) bool {
		return fileNum(files[i]) < fileNum(files[j])
	})
	return files, nil
}

func latestFile(dir, ext string) (string, int, error) {
	files, err := listNumberedFiles(dir, ext)
	if err != nil {
		return "", 0, err
	}
	if len(files) == 0 {
		return "", 0, fmt.Errorf("no %s files found in %s", ext, dir)
	}
	latest := files[len(files)-1]
	return latest, fileNum(latest), nil
}

func fileNum(path string) int {
	base := filepath.Base(path)
	dot := strings.LastIndex(base, ".")
	if dot < 0 {
		return 0
	}
	n, _ := strconv.Atoi(base[:dot])
	return n
}
