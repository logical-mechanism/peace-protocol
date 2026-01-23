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

	"github.com/consensys/gnark-crypto/ecc"
	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/hash_to_field"

	"github.com/consensys/gnark/backend/groth16"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
)

// Note: math/big and reflect are used by exportPublicInputs for handling
// different public witness vector types returned by gnark.

// ---------- JSON shapes ----------

type CommitmentKeyJSON struct {
	G         string `json:"g"`         // G2 compressed hex
	GSigmaNeg string `json:"gSigmaNeg"` // G2 compressed hex (called GRootSigmaNeg in some writeups)
}

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
	// PublicAndCommitmentCommitted[i] = indices of public inputs for commitment i.
	PublicAndCommitmentCommitted [][]int `json:"publicAndCommitmentCommitted,omitempty"`
}

type ProofJSON struct {
	PiA           string   `json:"piA"`                     // G1 compressed hex
	PiB           string   `json:"piB"`                     // G2 compressed hex
	PiC           string   `json:"piC"`                     // G1 compressed hex
	Commitments   []string `json:"commitments,omitempty"`   // each is G1 compressed hex (D_i)
	CommitmentPok string   `json:"commitmentPok,omitempty"` // G1 compressed hex (batched PoK)
}

type PublicJSON struct {
	Inputs         []string `json:"inputs"`                   // decimal strings in Fr
	CommitmentWire string   `json:"commitmentWire,omitempty"` // the computed commitment wire value (decimal Fr)
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

	out := ProofJSON{PiA: piA, PiB: piB, PiC: piC}

	// export commitment extension fields (if present)
	if len(p.Commitments) > 0 {
		out.Commitments = make([]string, len(p.Commitments))
		for i := range p.Commitments {
			h, err := g1CompressedHex(p.Commitments[i])
			if err != nil {
				return ProofJSON{}, err
			}
			out.Commitments[i] = h
		}
		pok, err := g1CompressedHex(p.CommitmentPok)
		if err != nil {
			return ProofJSON{}, err
		}
		out.CommitmentPok = pok
	}

	return out, nil
}

// exportVKBLS exports the verifying key with ALL IC elements (including commitment wire ICs).
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

	// Export ALL IC elements (including commitment wire ICs)
	ic := make([]string, 0, len(v.G1.K))
	for i := 0; i < len(v.G1.K); i++ {
		h, err := g1CompressedHex(v.G1.K[i])
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
			g, err := g2CompressedHex(v.CommitmentKeys[i].G)
			if err != nil {
				return VKJSON{}, err
			}
			gs, err := g2CompressedHex(v.CommitmentKeys[i].GSigmaNeg)
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

// choosePublicInputs returns the public input vector we should export such that
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
func choosePublicInputs(pubRaw []string, icLen int) ([]string, error) {
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

// ---------- commitment wire computation ----------

// computeCommitmentWire computes the commitment wire value as gnark does during verification.
// This is: hash_to_field(D.Marshal() || committed_publics.Marshal()) with DST "bsb22-commitment"
func computeCommitmentWire(
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
	for i, commitment := range proof.Commitments {
		if i >= len(vk.PublicAndCommitmentCommitted) {
			break
		}

		// Serialize commitment point
		// gnark uses Marshal() which returns RawBytes() = uncompressed form (96 bytes)
		commitmentBytes := commitment.Marshal()

		// Serialize committed public witnesses
		committedIndices := vk.PublicAndCommitmentCommitted[i]
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

	return "", nil
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
	pub, err := choosePublicInputs(pubRaw, icLen)
	if err != nil {
		return err
	}
	nPublic := len(pub)

	// With commitment extension, IC length = nRawPublic + 1 + nCommitments
	// where nRawPublic is the original circuit's public input count (before any "1" is prepended)
	// The "1" added by choosePublicInputs is just for export format, not an actual IC element.
	nRawPublic := len(pubRaw)
	nCommitments := len(v.CommitmentKeys)
	expectedICLen := nRawPublic + 1 + nCommitments
	if icLen != expectedICLen {
		return fmt.Errorf(
			"export invariant failed: len(vk.IC)=%d but expected %d (nRawPublic=%d, nCommitments=%d)",
			icLen, expectedICLen, nRawPublic, nCommitments,
		)
	}

	// 5) Export VK sliced to nPublic+1 (matches the exported public vector).
	vkj, err := exportVKBLS(vk, nPublic)
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
	commitmentWire, err := computeCommitmentWire(p, v, publicWitness)
	if err != nil {
		return fmt.Errorf("compute commitment wire: %w", err)
	}

	if err := writeJSON("public.json", PublicJSON{Inputs: pub, CommitmentWire: commitmentWire}); err != nil {
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

// ---------- native binary save/load for standalone verification ----------

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

// ---------- setup file save/load for production workflow ----------

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
// Returns (ccs, pk, vk, error).
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

// ExportVKOnly exports the verifying key to vk.json without needing a proof or witness.
// This is useful for getting the constant VK immediately after setup.
func ExportVKOnly(vk groth16.VerifyingKey, dir string) error {
	v, ok := vk.(*groth16bls.VerifyingKey)
	if !ok {
		return fmt.Errorf("unexpected vk type (need *groth16/bls12-381.VerifyingKey): %T", vk)
	}

	// Calculate nPublic from VK structure
	// len(IC) = nPublic + nCommitments, so nPublic = len(IC) - nCommitments
	nCommitments := len(v.CommitmentKeys)
	nPublic := len(v.G1.K) - nCommitments

	if nPublic < 1 {
		return fmt.Errorf("invalid vk: nPublic=%d (IC=%d, commitments=%d)", nPublic, len(v.G1.K), nCommitments)
	}

	vkj, err := exportVKBLS(vk, nPublic)
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

// SetupFilesExist checks if all setup files exist in the given directory.
func SetupFilesExist(dir string) bool {
	for _, name := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
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
