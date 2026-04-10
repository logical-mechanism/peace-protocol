// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"math/big"
	"reflect"

	"github.com/consensys/gnark/backend/groth16"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
)

// ExportProofBLS extracts the BLS12-381 Groth16 proof components (piA, piB, piC)
// and any Pedersen commitment extension fields (commitments and batched PoK),
// converting each curve point to compressed hex.
func ExportProofBLS(proof groth16.Proof) (ProofJSON, error) {
	p, ok := proof.(*groth16bls.Proof)
	if !ok {
		return ProofJSON{}, fmt.Errorf("unexpected proof type (need *groth16/bls12-381.Proof): %T", proof)
	}

	piA, err := G1CompressedHex(p.Ar)
	if err != nil {
		return ProofJSON{}, err
	}
	piB, err := G2CompressedHex(p.Bs)
	if err != nil {
		return ProofJSON{}, err
	}
	piC, err := G1CompressedHex(p.Krs)
	if err != nil {
		return ProofJSON{}, err
	}

	out := ProofJSON{PiA: piA, PiB: piB, PiC: piC}

	// export commitment extension fields (if present)
	if len(p.Commitments) > 0 {
		out.Commitments = make([]string, len(p.Commitments))
		for i := range p.Commitments {
			h, err := G1CompressedHex(p.Commitments[i])
			if err != nil {
				return ProofJSON{}, err
			}
			out.Commitments[i] = h
		}
		pok, err := G1CompressedHex(p.CommitmentPok)
		if err != nil {
			return ProofJSON{}, err
		}
		out.CommitmentPok = pok
	}

	return out, nil
}

// ExportVKBLS exports the verifying key with ALL IC elements (including commitment wire ICs).
func ExportVKBLS(vk groth16.VerifyingKey, nPublic int) (VKJSON, error) {
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}
	if nPublic < 0 {
		return VKJSON{}, fmt.Errorf("invalid nPublic: %d", nPublic)
	}
	if len(v.G1.K) < nPublic {
		return VKJSON{}, fmt.Errorf("vk IC too short: len(IC)=%d, need at least %d", len(v.G1.K), nPublic)
	}

	vkAlpha, err := G1CompressedHex(v.G1.Alpha)
	if err != nil {
		return VKJSON{}, err
	}
	vkBeta, err := G2CompressedHex(v.G2.Beta)
	if err != nil {
		return VKJSON{}, err
	}
	vkGamma, err := G2CompressedHex(v.G2.Gamma)
	if err != nil {
		return VKJSON{}, err
	}
	vkDelta, err := G2CompressedHex(v.G2.Delta)
	if err != nil {
		return VKJSON{}, err
	}

	// Export ALL IC elements (including commitment wire ICs)
	ic := make([]string, 0, len(v.G1.K))
	for i := 0; i < len(v.G1.K); i++ {
		h, err := G1CompressedHex(v.G1.K[i])
		if err != nil {
			return VKJSON{}, err
		}
		ic = append(ic, h)
	}

	out := VKJSON{
		NPublic: nPublic,
		VkAlpha: vkAlpha,
		VkBeta:  vkBeta,
		VkGamma: vkGamma,
		VkDelta: vkDelta,
		VkIC:    ic,
	}

	// export pedersen vk(s) used for the PoK check
	if len(v.CommitmentKeys) > 0 {
		out.CommitmentKeys = make([]CommitmentKeyJSON, len(v.CommitmentKeys))
		for i := range v.CommitmentKeys {
			g, err := G2CompressedHex(v.CommitmentKeys[i].G)
			if err != nil {
				return VKJSON{}, err
			}
			gs, err := G2CompressedHex(v.CommitmentKeys[i].GSigmaNeg)
			if err != nil {
				return VKJSON{}, err
			}
			out.CommitmentKeys[i] = CommitmentKeyJSON{G: g, GSigmaNeg: gs}
		}
	}

	// export public/commitment committed indices (needed for challenge computation)
	if len(v.PublicAndCommitmentCommitted) > 0 {
		out.PublicAndCommitmentCommitted = make([][]int, len(v.PublicAndCommitmentCommitted))
		for i := range v.PublicAndCommitmentCommitted {
			out.PublicAndCommitmentCommitted[i] = append([]int(nil), v.PublicAndCommitmentCommitted[i]...)
		}
	}

	return out, nil
}

