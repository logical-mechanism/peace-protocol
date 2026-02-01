//go:build js && wasm

// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// WASM entry point for browser-based SNARK proving.
// This file exposes the gnarkProve function to JavaScript.
//
// Build with:
//   GOOS=js GOARCH=wasm go build -o prover.wasm .

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"syscall/js"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
)

// ProofResultWASM is the JSON structure returned to JavaScript
type ProofResultWASM struct {
	Proof  ProofJSONWASM  `json:"proof"`
	Public PublicJSONWASM `json:"public"`
}

// ProofJSONWASM matches the expected format
type ProofJSONWASM struct {
	PiA           string   `json:"piA"`
	PiB           string   `json:"piB"`
	PiC           string   `json:"piC"`
	Commitments   []string `json:"commitments,omitempty"`
	CommitmentPok string   `json:"commitmentPok,omitempty"`
}

// PublicJSONWASM matches the expected format
type PublicJSONWASM struct {
	Inputs         []string `json:"inputs"`
	CommitmentWire string   `json:"commitmentWire,omitempty"`
}

// Global state for loaded setup files
var (
	wasmCCS    constraint.ConstraintSystem
	wasmPK     groth16.ProvingKey
	wasmVK     groth16.VerifyingKey
	wasmLoaded bool
)

// wasmLoadSetup loads the CCS and PK from byte slices
func wasmLoadSetup(ccsBytes, pkBytes []byte) error {
	// Load CCS
	ccs := groth16.NewCS(ecc.BLS12_381)
	if _, err := ccs.ReadFrom(bytes.NewReader(ccsBytes)); err != nil {
		return fmt.Errorf("read ccs: %w", err)
	}

	// Load PK
	pk := groth16.NewProvingKey(ecc.BLS12_381)
	if _, err := pk.ReadFrom(bytes.NewReader(pkBytes)); err != nil {
		return fmt.Errorf("read pk: %w", err)
	}

	// We don't need VK for proving, but we'll keep it nil
	// VK is only needed for verification which happens on-chain

	wasmCCS = ccs
	wasmPK = pk
	wasmLoaded = true

	return nil
}

// wasmProve generates a SNARK proof
func wasmProve(aStr, rStr, vHex, w0Hex, w1Hex string) (*ProofResultWASM, error) {
	if !wasmLoaded {
		return nil, fmt.Errorf("setup not loaded - call gnarkLoadSetup first")
	}

	// Parse secrets
	a := new(big.Int)
	if _, ok := a.SetString(aStr, 0); !ok || a.Sign() == 0 {
		return nil, fmt.Errorf("could not parse a (must be non-zero integer)")
	}

	r := new(big.Int)
	if _, ok := r.SetString(rStr, 0); !ok {
		return nil, fmt.Errorf("could not parse r")
	}

	// Parse public G1 points
	vAff, err := parseG1CompressedHex(vHex)
	if err != nil {
		return nil, fmt.Errorf("invalid v: %w", err)
	}
	w0Aff, err := parseG1CompressedHex(w0Hex)
	if err != nil {
		return nil, fmt.Errorf("invalid w0: %w", err)
	}
	w1Aff, err := parseG1CompressedHex(w1Hex)
	if err != nil {
		return nil, fmt.Errorf("invalid w1: %w", err)
	}

	// Reduce secrets into Fr
	var aFr, rFr fr.Element
	aFr.SetBigInt(a)
	rFr.SetBigInt(r)

	var aRed, rRed big.Int
	aFr.BigInt(&aRed)
	rFr.BigInt(&rRed)

	// Extract affine coords to big.Int
	var vx, vy, w0x, w0y, w1x, w1y big.Int
	vAff.X.ToBigIntRegular(&vx)
	vAff.Y.ToBigIntRegular(&vy)
	w0Aff.X.ToBigIntRegular(&w0x)
	w0Aff.Y.ToBigIntRegular(&w0y)
	w1Aff.X.ToBigIntRegular(&w1x)
	w1Aff.Y.ToBigIntRegular(&w1y)

	// Create witness assignment using the circuit from kappa.go
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
		return nil, fmt.Errorf("new witness: %w", err)
	}
	publicWitness, err := witness.Public()
	if err != nil {
		return nil, fmt.Errorf("public witness: %w", err)
	}

	// Generate proof
	proof, err := groth16.Prove(wasmCCS, wasmPK, witness)
	if err != nil {
		return nil, fmt.Errorf("prove: %w", err)
	}

	// Export proof to JSON format
	proofJSON, err := exportProofBLS(proof)
	if err != nil {
		return nil, fmt.Errorf("export proof: %w", err)
	}

	// Export public inputs
	pubRaw, err := exportPublicInputs(publicWitness)
	if err != nil {
		return nil, fmt.Errorf("export public: %w", err)
	}

	// Prepend "1" for the constant wire (matches choosePublicInputs logic)
	inputs := append([]string{"1"}, pubRaw...)

	return &ProofResultWASM{
		Proof: ProofJSONWASM{
			PiA:           proofJSON.PiA,
			PiB:           proofJSON.PiB,
			PiC:           proofJSON.PiC,
			Commitments:   proofJSON.Commitments,
			CommitmentPok: proofJSON.CommitmentPok,
		},
		Public: PublicJSONWASM{
			Inputs: inputs,
		},
	}, nil
}

