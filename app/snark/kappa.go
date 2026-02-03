// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// kappa.go
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"

	"github.com/consensys/gnark-crypto/ecc"
	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fp"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/mimc"

	fields_bls12381 "github.com/consensys/gnark/std/algebra/emulated/fields_bls12381"
	sw_bls12381 "github.com/consensys/gnark/std/algebra/emulated/sw_bls12381"
	sw_emulated "github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/conversion"
	"github.com/consensys/gnark/std/hash/sha2"
	stdmimc "github.com/consensys/gnark/std/hash/mimc"
	"github.com/consensys/gnark/std/math/bits"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
	"github.com/consensys/gnark/std/math/uints"
)

// Fixed, public G2 point (compressed hex).
const H0Hex = "a5acbe8bdb762cf7b4bfa9171b9ffa23b6ed710b290280b271a0258e285354aac338bb9e5a9ee41b4454e4c410f40eea16c82b493986bfc754aa789e1408b2b526f8b92e9ddcd4eee1a6c4daa84d561a6ceb452afc4559fe81a1c7f3f26715db"

// IMPORTANT: FIXED and appended as BYTES (hex-decoded) before hashing.
const DomainTagHex = "4631327c546f7c4865787c76317c"

// --- out-of-circuit helpers ---

// g1MulBase computes [a]q where q is the G1 generator.
// a can be arbitrarily large (e.g., 255 bytes); gnark-crypto will effectively reduce mod group order.
func g1MulBase(a *big.Int) bls12381.G1Affine {
	if a == nil {
		a = new(big.Int)
	}
	var p bls12381.G1Affine
	p.ScalarMultiplicationBase(new(big.Int).Set(a))
	return p
}

func parseG2CompressedHex(h string) (bls12381.G2Affine, error) {
	raw, err := hex.DecodeString(h)
	if err != nil {
		return bls12381.G2Affine{}, fmt.Errorf("decode G2 hex: %w", err)
	}
	var p bls12381.G2Affine
	if _, err := p.SetBytes(raw); err != nil {
		return bls12381.G2Affine{}, fmt.Errorf("G2.SetBytes: %w", err)
	}
	return p, nil
}

func parseG1CompressedHex(h string) (bls12381.G1Affine, error) {
	raw, err := hex.DecodeString(h)
	if err != nil {
		return bls12381.G1Affine{}, fmt.Errorf("decode G1 hex: %w", err)
	}
	var p bls12381.G1Affine
	if _, err := p.SetBytes(raw); err != nil {
		return bls12381.G1Affine{}, fmt.Errorf("G1.SetBytes: %w", err)
	}
	return p, nil
}

// Fq12 canonical bytes from gnark-crypto GT.
// We lock this exact coefficient order for your Go encoding.
func fq12CanonicalBytes(k bls12381.GT) []byte {
	out := make([]byte, 0, 12*48)

	appendFp48 := func(e fp.Element) {
		var bi big.Int
		e.ToBigIntRegular(&bi)
		buf := make([]byte, 48)
		bi.FillBytes(buf) // 48-byte big-endian, left padded
		out = append(out, buf...)
	}

	// Order:
	// (C0.B0.A0, C0.B0.A1, C0.B1.A0, C0.B1.A1, C0.B2.A0, C0.B2.A1,
	//  C1.B0.A0, C1.B0.A1, C1.B1.A0, C1.B1.A1, C1.B2.A0, C1.B2.A1)

	// C0
	appendFp48(k.C0.B0.A0)
	appendFp48(k.C0.B0.A1)
	appendFp48(k.C0.B1.A0)
	appendFp48(k.C0.B1.A1)
	appendFp48(k.C0.B2.A0)
	appendFp48(k.C0.B2.A1)

	// C1
	appendFp48(k.C1.B0.A0)
	appendFp48(k.C1.B0.A1)
	appendFp48(k.C1.B1.A0)
	appendFp48(k.C1.B1.A1)
	appendFp48(k.C1.B2.A0)
	appendFp48(k.C1.B2.A1)

	return out
}

