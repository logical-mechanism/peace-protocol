// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/consensys/gnark-crypto/ecc"

	"github.com/consensys/gnark/backend/groth16"
	backend_witness "github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
)

// SaveNativeFiles writes gnark's native binary serialization of VK, Proof, and public witness.
// These files can be loaded later for standalone verification without recompiling the circuit.
func SaveNativeFiles(vk groth16.VerifyingKey, proof groth16.Proof, publicWitness backend_witness.Witness, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Write VK
	vkFile, err := os.Create(filepath.Join(dir, "vk.bin"))
	if err != nil {
		return fmt.Errorf("create vk.bin: %w", err)
	}
	defer vkFile.Close()
	if _, err := vk.WriteTo(vkFile); err != nil {
		return fmt.Errorf("write vk.bin: %w", err)
	}

	// Write Proof
	proofFile, err := os.Create(filepath.Join(dir, "proof.bin"))
	if err != nil {
		return fmt.Errorf("create proof.bin: %w", err)
	}
	defer proofFile.Close()
	if _, err := proof.WriteTo(proofFile); err != nil {
		return fmt.Errorf("write proof.bin: %w", err)
	}

	// Write public witness
	witnessFile, err := os.Create(filepath.Join(dir, "witness.bin"))
	if err != nil {
		return fmt.Errorf("create witness.bin: %w", err)
	}
	defer witnessFile.Close()
	if _, err := publicWitness.WriteTo(witnessFile); err != nil {
		return fmt.Errorf("write witness.bin: %w", err)
	}

	return nil
}

// VerifyFromFiles loads VK, Proof, and public witness from binary files and verifies.
func VerifyFromFiles(dir string) error {
	// Load VK
	vkFile, err := os.Open(filepath.Join(dir, "vk.bin"))
	if err != nil {
		return fmt.Errorf("open vk.bin: %w", err)
	}
	defer vkFile.Close()

	vk := groth16.NewVerifyingKey(ecc.BLS12_381)
	if _, err := vk.ReadFrom(vkFile); err != nil {
		return fmt.Errorf("read vk.bin: %w", err)
	}

	// Load Proof
	proofFile, err := os.Open(filepath.Join(dir, "proof.bin"))
	if err != nil {
		return fmt.Errorf("open proof.bin: %w", err)
	}
	defer proofFile.Close()

	proof := groth16.NewProof(ecc.BLS12_381)
	if _, err := proof.ReadFrom(proofFile); err != nil {
		return fmt.Errorf("read proof.bin: %w", err)
	}

	// Load public witness
	witnessFile, err := os.Open(filepath.Join(dir, "witness.bin"))
	if err != nil {
		return fmt.Errorf("open witness.bin: %w", err)
	}
	defer witnessFile.Close()

	witness, err := backend_witness.New(ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("new witness: %w", err)
	}
	if _, err := witness.ReadFrom(witnessFile); err != nil {
		return fmt.Errorf("read witness.bin: %w", err)
	}

	// Verify using gnark's built-in verification
	if err := groth16.Verify(proof, vk, witness); err != nil {
		return fmt.Errorf("verification failed: %w", err)
	}

	return nil
}

// SaveSetupFiles writes the compiled constraint system, proving key, and verifying key.
// These files are generated once during setup and reused for all future proofs.
func SaveSetupFiles(ccs constraint.ConstraintSystem, pk groth16.ProvingKey, vk groth16.VerifyingKey, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Write CCS (compiled constraint system)
	ccsFile, err := os.Create(filepath.Join(dir, "ccs.bin"))
	if err != nil {
		return fmt.Errorf("create ccs.bin: %w", err)
	}
	defer ccsFile.Close()
	if _, err := ccs.WriteTo(ccsFile); err != nil {
		return fmt.Errorf("write ccs.bin: %w", err)
	}

	// Write PK (proving key)
	pkFile, err := os.Create(filepath.Join(dir, "pk.bin"))
	if err != nil {
		return fmt.Errorf("create pk.bin: %w", err)
	}
	defer pkFile.Close()
	if _, err := pk.WriteTo(pkFile); err != nil {
		return fmt.Errorf("write pk.bin: %w", err)
	}

	// Write VK (verifying key)
	vkFile, err := os.Create(filepath.Join(dir, "vk.bin"))
	if err != nil {
		return fmt.Errorf("create vk.bin: %w", err)
	}
	defer vkFile.Close()
	if _, err := vk.WriteTo(vkFile); err != nil {
		return fmt.Errorf("write vk.bin: %w", err)
	}

	return nil
}

// LoadSetupFiles loads the compiled constraint system, proving key, and verifying key from disk.
func LoadSetupFiles(dir string) (constraint.ConstraintSystem, groth16.ProvingKey, groth16.VerifyingKey, error) {
	// Load CCS
	ccsFile, err := os.Open(filepath.Join(dir, "ccs.bin"))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open ccs.bin: %w", err)
	}
	defer ccsFile.Close()

	ccs := groth16.NewCS(ecc.BLS12_381)
	if _, err := ccs.ReadFrom(ccsFile); err != nil {
		return nil, nil, nil, fmt.Errorf("read ccs.bin: %w", err)
	}

	// Load PK
	pkFile, err := os.Open(filepath.Join(dir, "pk.bin"))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open pk.bin: %w", err)
	}
	defer pkFile.Close()

	pk := groth16.NewProvingKey(ecc.BLS12_381)
	if _, err := pk.ReadFrom(pkFile); err != nil {
		return nil, nil, nil, fmt.Errorf("read pk.bin: %w", err)
	}

	// Load VK
	vkFile, err := os.Open(filepath.Join(dir, "vk.bin"))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("open vk.bin: %w", err)
	}
	defer vkFile.Close()

	vk := groth16.NewVerifyingKey(ecc.BLS12_381)
	if _, err := vk.ReadFrom(vkFile); err != nil {
		return nil, nil, nil, fmt.Errorf("read vk.bin: %w", err)
	}

	return ccs, pk, vk, nil
}

// SetupFilesExist checks if all setup files exist in the given directory.
func SetupFilesExist(dir string) bool {
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}
