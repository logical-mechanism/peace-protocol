// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only
//
// export.go

package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"reflect"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"

	"github.com/consensys/gnark/backend/groth16"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
)

// ---------- JSON shapes ----------

type VKJSON struct {
	NPublic int      `json:"nPublic"`
	VkAlpha string   `json:"vkAlpha"` // G1 compressed hex
	VkBeta  string   `json:"vkBeta"`  // G2 compressed hex
	VkGamma string   `json:"vkGamma"` // G2 compressed hex
	VkDelta string   `json:"vkDelta"` // G2 compressed hex
	VkIC    []string `json:"vkIC"`    // list of G1 compressed hex (len = nPublic+1)
}

type ProofJSON struct {
	PiA string `json:"piA"` // G1 compressed hex
	PiB string `json:"piB"` // G2 compressed hex
	PiC string `json:"piC"` // G1 compressed hex
}

type PublicJSON struct {
	Inputs []string `json:"inputs"` // decimal strings in Fr
}

// ---------- extract proof/vk using concrete BLS12-381 Groth16 types ----------

func exportProofBLS(proof groth16.Proof) (ProofJSON, error) {
	p, ok := proof.(*groth16bls.Proof)
	if !ok {
		return ProofJSON{}, fmt.Errorf("unexpected proof type (need *groth16/bls12-381.Proof): %T", proof)
	}

	piA, err := g1CompressedHex(p.Ar)
	if err != nil {
		return ProofJSON{}, err
	}
	piB, err := g2CompressedHex(p.Bs)
	if err != nil {
		return ProofJSON{}, err
	}
	piC, err := g1CompressedHex(p.Krs)
	if err != nil {
		return ProofJSON{}, err
	}

	return ProofJSON{PiA: piA, PiB: piB, PiC: piC}, nil
}

// exportVKBLS exports the verifying key, slicing IC to exactly nPublic+1.
func exportVKBLS(vk groth16.VerifyingKey, nPublic int) (VKJSON, error) {
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}
	if nPublic < 0 {
		return VKJSON{}, fmt.Errorf("invalid nPublic: %d", nPublic)
	}
	if len(v.G1.K) < nPublic+1 {
		return VKJSON{}, fmt.Errorf("vk IC too short: len(IC)=%d, need at least %d", len(v.G1.K), nPublic+1)
	}

	vkAlpha, err := g1CompressedHex(v.G1.Alpha)
	if err != nil {
		return VKJSON{}, err
	}
	vkBeta, err := g2CompressedHex(v.G2.Beta)
	if err != nil {
		return VKJSON{}, err
	}
	vkGamma, err := g2CompressedHex(v.G2.Gamma)
	if err != nil {
		return VKJSON{}, err
	}
	vkDelta, err := g2CompressedHex(v.G2.Delta)
	if err != nil {
		return VKJSON{}, err
	}

	ic := make([]string, 0, nPublic+1)
	for i := 0; i < nPublic+1; i++ {
		h, err := g1CompressedHex(v.G1.K[i])
		if err != nil {
			return VKJSON{}, err
		}
		ic = append(ic, h)
	}

	return VKJSON{
		NPublic: nPublic,
		VkAlpha: vkAlpha,
		VkBeta:  vkBeta,
		VkGamma: vkGamma,
		VkDelta: vkDelta,
		VkIC:    ic,
	}, nil
}

// ---------- public inputs extraction ----------

// exportPublicInputs returns the raw public vector from witness as decimal strings.
// This MUST reflect gnark's exact public witness vector order.
func exportPublicInputs(publicWitness backend_witness.Witness) ([]string, error) {
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

// choosePublicInputs picks what to export as "public inputs" and ensures they
// can be represented by the VK IC (capacity = len(IC)-1).
//
// Accepts:
//   - pubRaw length <= icCap
//   - or pubRaw length == icCap+1 with leading 0/1 “one-wire” (drops it)
func choosePublicInputs(pubRaw []string, icCap int) ([]string, error) {
	if icCap < 0 {
		return nil, fmt.Errorf("invalid vk IC capacity: %d", icCap)
	}

	pub := pubRaw

	// If there is a leading 0/1 and dropping it helps fit within IC capacity, drop it.
	if len(pubRaw) > 0 && (pubRaw[0] == "0" || pubRaw[0] == "1") {
		if len(pubRaw)-1 <= icCap {
			pub = pubRaw[1:]
		}
	}

	if len(pub) > icCap {
		return nil, fmt.Errorf(
			"public inputs too long: got %d, but vk.IC capacity is %d",
			len(pub), icCap,
		)
	}

	return pub, nil
}

// ---------- main export ----------

func ExportAll(vk groth16.VerifyingKey, proof groth16.Proof, publicWitness backend_witness.Witness, dir string) error {
	// 1) Export proof.
	pj, err := exportProofBLS(proof)
	if err != nil {
		return err
	}

	// 2) Export raw publics (ground truth from witness.Vector()).
	pubRaw, err := exportPublicInputs(publicWitness)
	if err != nil {
		return err
	}

	// 3) Determine IC capacity from VK (this is what Groth16 expects).
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}
	if len(v.G1.K) < 1 {
		return fmt.Errorf("invalid vk: IC empty")
	}
	icCap := len(v.G1.K) - 1

	// 4) Choose which publics to export (must fit IC capacity exactly).
	pub, err := choosePublicInputs(pubRaw, icCap)
	if err != nil {
		return err
	}
	nPublic := len(pub)

	// 5) Export VK sliced to nPublic+1 (matches the exported public vector).
	vkj, err := exportVKBLS(vk, nPublic)
	if err != nil {
		return err
	}

	// 6) Final consistency checks.
	if len(vkj.VkIC) != nPublic+1 {
		return fmt.Errorf("IC length mismatch: len(IC)=%d, expected %d", len(vkj.VkIC), nPublic+1)
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
	if err := writeJSON("public.json", PublicJSON{Inputs: pub}); err != nil {
		return err
	}

	return nil
}

// ---------- compression helpers ----------

func g1CompressedHex(p bls12381.G1Affine) (string, error) {
	b := p.Bytes() // 48 bytes compressed (IETF)
	if len(b) != 48 {
		return "", fmt.Errorf("unexpected G1 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}

func g2CompressedHex(p bls12381.G2Affine) (string, error) {
	b := p.Bytes() // 96 bytes compressed (IETF)
	if len(b) != 96 {
		return "", fmt.Errorf("unexpected G2 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}