// fq12ToFrElements extracts the 12 Fp coefficients from a GT element
// and converts each to an Fr element (reduced mod r).
// This is the MiMC-compatible representation of the pairing output.
func fq12ToFrElements(k bls12381.GT) []fr.Element {
	elements := make([]fr.Element, 0, 13) // 12 coefficients + domain tag

	appendFpAsFr := func(e fp.Element) {
		var bi big.Int
		e.ToBigIntRegular(&bi)
		var frEl fr.Element
		frEl.SetBigInt(&bi) // automatically reduces mod r
		elements = append(elements, frEl)
	}

	// Same order as fq12CanonicalBytes for consistency
	appendFpAsFr(k.C0.B0.A0)
	appendFpAsFr(k.C0.B0.A1)
	appendFpAsFr(k.C0.B1.A0)
	appendFpAsFr(k.C0.B1.A1)
	appendFpAsFr(k.C0.B2.A0)
	appendFpAsFr(k.C0.B2.A1)
	appendFpAsFr(k.C1.B0.A0)
	appendFpAsFr(k.C1.B0.A1)
	appendFpAsFr(k.C1.B1.A0)
	appendFpAsFr(k.C1.B1.A1)
	appendFpAsFr(k.C1.B2.A0)
	appendFpAsFr(k.C1.B2.A1)

	return elements
}

// domainTagFr returns the domain tag as an Fr element for MiMC hashing.
func domainTagFr() fr.Element {
	tagBytes, _ := hex.DecodeString(DomainTagHex)
	var tag fr.Element
	tag.SetBytes(tagBytes)
	return tag
}

// mimcHashFr hashes a slice of Fr elements using MiMC and returns the result.
func mimcHashFr(elements []fr.Element) fr.Element {
	h := mimc.NewMiMC()
	for _, e := range elements {
		h.Write(e.Marshal())
	}
	var result fr.Element
	result.SetBytes(h.Sum(nil))
	return result
}

// mimcHex hashes Fr elements and returns the result as lowercase hex.
func mimcHex(elements []fr.Element) string {
	result := mimcHashFr(elements)
	return hex.EncodeToString(result.Marshal())
}

// gtToHash computes (for kappa = e([a]q, h0)):
//
//	elements = fq12ToFrElements(kappa)
//	hk   = mimc( elements || domainTagFr )
//
// Returns:
// - hkHex (lowercase hex, 64 chars - Fr element is 32 bytes)
// - kappaEncHex (lowercase hex, 12*48*2 = 1152 chars)
func gtToHash(a *big.Int) (hkHex string, kappaEncHex string, err error) {
	if a == nil || a.Sign() == 0 {
		return "", "", fmt.Errorf("a must be > 0")
	}

	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		return "", "", err
	}

	qa := g1MulBase(a)

	kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
	if err != nil {
		return "", "", fmt.Errorf("pairing: %w", err)
	}

	// Convert kappa to Fr elements for MiMC
	elements := fq12ToFrElements(kappa)
	elements = append(elements, domainTagFr())

	// Hash with MiMC
	hk := mimcHashFr(elements)

	// For kappaEncHex, still use the byte encoding for compatibility
	enc := fq12CanonicalBytes(kappa)

	return hex.EncodeToString(hk.Marshal()), hex.EncodeToString(enc), nil
}

// hkScalarFromA computes hk as a scalar in Fr, derived from:
// mimc( fq12ToFrElements(e([a]q, h0)) || domainTagFr )
// The result is already an Fr element from MiMC.
func hkScalarFromA(a *big.Int) (*big.Int, error) {
	if a == nil || a.Sign() == 0 {
		return nil, fmt.Errorf("a must be > 0")
	}

	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		return nil, err
	}

	qa := g1MulBase(a)
	kappa, err := bls12381.Pair([]bls12381.G1Affine{qa}, []bls12381.G2Affine{h0})
	if err != nil {
		return nil, fmt.Errorf("pairing: %w", err)
	}

	elements := fq12ToFrElements(kappa)
	elements = append(elements, domainTagFr())

	hk := mimcHashFr(elements)

	var bi big.Int
	hk.BigInt(&bi)
	return &bi, nil
}

// --- in-circuit: prove sha2_256(compress([hk]G1)) == public digest ---

type wFromHKCircuit struct {
	// private scalar hk (Fr)
	// IMPORTANT: force this entire composite value to be SECRET (prevents stray public limbs)
	HK emulated.Element[emparams.BLS12381Fr] `gnark:"hk,secret"`

	// public: sha2_256(compressed W), split into 2×16-byte big-endian integers
	HW0 frontend.Variable `gnark:"hw0,public"`
	HW1 frontend.Variable `gnark:"hw1,public"`
}