// gnarkLoadSetup is exposed to JavaScript to load the setup files
func gnarkLoadSetupJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return js.ValueOf(map[string]interface{}{
			"error": "gnarkLoadSetup requires 2 arguments: ccsBytes, pkBytes",
		})
	}

	// Get CCS bytes from Uint8Array
	ccsArray := args[0]
	ccsLen := ccsArray.Get("length").Int()
	ccsBytes := make([]byte, ccsLen)
	js.CopyBytesToGo(ccsBytes, ccsArray)

	// Get PK bytes from Uint8Array
	pkArray := args[1]
	pkLen := pkArray.Get("length").Int()
	pkBytes := make([]byte, pkLen)
	js.CopyBytesToGo(pkBytes, pkArray)

	fmt.Printf("Loading setup: CCS=%d bytes, PK=%d bytes\n", ccsLen, pkLen)

	// Load setup
	if err := wasmLoadSetup(ccsBytes, pkBytes); err != nil {
		return js.ValueOf(map[string]interface{}{
			"error": err.Error(),
		})
	}

	fmt.Println("Setup loaded successfully")
	return js.ValueOf(map[string]interface{}{
		"success": true,
	})
}

// gnarkProve is exposed to JavaScript for proof generation
func gnarkProveJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 5 {
		return js.ValueOf(map[string]interface{}{
			"error": "gnarkProve requires 5 arguments: secretA, secretR, publicV, publicW0, publicW1",
		})
	}

	secretA := args[0].String()
	secretR := args[1].String()
	publicV := args[2].String()
	publicW0 := args[3].String()
	publicW1 := args[4].String()

	fmt.Printf("Starting proof generation...\n")
	fmt.Printf("  secretA: %s\n", secretA[:min(20, len(secretA))]+"...")
	fmt.Printf("  secretR: %s\n", secretR[:min(20, len(secretR))]+"...")
	fmt.Printf("  publicV: %s...\n", publicV[:min(20, len(publicV))])
	fmt.Printf("  publicW0: %s...\n", publicW0[:min(20, len(publicW0))])
	fmt.Printf("  publicW1: %s...\n", publicW1[:min(20, len(publicW1))])

	result, err := wasmProve(secretA, secretR, publicV, publicW0, publicW1)
	if err != nil {
		fmt.Printf("Proof generation failed: %v\n", err)
		return js.ValueOf(map[string]interface{}{
			"error": err.Error(),
		})
	}

	fmt.Println("Proof generation successful!")

	// Convert to JSON string
	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("json marshal: %v", err),
		})
	}

	return js.ValueOf(string(jsonBytes))
}

// gnarkIsReady checks if setup has been loaded
func gnarkIsReadyJS(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(wasmLoaded)
}

// main is the entry point for WASM builds
func main() {
	fmt.Println("SNARK WASM prover loaded")
	fmt.Println("Available functions: gnarkLoadSetup, gnarkProve, gnarkIsReady")

	// Register JavaScript functions
	js.Global().Set("gnarkLoadSetup", js.FuncOf(gnarkLoadSetupJS))
	js.Global().Set("gnarkProve", js.FuncOf(gnarkProveJS))
	js.Global().Set("gnarkIsReady", js.FuncOf(gnarkIsReadyJS))

	// Keep the Go runtime alive
	<-make(chan struct{})
}
