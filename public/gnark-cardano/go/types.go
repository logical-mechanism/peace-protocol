// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

// Package main provides a CLI toolkit for exporting gnark Groth16 proofs
// to Cardano/Aiken-compatible formats (BLS12-381 curve).
package main

// ---------- JSON shapes ----------

// CommitmentKeyJSON represents a Pedersen commitment key pair used for
// the gnark commitment extension's proof-of-knowledge check.
type CommitmentKeyJSON struct {
	G         string `json:"g"`         // G2 compressed hex
	GSigmaNeg string `json:"gSigmaNeg"` // G2 compressed hex (called GRootSigmaNeg in some writeups)
}

// VKJSON is the JSON-serializable form of a BLS12-381 Groth16 verifying key,
// including the commitment extension fields used by gnark.
type VKJSON struct {
	NPublic        int                 `json:"nPublic"`
	VkAlpha        string              `json:"vkAlpha"` // G1 compressed hex
	VkBeta         string              `json:"vkBeta"`  // G2 compressed hex
	VkGamma        string              `json:"vkGamma"` // G2 compressed hex
	VkDelta        string              `json:"vkDelta"` // G2 compressed hex
	VkIC           []string            `json:"vkIC"`    // list of G1 compressed hex (len = nPublic+1)
	CommitmentKeys []CommitmentKeyJSON `json:"commitmentKeys,omitempty"`
	// PublicAndCommitmentCommitted maps each commitment to the indices of public
	// inputs that were committed. Used to compute the hash challenge during verification.
	PublicAndCommitmentCommitted [][]int `json:"publicAndCommitmentCommitted,omitempty"`
}

// ProofJSON is the JSON-serializable form of a BLS12-381 Groth16 proof,
// including the Pedersen commitment extension fields.
type ProofJSON struct {
	PiA           string   `json:"piA"`                     // G1 compressed hex
	PiB           string   `json:"piB"`                     // G2 compressed hex
	PiC           string   `json:"piC"`                     // G1 compressed hex
	Commitments   []string `json:"commitments,omitempty"`   // each is G1 compressed hex (D_i)
	CommitmentPok string   `json:"commitmentPok,omitempty"` // G1 compressed hex (batched PoK)
}

// PublicJSON is the JSON-serializable form of the public inputs and
// commitment wire value.
type PublicJSON struct {
	Inputs         []string `json:"inputs"`                   // decimal strings in Fr
	CommitmentWire string   `json:"commitmentWire,omitempty"` // the computed commitment wire value (decimal Fr)
}
