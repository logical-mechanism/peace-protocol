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
	blsfr "github.com/consensys/gnark-crypto/ecc/bls12-381/fr"

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
func exportPublicInputs(publicWitness backend_witness.Witness) ([]string, error) {
	vecAny := publicWitness.Vector()
	if vecAny == nil {
		return nil, fmt.Errorf("publicWitness.Vector() returned nil")
	}

	// Fast paths.
	switch v := vecAny.(type) {
	case []blsfr.Element:
		out := make([]string, 0, len(v))
		for i := range v {
			var bi big.Int
			v[i].BigInt(&bi)
			out = append(out, bi.String())
		}
		return out, nil
	case blsfr.Vector: // usually Vector is []Element
		out := make([]string, 0, len(v))
		for i := range v {
			var bi big.Int
			v[i].BigInt(&bi)
			out = append(out, bi.String())
		}
		return out, nil
	}

	// Reflection fallback.
	rv := reflect.ValueOf(vecAny)
	if rv.Kind() != reflect.Slice {
		return nil, fmt.Errorf("unexpected publicWitness.Vector() type %T (not a slice)", vecAny)
	}

	out := make([]string, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		ev := rv.Index(i)

		var bi big.Int

		var m reflect.Value
		if ev.CanAddr() {
			m = ev.Addr().MethodByName("BigInt")
		}
		if !m.IsValid() {
			m = ev.MethodByName("BigInt")
		}
		if !m.IsValid() {
			return nil, fmt.Errorf("public input elem[%d] type %T has no BigInt method", i, ev.Interface())
		}

		mt := m.Type()
		if mt.NumIn() != 1 || mt.In(0) != reflect.TypeOf(&big.Int{}) {
			return nil, fmt.Errorf(
				"public input elem[%d] BigInt has unexpected signature %s (type %T)",
				i, mt.String(), ev.Interface(),
			)
		}

		m.Call([]reflect.Value{reflect.ValueOf(&bi)})
		out[i] = bi.String()
	}

	return out, nil
}

// choosePublicInputs picks what to export as "public inputs" and ensures they
// can be represented by the VK IC (capacity = len(IC)-1).
//
// We support both witness shapes:
//   - pubRaw has exactly nbPublic entries
//   - pubRaw has a leading 0/1 “one-wire” entry (then we drop it)
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

	// 2) Export raw publics.
	pubRaw, err := exportPublicInputs(publicWitness)
	if err != nil {
		return err
	}

	// 3) Determine IC capacity from VK.
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}
	if len(v.G1.K) < 1 {
		return fmt.Errorf("invalid vk: IC empty")
	}
	icCap := len(v.G1.K) - 1

	// 4) Choose which publics to export (and ensure they fit in IC capacity).
	pub, err := choosePublicInputs(pubRaw, icCap)
	if err != nil {
		return err
	}
	nPublic := len(pub)

	// 5) Export VK sliced to nPublic+1.
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
	b := p.Bytes() // 48 bytes compressed
	if len(b) != 48 {
		return "", fmt.Errorf("unexpected G1 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}

func g2CompressedHex(p bls12381.G2Affine) (string, error) {
	b := p.Bytes() // 96 bytes compressed
	if len(b) != 96 {
		return "", fmt.Errorf("unexpected G2 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}
