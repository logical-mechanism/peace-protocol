// export.go (same package main)

package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"reflect"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark/backend/groth16"
	backend_witness "github.com/consensys/gnark/backend/witness"
)

// ---------- JSON shapes (snarkjs-like, but minimal) ----------

type VKJSON struct {
	AlphaG1 [2]string    `json:"alpha_g1"` // [x,y]
	BetaG2  [2][2]string `json:"beta_g2"`  // [[x0,x1],[y0,y1]] where Fp2 = x0 + x1*u
	GammaG2 [2][2]string `json:"gamma_g2"`
	DeltaG2 [2][2]string `json:"delta_g2"`
	IC      [][2]string  `json:"ic"` // IC[i] = [x,y]
}

type ProofJSON struct {
	A [2]string    `json:"a"` // Ar
	B [2][2]string `json:"b"` // Bs
	C [2]string    `json:"c"` // Krs
}

type PublicJSON struct {
	Inputs []string `json:"inputs"` // decimal strings in Fr (limb-expanded)
}

// ---------- helpers to stringify points ----------

func fpToDec(x interface{}) (string, error) {
	// expects gnark-crypto fp.Element-like with ToBigIntRegular(*big.Int)
	v := reflect.ValueOf(x)
	m := v.MethodByName("ToBigIntRegular")
	if !m.IsValid() {
		return "", fmt.Errorf("no ToBigIntRegular on %T", x)
	}
	var bi big.Int
	out := m.Call([]reflect.Value{reflect.ValueOf(&bi)})
	_ = out
	return bi.String(), nil
}

func g1ToXYDec(p bls12381.G1Affine) ([2]string, error) {
	var x, y big.Int
	p.X.ToBigIntRegular(&x)
	p.Y.ToBigIntRegular(&y)
	return [2]string{x.String(), y.String()}, nil
}

func g2ToXYDec(p bls12381.G2Affine) ([2][2]string, error) {
	// gnark-crypto: Fp2 element is typically {A0, A1} meaning A0 + A1*u
	var x0, x1, y0, y1 big.Int
	p.X.A0.ToBigIntRegular(&x0)
	p.X.A1.ToBigIntRegular(&x1)
	p.Y.A0.ToBigIntRegular(&y0)
	p.Y.A1.ToBigIntRegular(&y1)
	return [2][2]string{
		{x0.String(), x1.String()},
		{y0.String(), y1.String()},
	}, nil
}

// ---------- reflect-extract vk/proof in a curve-agnostic-ish way ----------

func exportProofBLS(proof groth16.Proof) (ProofJSON, error) {
	// In gnark groth16, proof typically has fields Ar (G1), Bs (G2), Krs (G1)
	rv := reflect.ValueOf(proof)
	if rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}
	ar := rv.FieldByName("Ar")
	bs := rv.FieldByName("Bs")
	krs := rv.FieldByName("Krs")
	if !ar.IsValid() || !bs.IsValid() || !krs.IsValid() {
		return ProofJSON{}, fmt.Errorf("unexpected proof layout: %T", proof)
	}

	A, ok := ar.Interface().(bls12381.G1Affine)
	if !ok {
		return ProofJSON{}, fmt.Errorf("unexpected Ar type: %T", ar.Interface())
	}
	B, ok := bs.Interface().(bls12381.G2Affine)
	if !ok {
		return ProofJSON{}, fmt.Errorf("unexpected Bs type: %T", bs.Interface())
	}
	C, ok := krs.Interface().(bls12381.G1Affine)
	if !ok {
		return ProofJSON{}, fmt.Errorf("unexpected Krs type: %T", krs.Interface())
	}

	a, _ := g1ToXYDec(A)
	b, _ := g2ToXYDec(B)
	c, _ := g1ToXYDec(C)

	return ProofJSON{A: a, B: b, C: c}, nil
}