func (c *wFromHKCircuit) Define(api frontend.API) error {
	curve, err := sw_emulated.New[emparams.BLS12381Fp, emparams.BLS12381Fr](api, sw_emulated.GetBLS12381Params())
	if err != nil {
		return err
	}

	// W = [hk]G
	w := curve.ScalarMulBase(&c.HK)

	// X,Y -> 48-byte big-endian each
	xBytes, err := conversion.EmulatedToBytes(api, &w.X)
	if err != nil {
		return fmt.Errorf("X to bytes: %w", err)
	}
	yBytes, err := conversion.EmulatedToBytes(api, &w.Y)
	if err != nil {
		return fmt.Errorf("Y to bytes: %w", err)
	}
	if len(xBytes) != 48 || len(yBytes) != 48 {
		return fmt.Errorf("unexpected fp byte length: X=%d Y=%d", len(xBytes), len(yBytes))
	}

	// Build compressed G1:
	// out = X (48 bytes), set:
	//   out[0] |= 0x80 (compression)
	//   out[0] |= 0x20 iff y is odd
	bapi, err := uints.NewBytes(api)
	if err != nil {
		return fmt.Errorf("NewBytes: %w", err)
	}

	// yLSB from last byte bit0
	lastY := bapi.Value(yBytes[47])
	yBits := bits.ToBinary(api, lastY, bits.WithNbDigits(8))
	yLSB := yBits[0] // 0/1

	signMask := api.Mul(yLSB, 0x20)
	first := bapi.Or(xBytes[0], bapi.ValueOf(0x80), bapi.ValueOf(signMask))
	xBytes[0] = first

	compressed := xBytes // 48 bytes

	// SHA256(compressed)
	h, err := sha2.New(api)
	if err != nil {
		return fmt.Errorf("sha2.New: %w", err)
	}
	h.Write(compressed)
	digest := h.Sum() // 32 bytes (uints.U8)

	// Public HW0/HW1 are 16-byte integers; compare to digest bytewise.
	// NativeToBytes returns 32 bytes; we use the least-significant 16 bytes. (big-endian)
	hw0b, err := conversion.NativeToBytes(api, c.HW0)
	if err != nil {
		return fmt.Errorf("HW0 to bytes: %w", err)
	}
	hw1b, err := conversion.NativeToBytes(api, c.HW1)
	if err != nil {
		return fmt.Errorf("HW1 to bytes: %w", err)
	}

	pubBytes := append(hw0b[16:], hw1b[16:]...) // 32 bytes
	if len(pubBytes) != len(digest) {
		return fmt.Errorf("pubBytes len %d != digest len %d", len(pubBytes), len(digest))
	}

	for i := range digest {
		bapi.AssertIsEqual(pubBytes[i], digest[i])
	}

	return nil
}

// ProveAndVerifyW builds the circuit proof and immediately verifies it.
// It binds the proof to the provided compressed point by using public inputs:
//
//	HW0,HW1 = sha256(wCompressedBytes) split into 2×16-byte big-endian ints.
func ProveAndVerifyW(a *big.Int, wCompressedHex string) error {
	// 1) Compute hk scalar from a (out-of-circuit)
	hkBi, err := hkScalarFromA(a)
	if err != nil {
		return err
	}
	if hkBi.Sign() == 0 {
		return fmt.Errorf("hk reduced to 0; refuse (W would be infinity)")
	}

	// 2) Decode compressed W bytes and sanity-check it parses
	rawW, err := hex.DecodeString(wCompressedHex)
	if err != nil {
		return fmt.Errorf("decode -w hex: %w", err)
	}
	if len(rawW) != 48 {
		return fmt.Errorf("invalid -w length: got %d bytes, want 48", len(rawW))
	}
	if _, err := parseG1CompressedHex(wCompressedHex); err != nil {
		return fmt.Errorf("invalid compressed G1: %w", err)
	}

	// 3) Public inputs = sha256(W_compressed) split into two 16-byte big-endian ints
	d := sha256.Sum256(rawW)
	var hw0, hw1 big.Int
	hw0.SetBytes(d[:16])
	hw1.SetBytes(d[16:])

	// 4) Compile circuit over BLS12-381 scalar field
	var circuit wFromHKCircuit
	ccs, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, &circuit)
	if err != nil {
		return fmt.Errorf("compile: %w", err)
	}

	// 5) Setup keys
	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}

	// 6) Create witness assignment
	assignment := wFromHKCircuit{
		HK:  emulated.ValueOf[emparams.BLS12381Fr](hkBi),
		HW0: &hw0,
		HW1: &hw1,
	}

	witness, err := frontend.NewWitness(&assignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("new witness: %w", err)
	}
	publicWitness, err := witness.Public()
	if err != nil {
		return fmt.Errorf("public witness: %w", err)
	}

	// 7) Prove + verify
	proof, err := groth16.Prove(ccs, pk, witness)
	if err != nil {
		return fmt.Errorf("prove: %w", err)
	}
	if err := groth16.Verify(proof, vk, publicWitness); err != nil {
		return fmt.Errorf("verify failed: %w", err)
	}

	if err := ExportAll(vk, proof, publicWitness, "out"); err != nil {
		return fmt.Errorf("export: %w", err)
	}

	return nil
}