// ExportPublicInputs returns the raw public vector from witness as decimal strings.
// This reflects gnark's exact public witness vector order.
func ExportPublicInputs(publicWitness backend_witness.Witness) ([]string, error) {
	vecAny := publicWitness.Vector()
	if vecAny == nil {
		return nil, fmt.Errorf("publicWitness.Vector() returned nil")
	}

	// Common cases first (avoid reflect when possible).
	switch v := vecAny.(type) {
	case []*big.Int:
		out := make([]string, len(v))
		for i := range v {
			if v[i] == nil {
				return nil, fmt.Errorf("public input[%d] is nil (*big.Int)", i)
			}
			out[i] = v[i].String()
		}
		return out, nil
	case []big.Int:
		out := make([]string, len(v))
		for i := range v {
			out[i] = new(big.Int).Set(&v[i]).String()
		}
		return out, nil
	case []string:
		// Already decimal strings.
		return append([]string(nil), v...), nil
	}

	// Reflection fallback: slice of elements with a BigInt(*big.Int) method,
	// or numeric-ish values convertible to *big.Int.
	rv := reflect.ValueOf(vecAny)
	if rv.Kind() != reflect.Slice {
		return nil, fmt.Errorf("unexpected publicWitness.Vector() type %T (not a slice)", vecAny)
	}

	out := make([]string, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		ev := rv.Index(i)

		// If it's an interface, unwrap.
		if ev.Kind() == reflect.Interface && !ev.IsNil() {
			ev = ev.Elem()
		}

		var bi big.Int

		// If it's *big.Int
		if ev.IsValid() && ev.Kind() == reflect.Ptr && ev.Type() == reflect.TypeOf(&big.Int{}) {
			ptr := ev.Interface().(*big.Int)
			if ptr == nil {
				return nil, fmt.Errorf("public input[%d] is nil (*big.Int)", i)
			}
			out[i] = ptr.String()
			continue
		}

		// If it's big.Int
		if ev.IsValid() && ev.Type() == reflect.TypeOf(big.Int{}) {
			val := ev.Interface().(big.Int)
			out[i] = val.String()
			continue
		}

		// Try BigInt(*big.Int) method (common for gnark-crypto field elements).
		var m reflect.Value
		if ev.CanAddr() {
			m = ev.Addr().MethodByName("BigInt")
		}
		if !m.IsValid() {
			m = ev.MethodByName("BigInt")
		}
		if m.IsValid() {
			mt := m.Type()
			// Bound method => expects exactly one arg: *big.Int
			if mt.NumIn() != 1 || mt.In(0) != reflect.TypeOf(&big.Int{}) {
				return nil, fmt.Errorf(
					"public input elem[%d] BigInt has unexpected signature %s (type %T)",
					i, mt.String(), ev.Interface(),
				)
			}
			m.Call([]reflect.Value{reflect.ValueOf(&bi)})
			out[i] = bi.String()
			continue
		}

		// Last-resort: integers that fit in signed/unsigned machine sizes.
		switch ev.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			bi.SetInt64(ev.Int())
			out[i] = bi.String()
			continue
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
			bi.SetUint64(ev.Uint())
			out[i] = bi.String()
			continue
		}

		return nil, fmt.Errorf("public input elem[%d] unsupported type %T (no BigInt method)", i, ev.Interface())
	}

	return out, nil
}

// ChoosePublicInputs returns the public input vector we should export such that
// it matches the verifying key IC length exactly:
//
//	len(IC) == len(pub)+1
//
// We handle common gnark variants:
//
//  1. pubRaw excludes the implicit "one-wire": len(IC) == len(pubRaw)+2
//     -> prepend "1" to pubRaw
//
//  2. pubRaw already includes a leading 0/1 "one-wire": len(IC) == len(pubRaw)+1
//     -> keep as-is
//
//  3. pubRaw includes an extra leading 0/1 beyond what IC expects: len(IC) == len(pubRaw)
//     -> drop the leading 0/1
func ChoosePublicInputs(pubRaw []string, icLen int) ([]string, error) {
	if icLen < 1 {
		return nil, fmt.Errorf("invalid vk IC length: %d", icLen)
	}
	if pubRaw == nil {
		pubRaw = nil
	}

	// Target invariant: len(IC) == len(pub)+1
	switch {
	// Perfect match already.
	case icLen == len(pubRaw)+1:
		return append([]string(nil), pubRaw...), nil

	// VK expects one more public than witness.Vector() gave us.
	// Most commonly that's the implicit "1" one-wire.
	case icLen == len(pubRaw)+2:
		pub := make([]string, 0, len(pubRaw)+1)
		pub = append(pub, "1")
		pub = append(pub, pubRaw...)
		return pub, nil

	// witness.Vector() may already include a leading 0/1 that VK does not count.
	case icLen == len(pubRaw):
		if len(pubRaw) > 0 && (pubRaw[0] == "0" || pubRaw[0] == "1") {
			return append([]string(nil), pubRaw[1:]...), nil
		}
		return nil, fmt.Errorf(
			"public inputs length mismatch: len(pubRaw)=%d, len(vk.IC)=%d (cannot reconcile)",
			len(pubRaw), icLen,
		)

	default:
		return nil, fmt.Errorf(
			"public inputs length mismatch: len(pubRaw)=%d, len(vk.IC)=%d (expected IC to be pub+1 or pub+2)",
			len(pubRaw), icLen,
		)
	}
}
