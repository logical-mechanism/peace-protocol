// export.go (same package main)

package main

import (
	"encoding/hex"
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
	NPublic int      `json:"nPublic"`
	VkAlpha string   `json:"vkAlpha"` // G1 compressed hex
	VkBeta  string   `json:"vkBeta"`  // G2 compressed hex
	VkGamma string   `json:"vkGamma"` // G2 compressed hex
	VkDelta string   `json:"vkDelta"` // G2 compressed hex
	VkIC    []string `json:"vkIC"`    // list of G1 compressed hex
}

type ProofJSON struct {
	PiA string `json:"piA"` // G1 compressed hex
	PiB string `json:"piB"` // G2 compressed hex
	PiC string `json:"piC"` // G1 compressed hex
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

	A := ar.Interface().(bls12381.G1Affine)
	B := bs.Interface().(bls12381.G2Affine)
	C := krs.Interface().(bls12381.G1Affine)

	piA, err := g1CompressedHex(A)
	if err != nil {
		return ProofJSON{}, err
	}
	piB, err := g2CompressedHex(B)
	if err != nil {
		return ProofJSON{}, err
	}
	piC, err := g1CompressedHex(C)
	if err != nil {
		return ProofJSON{}, err
	}

	return ProofJSON{PiA: piA, PiB: piB, PiC: piC}, nil
}

func exportVKBLS(vk groth16.VerifyingKey, nPublic int) (VKJSON, error) {
	rv := reflect.ValueOf(vk)
	if rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}

	g1 := rv.FieldByName("G1")
	g2 := rv.FieldByName("G2")
	if !g1.IsValid() || !g2.IsValid() {
		return VKJSON{}, fmt.Errorf("unexpected vk layout: %T", vk)
	}

	alpha := g1.FieldByName("Alpha").Interface().(bls12381.G1Affine)
	icField := g1.FieldByName("K") // IC vector
	if !icField.IsValid() {
		return VKJSON{}, fmt.Errorf("vk missing G1.K (IC vector): %T", vk)
	}

	beta := g2.FieldByName("Beta").Interface().(bls12381.G2Affine)
	gamma := g2.FieldByName("Gamma").Interface().(bls12381.G2Affine)
	delta := g2.FieldByName("Delta").Interface().(bls12381.G2Affine)

	vkAlpha, err := g1CompressedHex(alpha)
	if err != nil {
		return VKJSON{}, err
	}
	vkBeta, err := g2CompressedHex(beta)
	if err != nil {
		return VKJSON{}, err
	}
	vkGamma, err := g2CompressedHex(gamma)
	if err != nil {
		return VKJSON{}, err
	}
	vkDelta, err := g2CompressedHex(delta)
	if err != nil {
		return VKJSON{}, err
	}

	ic := make([]string, 0, icField.Len())
	for i := 0; i < icField.Len(); i++ {
		p := icField.Index(i).Interface().(bls12381.G1Affine)
		h, err := g1CompressedHex(p)
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
	vkj, err := exportVKBLS(vk, 3)
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

	expected := len(vkj.VkIC) - 1
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

func g1CompressedHex(p bls12381.G1Affine) (string, error) {
	b := p.Bytes() // should be 48 bytes compressed
	if len(b) != 48 {
		return "", fmt.Errorf("unexpected G1 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}

func g2CompressedHex(p bls12381.G2Affine) (string, error) {
	b := p.Bytes() // should be 96 bytes compressed
	if len(b) != 96 {
		return "", fmt.Errorf("unexpected G2 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}