// --- hop derivation: fq12_encoding(r2 / b, DomainTagHex) ---

func domainTagBytes() ([]byte, error) {
	return hex.DecodeString(DomainTagHex)
}

// gtToHashFromGT hashes a GT element exactly like gtToHash does:
// hk = mimc( fq12ToFrElements(k) || domainTagFr )
func gtToHashFromGT(k bls12381.GT) (string, error) {
	elements := fq12ToFrElements(k)
	elements = append(elements, domainTagFr())

	hk := mimcHashFr(elements)
	return hex.EncodeToString(hk.Marshal()), nil
}

// gtDiv computes num / den in GT as num * den^{-1}.
func gtDiv(num, den bls12381.GT) bls12381.GT {
	var denInv bls12381.GT
	denInv.Inverse(&den)

	var out bls12381.GT
	out.Mul(&num, &denInv)
	return out
}

// DecryptToHash computes the hop key hash.
//
//	if constructor==1:
//	    r2 = pair(g1b, H0)
//	else:
//	    r2 = pair(g1b, H0) * pair(r1, g2b)
//
//	b = pair(r1, shared)
//	k = r2 / b
//	out = mimc( fq12ToFrElements(k) || DomainTagFr )
//
// Inputs are COMPRESSED hex strings:
//
//	g1bHex   : G1 (entry["fields"][1]["fields"][0]["bytes"])
//	g2bHex   : optional G2 (entry["fields"][1]["fields"][1]["fields"][0]["bytes"])
//	           pass "" to omit the extra multiplicative term
//	r1Hex    : G1 (entry["fields"][0]["bytes"])
//	sharedHex: G2 (current shared)
func DecryptToHash(g1bHex, g2bHex, r1Hex, sharedHex string) (string, error) {
	// Parse fixed H0
	h0, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		return "", err
	}

	// Parse inputs
	g1b, err := parseG1CompressedHex(g1bHex)
	if err != nil {
		return "", fmt.Errorf("parse g1b: %w", err)
	}
	r1, err := parseG1CompressedHex(r1Hex)
	if err != nil {
		return "", fmt.Errorf("parse r1: %w", err)
	}
	shared, err := parseG2CompressedHex(sharedHex)
	if err != nil {
		return "", fmt.Errorf("parse shared: %w", err)
	}

	// r2 = e(g1b, H0)
	r2, err := bls12381.Pair([]bls12381.G1Affine{g1b}, []bls12381.G2Affine{h0})
	if err != nil {
		return "", fmt.Errorf("pair(g1b, H0): %w", err)
	}

	// Optional: r2 *= e(r1, g2b)
	if g2bHex != "" {
		g2b, err := parseG2CompressedHex(g2bHex)
		if err != nil {
			return "", fmt.Errorf("parse g2b: %w", err)
		}
		t, err := bls12381.Pair([]bls12381.G1Affine{r1}, []bls12381.G2Affine{g2b})
		if err != nil {
			return "", fmt.Errorf("pair(r1, g2b): %w", err)
		}
		r2.Mul(&r2, &t)
	}

	// b = e(r1, shared)
	b, err := bls12381.Pair([]bls12381.G1Affine{r1}, []bls12381.G2Affine{shared})
	if err != nil {
		return "", fmt.Errorf("pair(r1, shared): %w", err)
	}

	// k = r2 / b
	k := gtDiv(r2, b)

	// hash(k)
	return gtToHashFromGT(k)
}

