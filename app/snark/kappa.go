package main

import (
	"encoding/hex"
	"fmt"
	"math/big"

	"golang.org/x/crypto/blake2b"

	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"

	"github.com/consensys/gnark-crypto/ecc"
	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fp"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"

	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
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

func blake2b224Hex(msg []byte) string {
	h, _ := blake2b.New(28, nil) // 224-bit digest
	_, _ = h.Write(msg)
	return hex.EncodeToString(h.Sum(nil))
}

func blake2b224(msg []byte) []byte {
	h, _ := blake2b.New(28, nil)
	_, _ = h.Write(msg)
	return h.Sum(nil)
}

// gtToHash computes:
// kappa = e([a]q, h0)
// enc  = fq12CanonicalBytes(kappa)
// hk   = blake2b-224( enc || domainTagBytes )
//
// Returns:
// - hkHex (lowercase hex, 56 chars)
// - kappaEncHex (lowercase hex, 12*48*2 = 1152 chars)
func gtToHash(a *big.Int) (hkHex string, kappaEncHex string, err error) {
	if a == nil || a.Sign() == 0 {
		return "", "", fmt.Errorf("a must be > 0")
	}

	tagBytes, err := hex.DecodeString(DomainTagHex)
	if err != nil {
		return "", "", fmt.Errorf("decode DomainTagHex: %w", err)
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

	enc := fq12CanonicalBytes(kappa)
	msg := make([]byte, 0, len(enc)+len(tagBytes))
	msg = append(msg, enc...)
	msg = append(msg, tagBytes...)

	hk := blake2b224(msg)

	return hex.EncodeToString(hk), hex.EncodeToString(enc), nil
}

func hkScalarFromA(a *big.Int) (*big.Int, error) {
	if a == nil || a.Sign() == 0 {
		return nil, fmt.Errorf("a must be > 0")
	}

	tagBytes, err := hex.DecodeString(DomainTagHex)
	if err != nil {
		return nil, fmt.Errorf("decode DomainTagHex: %w", err)
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

	enc := fq12CanonicalBytes(kappa)
	msg := make([]byte, 0, len(enc)+len(tagBytes))
	msg = append(msg, enc...)
	msg = append(msg, tagBytes...)
	hkDigest := blake2b224(msg)

	// Reduce into Fr
	var s fr.Element
	s.SetBytes(hkDigest)

	var bi big.Int
	s.BigInt(&bi)
	return &bi, nil
}

// --- in-circuit: prove W == [hk]G1 ---

type wFromHKCircuit struct {
	// private scalar hk (Fr)
	HK emulated.Element[emparams.BLS12381Fr]
	// public point W (Fp coords)
	W sw_emulated.AffinePoint[emparams.BLS12381Fp] `gnark:",public"`
}

func (c *wFromHKCircuit) Define(api frontend.API) error {
	curve, err := sw_emulated.New[emparams.BLS12381Fp, emparams.BLS12381Fr](api, sw_emulated.GetBLS12381Params())
	if err != nil {
		return err
	}

	wCalc := curve.ScalarMulBase(&c.HK) // W' = [hk]G
	curve.AssertIsEqual(wCalc, &c.W)    // W' == W
	return nil
}

// ProveAndVerifyW builds the circuit proof and immediately verifies it.
// Prints/returns success if the public W matches hk derived from `a`.
func ProveAndVerifyW(a *big.Int, wCompressedHex string) error {
	// 1) Compute hk scalar from a (out-of-circuit)
	hkBi, err := hkScalarFromA(a)
	if err != nil {
		return err
	}

	// 2) Parse public W (out-of-circuit)
	wAff, err := parseG1CompressedHex(wCompressedHex)
	if err != nil {
		return err
	}

	// Convert W.X, W.Y to big.Int in regular form.
	var wx, wy big.Int
	wAff.X.ToBigIntRegular(&wx)
	wAff.Y.ToBigIntRegular(&wy)

	// 3) Compile circuit over BLS12-381 scalar field
	var circuit wFromHKCircuit
	ccs, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, &circuit)
	if err != nil {
		return fmt.Errorf("compile: %w", err)
	}

	// 4) Setup keys
	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}

	// 5) Create witness assignment
	assignment := wFromHKCircuit{
		HK: emulated.ValueOf[emparams.BLS12381Fr](hkBi),
		W: sw_emulated.AffinePoint[emparams.BLS12381Fp]{
			X: emulated.ValueOf[emparams.BLS12381Fp](&wx),
			Y: emulated.ValueOf[emparams.BLS12381Fp](&wy),
		},
	}

	witness, err := frontend.NewWitness(&assignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("new witness: %w", err)
	}
	publicWitness, err := witness.Public()
	if err != nil {
		return fmt.Errorf("public witness: %w", err)
	}

	// 6) Prove + verify
	proof, err := groth16.Prove(ccs, pk, witness)
	if err != nil {
		return fmt.Errorf("prove: %w", err)
	}
	if err := groth16.Verify(proof, vk, publicWitness); err != nil {
		return fmt.Errorf("verify failed: %w", err)
	}

	return nil
}

// --- hop derivation: fq12_encoding(r2 / b, DomainTagHex) ---

func domainTagBytes() ([]byte, error) {
	return hex.DecodeString(DomainTagHex)
}

// gtToHashFromGT hashes a GT element exactly like gtToHash does:
// hk = blake2b-224( fq12CanonicalBytes(k) || domainTagBytes )
func gtToHashFromGT(k bls12381.GT) (string, error) {
	tagBytes, err := domainTagBytes()
	if err != nil {
		return "", fmt.Errorf("decode DomainTagHex: %w", err)
	}

	enc := fq12CanonicalBytes(k)
	msg := make([]byte, 0, len(enc)+len(tagBytes))
	msg = append(msg, enc...)
	msg = append(msg, tagBytes...)

	return blake2b224Hex(msg), nil
}

// gtDiv computes num / den in GT as num * den^{-1}.
func gtDiv(num, den bls12381.GT) bls12381.GT {
	var denInv bls12381.GT
	denInv.Inverse(&den)

	var out bls12381.GT
	out.Mul(&num, &denInv)
	return out
}

// DecryptToHash computes the hop key hash that matches your Python.
//
//	if constructor==1:
//	    r2 = pair(g1b, H0)
//	else:
//	    r2 = pair(g1b, H0) * pair(r1, g2b)
//
//	b = pair(r1, shared)
//	k = r2 / b
//	out = fq12_encoding(k, DomainTag)
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

	// fq12_encoding(k, DomainTagHex) => hash hex
	return gtToHashFromGT(k)
}