func exportVKBLS(vk groth16.VerifyingKey) (VKJSON, error) {
	// gnark’s Groth16 verifying key usually has sub-structs G1 and G2 and an IC/K vector
	rv := reflect.ValueOf(vk)
	if rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}

	g1 := rv.FieldByName("G1")
	g2 := rv.FieldByName("G2")
	if !g1.IsValid() || !g2.IsValid() {
		return VKJSON{}, fmt.Errorf("unexpected vk layout: %T", vk)
	}

	alphaAny := g1.FieldByName("Alpha").Interface()
	alpha, ok := alphaAny.(bls12381.G1Affine)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk.G1.Alpha type: %T", alphaAny)
	}

	// IC vector is often called K in gnark’s Groth16 vk (vk.G1.K)
	icField := g1.FieldByName("K")
	if !icField.IsValid() {
		return VKJSON{}, fmt.Errorf("vk missing G1.K (IC vector): %T", vk)
	}

	betaAny := g2.FieldByName("Beta").Interface()
	gammaAny := g2.FieldByName("Gamma").Interface()
	deltaAny := g2.FieldByName("Delta").Interface()

	beta, ok := betaAny.(bls12381.G2Affine)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk.G2.Beta type: %T", betaAny)
	}
	gamma, ok := gammaAny.(bls12381.G2Affine)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk.G2.Gamma type: %T", gammaAny)
	}
	delta, ok := deltaAny.(bls12381.G2Affine)
	if !ok {
		return VKJSON{}, fmt.Errorf("unexpected vk.G2.Delta type: %T", deltaAny)
	}

	alphaXY, _ := g1ToXYDec(alpha)
	betaXY, _ := g2ToXYDec(beta)
	gammaXY, _ := g2ToXYDec(gamma)
	deltaXY, _ := g2ToXYDec(delta)

	// IC slice
	ic := make([][2]string, 0, icField.Len())
	for i := 0; i < icField.Len(); i++ {
		pAny := icField.Index(i).Interface()
		p, ok := pAny.(bls12381.G1Affine)
		if !ok {
			return VKJSON{}, fmt.Errorf("unexpected vk.G1.K[%d] type: %T", i, pAny)
		}
		xy, _ := g1ToXYDec(p)
		ic = append(ic, xy)
	}

	return VKJSON{
		AlphaG1: alphaXY,
		BetaG2:  betaXY,
		GammaG2: gammaXY,
		DeltaG2: deltaXY,
		IC:      ic,
	}, nil
}

func exportPublicInputs(publicWitness backend_witness.Witness) ([]string, error) {
	vecAny := publicWitness.Vector()

	rv := reflect.ValueOf(vecAny)
	if rv.Kind() != reflect.Slice {
		return nil, fmt.Errorf("unexpected publicWitness.Vector() type %T (not a slice)", vecAny)
	}

	out := make([]string, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		ev := rv.Index(i)

		// We want to call BigInt(*big.Int) on the element.
		// BigInt is commonly defined on *Element (pointer receiver).
		var bi big.Int

		// Try pointer receiver first: (&ev).BigInt(&bi)
		var m reflect.Value
		if ev.CanAddr() {
			m = ev.Addr().MethodByName("BigInt")
		}
		// Fallback: value receiver (rare)
		if !m.IsValid() {
			m = ev.MethodByName("BigInt")
		}
		if !m.IsValid() {
			return nil, fmt.Errorf("public input elem[%d] type %T has no BigInt method", i, ev.Interface())
		}

		// Expect signature BigInt(*big.Int)
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

// Call this right after you produce proof/vk/publicWitness
func ExportAll(vk groth16.VerifyingKey, proof groth16.Proof, publicWitness backend_witness.Witness, dir string) error {
	vkj, err := exportVKBLS(vk)
	if err != nil {
		return err
	}
	pj, err := exportProofBLS(proof)
	if err != nil {
		return err
	}
	pub, err := exportPublicInputs(publicWitness)
	if err != nil {
		return err
	}

	expected := len(vkj.IC) - 1
	if len(pub) < expected {
		// pad missing publics with zeros
		for len(pub) < expected {
			pub = append(pub, "0")
		}
	}
	if len(pub) > expected {
		// truncate extras (shouldn't happen, but keeps verifier consistent)
		pub = pub[:expected]
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	writeJSON := func(name string, v interface{}) error {
		f, err := os.Create(dir + "/" + name)
		if err != nil {
			return err
		}
		defer f.Close()
		enc := json.NewEncoder(f)
		enc.SetIndent("", "  ")
		return enc.Encode(v)
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