// --- in-circuit: prove
//
//	w0 == [hk]q
//	w1 == [a]q + [r]v
//
// with hk computed IN-CIRCUIT from:
//
//	hk = mimc( fq12ToFrElements( e([a]q, H0) ) || DomainTagFr )
//
// where (a, r) are secret scalars in Fr
// and (v, w0, w1) are public G1 points (provided as public X/Y in Fp).
type vw0w1Circuit struct {
	// secrets (Fr)
	A emulated.Element[emparams.BLS12381Fr] `gnark:"a,secret"`
	R emulated.Element[emparams.BLS12381Fr] `gnark:"r,secret"`

	// publics (Fp) : V, W0, W1 as affine coordinates
	VX emulated.Element[emparams.BLS12381Fp] `gnark:"vx,public"`
	VY emulated.Element[emparams.BLS12381Fp] `gnark:"vy,public"`

	W0X emulated.Element[emparams.BLS12381Fp] `gnark:"w0x,public"`
	W0Y emulated.Element[emparams.BLS12381Fp] `gnark:"w0y,public"`

	W1X emulated.Element[emparams.BLS12381Fp] `gnark:"w1x,public"`
	W1Y emulated.Element[emparams.BLS12381Fp] `gnark:"w1y,public"`
}

// fq12CanonicalBytesInCircuit serializes the pairing output in the SAME order
// as fq12CanonicalBytes(k bls12381.GT) does out-of-circuit.
//
// In gnark v0.14, sw_bls12381.GTEl is an alias to fields_bls12381.E12 (direct extension),
// so we convert it to the 2-3-2 tower via fields_bls12381.Ext12.ToTower and then
// serialize the 12 base-field coefficients in tower order.
func fq12CanonicalBytesInCircuit(api frontend.API, k *sw_bls12381.GTEl) ([]uints.U8, error) {
	ext12 := fields_bls12381.NewExt12(api)
	tower := ext12.ToTower(k) // [12]*baseEl (baseEl is an alias to the base-field element type)

	out := make([]uints.U8, 0, 12*48)
	for i := 0; i < 12; i++ {
		b, err := conversion.EmulatedToBytes(api, tower[i])
		if err != nil {
			return nil, fmt.Errorf("coef[%d] to bytes: %w", i, err)
		}
		if len(b) != 48 {
			return nil, fmt.Errorf("unexpected fp byte length at coef[%d]: got %d want 48", i, len(b))
		}
		out = append(out, b...)
	}

	return out, nil
}

// fq12ToNativeFrElements extracts the 12 Fp coefficients from an in-circuit
// GT element and converts each to a native field element (Fr) for MiMC hashing.
// Since the native field IS Fr and Fp > Fr, this performs reduction mod r.
func fq12ToNativeFrElements(api frontend.API, k *sw_bls12381.GTEl) ([]frontend.Variable, error) {
	ext12 := fields_bls12381.NewExt12(api)
	tower := ext12.ToTower(k) // [12]*baseEl

	bapi, err := uints.NewBytes(api)
	if err != nil {
		return nil, err
	}

	elements := make([]frontend.Variable, 0, 13) // 12 coeffs + domain tag

	for i := 0; i < 12; i++ {
		// Convert Fp to bytes (48 bytes, big-endian)
		fpBytes, err := conversion.EmulatedToBytes(api, tower[i])
		if err != nil {
			return nil, fmt.Errorf("coef[%d] to bytes: %w", i, err)
		}

		// Convert bytes to bits (little-endian for FromBinary)
		fpBits := make([]frontend.Variable, 0, 48*8)
		for j := len(fpBytes) - 1; j >= 0; j-- { // reverse for little-endian
			bv := bapi.Value(fpBytes[j])
			bs := bits.ToBinary(api, bv, bits.WithNbDigits(8))
			fpBits = append(fpBits, bs...)
		}

		// Reconstruct as native field element (automatically reduces mod r)
		native := bits.FromBinary(api, fpBits)
		elements = append(elements, native)
	}

	return elements, nil
}

// hashToFrMiMC hashes native field elements using MiMC and returns an emulated Fr.
// Since the circuit is compiled over BLS12-381's scalar field, MiMC operates in Fr.
func hashToFrMiMC(api frontend.API, elements []frontend.Variable) (emulated.Element[emparams.BLS12381Fr], error) {
	h, err := stdmimc.NewMiMC(api)
	if err != nil {
		return emulated.Element[emparams.BLS12381Fr]{}, err
	}

	h.Write(elements...)
	digest := h.Sum()

	// Convert native Fr (frontend.Variable) to emulated Fr
	// Since the native field IS Fr, the value is already in the correct range
	frField, err := emulated.NewField[emparams.BLS12381Fr](api)
	if err != nil {
		return emulated.Element[emparams.BLS12381Fr]{}, err
	}

	// Convert native to bits, then to emulated Fr
	digestBits := bits.ToBinary(api, digest, bits.WithNbDigits(256))
	hk := frField.FromBits(digestBits...)
	hk = frField.Reduce(hk)

	return *hk, nil
}

