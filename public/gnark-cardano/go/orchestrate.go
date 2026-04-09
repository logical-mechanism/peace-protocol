// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/consensys/gnark-crypto/ecc"

	"github.com/consensys/gnark/backend/groth16"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
)

// ExportAll exports proof, public inputs, and VK to JSON files in the given directory.
// This is the main export entrypoint used after proof generation.
func ExportAll(vk groth16.VerifyingKey, proof groth16.Proof, publicWitness backend_witness.Witness, dir string) error {
	// 1) Export proof.
	pj, err := ExportProofBLS(proof)
	if err != nil {
		return err
	}

	// 2) Export raw publics (ground truth from witness.Vector()).
	pubRaw, err := ExportPublicInputs(publicWitness)
	if err != nil {
		return err
	}

	// 3) Determine IC length from VK.
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}
	if len(v.G1.K) < 1 {
		return fmt.Errorf("invalid vk: IC empty")
	}
	icLen := len(v.G1.K)

	// 4) Choose which publics to export (must match IC length semantics).
	pub, err := ChoosePublicInputs(pubRaw, icLen)
	if err != nil {
		return err
	}

	// With commitment extension, IC length = nRawPublic + 1 + nCommitments
	nRawPublic := len(pubRaw)
	nCommitments := len(v.CommitmentKeys)
	expectedICLen := nRawPublic + 1 + nCommitments
	if icLen != expectedICLen {
		return fmt.Errorf(
			"export invariant failed: len(vk.IC)=%d but expected %d (nRawPublic=%d, nCommitments=%d)",
			icLen, expectedICLen, nRawPublic, nCommitments,
		)
	}

	// nPublic follows the Aiken convention: includes the implicit "1" wire.
	// len(IC) = nPublic + nCommitments, so nPublic = len(IC) - nCommitments.
	nPublic := icLen - nCommitments

	// 5) Export VK with nPublic matching the Aiken convention.
	vkj, err := ExportVKBLS(vk, nPublic)
	if err != nil {
		return err
	}

	// 6) Final consistency checks.
	if len(vkj.VkIC) != expectedICLen {
		return fmt.Errorf("IC length mismatch: len(IC)=%d, expected %d", len(vkj.VkIC), expectedICLen)
	}

	// 7) Write JSONs.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	writeJSON := func(name string, val interface{}) error {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		defer f.Close()
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		return enc.Encode(val)
	}

	if err := writeJSON("vk.json", vkj); err != nil {
		return err
	}
	if err := writeJSON("proof.json", pj); err != nil {
		return err
	}

	// 8) Compute commitment wire if applicable
	p, ok := proof.(*groth16bls.Proof)
	if !ok {
		return fmt.Errorf("unexpected proof type: %T", proof)
	}
	commitmentWire, err := ComputeCommitmentWire(p, v, publicWitness)
	if err != nil {
		return fmt.Errorf("compute commitment wire: %w", err)
	}

	if err := writeJSON("public.json", PublicJSON{Inputs: pub, CommitmentWire: commitmentWire}); err != nil {
		return err
	}

	return nil
}

// ExportVKOnly exports the verifying key to vk.json without needing a proof or witness.
// This is useful for getting the constant VK immediately after setup.
func ExportVKOnly(vk groth16.VerifyingKey, dir string) error {
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}

	// Calculate nPublic from VK structure (Aiken convention: includes implicit "1" wire)
	// len(IC) = nPublic + nCommitments
	nCommitments := len(v.CommitmentKeys)
	nPublic := len(v.G1.K) - nCommitments

	if nPublic < 1 {
		return fmt.Errorf("invalid vk: nPublic=%d (IC=%d, commitments=%d)", nPublic, len(v.G1.K), nCommitments)
	}

	vkj, err := ExportVKBLS(vk, nPublic)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	f, err := os.Create(filepath.Join(dir, "vk.json"))
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(vkj)
}

// ReExportJSON loads VK, Proof, and public witness from binary files and re-exports JSON files.
func ReExportJSON(dir string) error {
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

	// Re-export JSON files
	return ExportAll(vk, proof, witness, dir)
}
