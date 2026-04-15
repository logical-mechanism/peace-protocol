// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"math/big"
	"reflect"

	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/hash_to_field"

	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
)

// ComputeCommitmentWire computes the commitment wire value as gnark does during verification.
// This is: hash_to_field(D.Marshal() || committed_publics.Marshal()) with DST "bsb22-commitment"
func ComputeCommitmentWire(
	proof *groth16bls.Proof,
	vk *groth16bls.VerifyingKey,
	publicWitness backend_witness.Witness,
) (string, error) {
	if len(proof.Commitments) == 0 || len(vk.PublicAndCommitmentCommitted) == 0 {
		return "", nil // No commitment extension
	}

	// Get public witness as Fr elements
	vecAny := publicWitness.Vector()
	if vecAny == nil {
		return "", fmt.Errorf("publicWitness.Vector() returned nil")
	}

	// Convert to []fr.Element
	var pubFr []fr.Element
	switch v := vecAny.(type) {
	case []fr.Element:
		pubFr = v
	default:
		// Try reflection to extract Fr elements
		rv := reflect.ValueOf(vecAny)
		if rv.Kind() != reflect.Slice {
			return "", fmt.Errorf("unexpected witness vector type: %T", vecAny)
		}
		pubFr = make([]fr.Element, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			ev := rv.Index(i)
			if ev.Kind() == reflect.Interface && !ev.IsNil() {
				ev = ev.Elem()
			}
			// Try to get the Fr element
			if ev.Type() == reflect.TypeOf(fr.Element{}) {
				pubFr[i] = ev.Interface().(fr.Element)
			} else {
				// Try BigInt method
				var bi big.Int
				m := ev.Addr().MethodByName("BigInt")
				if m.IsValid() {
					m.Call([]reflect.Value{reflect.ValueOf(&bi)})
					pubFr[i].SetBigInt(&bi)
				} else {
					return "", fmt.Errorf("cannot convert witness[%d] to Fr: type %T", i, ev.Interface())
				}
			}
		}
	}

	// Build the prehash: D.RawBytes() || committed_publics.Marshal()
	// gnark uses uncompressed point serialization (RawBytes, 96 bytes) for the hash
	// Note: We only process the first commitment (gnark's standard case)
	commitment := proof.Commitments[0]
	committedIndices := vk.PublicAndCommitmentCommitted[0]

	// Serialize commitment point
	// gnark uses Marshal() which returns RawBytes() = uncompressed form (96 bytes)
	commitmentBytes := commitment.Marshal()

	// Serialize committed public witnesses
	prehash := make([]byte, 0, len(commitmentBytes)+len(committedIndices)*32)
	prehash = append(prehash, commitmentBytes...)

	for _, idx := range committedIndices {
		// gnark uses 0-based indexing for public witnesses
		// But the indices in PublicAndCommitmentCommitted are 1-based (offset by 1)
		witnessIdx := idx - 1
		if witnessIdx < 0 || witnessIdx >= len(pubFr) {
			return "", fmt.Errorf("committed index %d out of range (witness len=%d)", idx, len(pubFr))
		}
		frBytes := pubFr[witnessIdx].Marshal()
		prehash = append(prehash, frBytes...)
	}

	// Use gnark's hash_to_field with the same DST as in constraint package
	hFunc := hash_to_field.New([]byte(constraint.CommitmentDst))
	hFunc.Write(prehash)

	// Hash returns bytes, convert to Fr element
	hashBytes := hFunc.Sum(nil)
	if len(hashBytes) == 0 {
		return "", fmt.Errorf("hash_to_field returned empty result")
	}

	var wire fr.Element
	wire.SetBytes(hashBytes)

	var wireBi big.Int
	wire.BigInt(&wireBi)
	return wireBi.String(), nil
}