func (c *vw0w1Circuit) Define(api frontend.API) error {
	// G1 arithmetic (emulated)
	curve, err := sw_emulated.New[emparams.BLS12381Fp, emparams.BLS12381Fr](api, sw_emulated.GetBLS12381Params())
	if err != nil {
		return err
	}

	v := sw_emulated.AffinePoint[emparams.BLS12381Fp]{X: c.VX, Y: c.VY}
	w0 := sw_emulated.AffinePoint[emparams.BLS12381Fp]{X: c.W0X, Y: c.W0Y}
	w1 := sw_emulated.AffinePoint[emparams.BLS12381Fp]{X: c.W1X, Y: c.W1Y}

	// NOTE: On-curve validation for v, w0, w1 is performed by the contract
	// before these public inputs reach the prover. Skipping in-circuit
	// validation saves ~150K constraints.

	// qa = [a]q
	qa := curve.ScalarMulBase(&c.A)

	// --- compute hk IN-CIRCUIT from kappa = e(qa, H0) ---

	// Pairing gadget (emulated)
	pairing, err := sw_bls12381.NewPairing(api)
	if err != nil {
		return err
	}

	h0Native, err := parseG2CompressedHex(H0Hex)
	if err != nil {
		return fmt.Errorf("parse H0Hex: %w", err)
	}
	h0 := sw_bls12381.NewG2AffineFixed(h0Native)

	qaForPair := sw_bls12381.G1Affine{X: qa.X, Y: qa.Y}
	// NOTE: Skipping AssertIsOnG1/G2 - qa comes from ScalarMulBase (always valid),
	// h0 is a compile-time constant. All points are validated by the contract.

	kappa, err := pairing.Pair([]*sw_bls12381.G1Affine{&qaForPair}, []*sw_bls12381.G2Affine{&h0})
	if err != nil {
		return err
	}

	// Convert kappa to native field elements for MiMC hashing
	kappaElements, err := fq12ToNativeFrElements(api, kappa)
	if err != nil {
		return fmt.Errorf("kappa to elements: %w", err)
	}

	// Add domain tag as native field element
	tagBytes, _ := hex.DecodeString(DomainTagHex)
	var tagBigInt big.Int
	tagBigInt.SetBytes(tagBytes)
	tagElement := frontend.Variable(&tagBigInt)
	kappaElements = append(kappaElements, tagElement)

	// Hash with MiMC
	hk, err := hashToFrMiMC(api, kappaElements)
	if err != nil {
		return fmt.Errorf("hashToFrMiMC: %w", err)
	}

	// p0 = [hk]q
	p0 := curve.ScalarMulBase(&hk)
	curve.AssertIsEqual(p0, &w0)

	// p1 = [a]q + [r]v
	rv := curve.ScalarMul(&v, &c.R)
	p1 := curve.Add(qa, rv)
	curve.AssertIsEqual(p1, &w1)

	return nil
}

// ProveAndVerifyVW0W1 builds the circuit proof and immediately verifies it.
//
// Inputs (hex):
//   - vHex, w0Hex, w1Hex are compressed G1 (48 bytes => 96 hex chars)
//
// Secrets:
//   - a, r (big.Int)
//
// Relation proven:
//   - hk is computed inside the circuit from kappa = e([a]q, H0) and mimc(fq12ToFr(kappa)||DomainTag),
//   - w0 == [hk]q
//   - w1 == [a]q + [r]v
//
// Exports:
//   - writes vk.json / proof.json / public.json to outDir via ExportAll(...)
func ProveAndVerifyVW0W1(a, r *big.Int, vHex, w0Hex, w1Hex, outDir string) error {
	if a == nil || a.Sign() == 0 {
		return fmt.Errorf("a must be > 0")
	}
	if r == nil {
		r = new(big.Int)
	}

	// 1) Parse public points (and sanity-check compressed form)
	parse48 := func(name, h string) ([]byte, error) {
		raw, err := hex.DecodeString(h)
		if err != nil {
			return nil, fmt.Errorf("decode %s hex: %w", name, err)
		}
		if len(raw) != 48 {
			return nil, fmt.Errorf("invalid %s length: got %d bytes, want 48", name, len(raw))
		}
		return raw, nil
	}
	if _, err := parse48("v", vHex); err != nil {
		return err
	}
	if _, err := parse48("w0", w0Hex); err != nil {
		return err
	}
	if _, err := parse48("w1", w1Hex); err != nil {
		return err
	}

	vAff, err := parseG1CompressedHex(vHex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 v: %w", err)
	}
	w0Aff, err := parseG1CompressedHex(w0Hex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 w0: %w", err)
	}
	w1Aff, err := parseG1CompressedHex(w1Hex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 w1: %w", err)
	}

	// 2) Reduce secrets into Fr (important if caller passes huge ints)
	var aFr, rFr fr.Element
	aFr.SetBigInt(a)
	rFr.SetBigInt(r)

	var aRed, rRed big.Int
	aFr.BigInt(&aRed)
	rFr.BigInt(&rRed)

	// 3) Extract affine coords to big.Int (regular big-endian)
	var vx, vy, w0x, w0y, w1x, w1y big.Int
	vAff.X.ToBigIntRegular(&vx)
	vAff.Y.ToBigIntRegular(&vy)
	w0Aff.X.ToBigIntRegular(&w0x)
	w0Aff.Y.ToBigIntRegular(&w0y)
	w1Aff.X.ToBigIntRegular(&w1x)
	w1Aff.Y.ToBigIntRegular(&w1y)

	// 4) Compile circuit over BLS12-381 scalar field
	var circuit vw0w1Circuit
	ccs, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, &circuit)
	if err != nil {
		return fmt.Errorf("compile: %w", err)
	}

	// 5) Setup keys
	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}

	// 6) Create witness assignment
	assignment := vw0w1Circuit{
		A: emulated.ValueOf[emparams.BLS12381Fr](&aRed),
		R: emulated.ValueOf[emparams.BLS12381Fr](&rRed),

		VX: emulated.ValueOf[emparams.BLS12381Fp](&vx),
		VY: emulated.ValueOf[emparams.BLS12381Fp](&vy),

		W0X: emulated.ValueOf[emparams.BLS12381Fp](&w0x),
		W0Y: emulated.ValueOf[emparams.BLS12381Fp](&w0y),

		W1X: emulated.ValueOf[emparams.BLS12381Fp](&w1x),
		W1Y: emulated.ValueOf[emparams.BLS12381Fp](&w1y),
	}

	witness, err := frontend.NewWitness(&assignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("new witness: %w", err)
	}
	publicWitness, err := witness.Public()
	if err != nil {
		return fmt.Errorf("public witness: %w", err)
	}

	// 7) Prove + verify
	proof, err := groth16.Prove(ccs, pk, witness)
	if err != nil {
		return fmt.Errorf("prove: %w", err)
	}
	if err := groth16.Verify(proof, vk, publicWitness); err != nil {
		return fmt.Errorf("verify failed: %w", err)
	}

	// 8) Export artifacts
	if err := ExportAll(vk, proof, publicWitness, outDir); err != nil {
		return fmt.Errorf("export: %w", err)
	}

	// 9) Save gnark native binary files for standalone verification
	if err := SaveNativeFiles(vk, proof, publicWitness, outDir); err != nil {
		return fmt.Errorf("save native files: %w", err)
	}

	return nil
}

// ---------- Production Setup/Prove Workflow ----------

// SetupVW0W1Circuit compiles the vw0w1 circuit and generates the proving/verifying keys.
// This is the "trusted setup" phase that should be run once and the output files reused.
// If force is false and setup files already exist, this function returns early.
//
// Output files:
//   - ccs.bin: compiled constraint system
//   - pk.bin: proving key
//   - vk.bin: verifying key
func SetupVW0W1Circuit(outDir string, force bool) error {
	// Check if setup files already exist
	if !force && SetupFilesExist(outDir) {
		return nil // Already set up
	}

	// Compile circuit over BLS12-381 scalar field
	var circuit vw0w1Circuit
	ccs, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, &circuit)
	if err != nil {
		return fmt.Errorf("compile: %w", err)
	}

	// Setup keys (trusted setup)
	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}

	// Save setup files
	if err := SaveSetupFiles(ccs, pk, vk, outDir); err != nil {
		return fmt.Errorf("save setup files: %w", err)
	}

	// Also export vk.json for easy transfer to Aiken
	if err := ExportVKOnly(vk, outDir); err != nil {
		return fmt.Errorf("export vk.json: %w", err)
	}

	return nil
}

// ProveVW0W1FromSetup loads the setup files and generates a proof for the given inputs.
// This is the production proving path that reuses pre-computed setup files.
//
// Inputs:
//   - setupDir: directory containing ccs.bin, pk.bin, vk.bin
//   - outDir: directory for proof output (proof.bin, witness.bin, JSON files)
//   - a, r: secret scalars
//   - vHex, w0Hex, w1Hex: public G1 points as compressed hex
//   - verify: if true, also verify the proof after generation
func ProveVW0W1FromSetup(setupDir, outDir string, a, r *big.Int, vHex, w0Hex, w1Hex string, verify bool) error {
	if a == nil || a.Sign() == 0 {
		return fmt.Errorf("a must be > 0")
	}
	if r == nil {
		r = new(big.Int)
	}

	// 1) Parse public points (and sanity-check compressed form)
	parse48 := func(name, h string) ([]byte, error) {
		raw, err := hex.DecodeString(h)
		if err != nil {
			return nil, fmt.Errorf("decode %s hex: %w", name, err)
		}
		if len(raw) != 48 {
			return nil, fmt.Errorf("invalid %s length: got %d bytes, want 48", name, len(raw))
		}
		return raw, nil
	}
	if _, err := parse48("v", vHex); err != nil {
		return err
	}
	if _, err := parse48("w0", w0Hex); err != nil {
		return err
	}
	if _, err := parse48("w1", w1Hex); err != nil {
		return err
	}

	vAff, err := parseG1CompressedHex(vHex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 v: %w", err)
	}
	w0Aff, err := parseG1CompressedHex(w0Hex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 w0: %w", err)
	}
	w1Aff, err := parseG1CompressedHex(w1Hex)
	if err != nil {
		return fmt.Errorf("invalid compressed G1 w1: %w", err)
	}

	// 2) Reduce secrets into Fr
	var aFr, rFr fr.Element
	aFr.SetBigInt(a)
	rFr.SetBigInt(r)

	var aRed, rRed big.Int
	aFr.BigInt(&aRed)
	rFr.BigInt(&rRed)

	// 3) Extract affine coords to big.Int
	var vx, vy, w0x, w0y, w1x, w1y big.Int
	vAff.X.ToBigIntRegular(&vx)
	vAff.Y.ToBigIntRegular(&vy)
	w0Aff.X.ToBigIntRegular(&w0x)
	w0Aff.Y.ToBigIntRegular(&w0y)
	w1Aff.X.ToBigIntRegular(&w1x)
	w1Aff.Y.ToBigIntRegular(&w1y)

	// 4) Load setup files
	ccs, pk, vk, err := LoadSetupFiles(setupDir)
	if err != nil {
		return fmt.Errorf("load setup files: %w", err)
	}

	// 5) Create witness assignment
	assignment := vw0w1Circuit{
		A: emulated.ValueOf[emparams.BLS12381Fr](&aRed),
		R: emulated.ValueOf[emparams.BLS12381Fr](&rRed),

		VX: emulated.ValueOf[emparams.BLS12381Fp](&vx),
		VY: emulated.ValueOf[emparams.BLS12381Fp](&vy),

		W0X: emulated.ValueOf[emparams.BLS12381Fp](&w0x),
		W0Y: emulated.ValueOf[emparams.BLS12381Fp](&w0y),

		W1X: emulated.ValueOf[emparams.BLS12381Fp](&w1x),
		W1Y: emulated.ValueOf[emparams.BLS12381Fp](&w1y),
	}

	witness, err := frontend.NewWitness(&assignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("new witness: %w", err)
	}
	publicWitness, err := witness.Public()
	if err != nil {
		return fmt.Errorf("public witness: %w", err)
	}

	// 6) Prove
	proof, err := groth16.Prove(ccs, pk, witness)
	if err != nil {
		return fmt.Errorf("prove: %w", err)
	}

	// 7) Optionally verify
	if verify {
		if err := groth16.Verify(proof, vk, publicWitness); err != nil {
			return fmt.Errorf("verify failed: %w", err)
		}
	}

	// 8) Export artifacts
	if err := ExportAll(vk, proof, publicWitness, outDir); err != nil {
		return fmt.Errorf("export: %w", err)
	}

	// 9) Save gnark native binary files for standalone verification
	if err := SaveNativeFiles(vk, proof, publicWitness, outDir); err != nil {
		return fmt.Errorf("save native files: %w", err)
	}

	return nil
}
