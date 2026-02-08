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
	"runtime"
	"runtime/debug"
	"syscall/js"

	"reflect"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr/hash_to_field"
	"github.com/consensys/gnark/backend/groth16"
	groth16bls "github.com/consensys/gnark/backend/groth16/bls12-381"
	backend_witness "github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
)

func init() {
	debug.SetGCPercent(50)
	debug.SetMemoryLimit(3 << 30) // 3 GiB limit
}

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
	fmt.Printf("[WASM] wasmLoadSetup called with CCS=%d bytes, PK=%d bytes\n", len(ccsBytes), len(pkBytes))

	// Load CCS
	fmt.Println("[WASM] Step 1/4: Creating constraint system object...")
	ccs := groth16.NewCS(ecc.BLS12_381)
	fmt.Println("[WASM] Step 1/4: Done. Constraint system object created.")

	fmt.Printf("[WASM] Step 2/4: Deserializing CCS (%d bytes)... This may take several minutes.\n", len(ccsBytes))
	fmt.Println("[WASM] (If browser shows 'unresponsive' dialog, click 'Wait' - do NOT close the tab)")
	if _, err := ccs.ReadFrom(bytes.NewReader(ccsBytes)); err != nil {
		return fmt.Errorf("read ccs: %w", err)
	}
	fmt.Println("[WASM] Step 2/4: Done. CCS deserialized successfully.")

	// Load PK
	fmt.Println("[WASM] Step 3/4: Creating proving key object...")
	pk := groth16.NewProvingKey(ecc.BLS12_381)
	fmt.Println("[WASM] Step 3/4: Done. Proving key object created.")

	fmt.Printf("[WASM] Step 4/4: Deserializing PK (%d bytes)... This is the longest step.\n", len(pkBytes))
	fmt.Println("[WASM] (The proving key contains millions of elliptic curve points to deserialize)")
	if _, err := pk.ReadFrom(bytes.NewReader(pkBytes)); err != nil {
		return fmt.Errorf("read pk: %w", err)
	}
	fmt.Println("[WASM] Step 4/4: Done. PK deserialized successfully.")

	// We don't need VK for proving, but we'll keep it nil
	// VK is only needed for verification which happens on-chain

	wasmCCS = ccs
	wasmPK = pk
	wasmLoaded = true

	fmt.Println("[WASM] Setup complete! Ready to generate proofs.")
	return nil
}

// wasmProve generates a SNARK proof
func wasmProve(aStr, rStr, vHex, w0Hex, w1Hex string) (*ProofResultWASM, error) {
	fmt.Println("[WASM] wasmProve: checking if setup is loaded...")
	if !wasmLoaded {
		return nil, fmt.Errorf("setup not loaded - call gnarkLoadSetup first")
	}
	fmt.Println("[WASM] wasmProve: setup is loaded, parsing secrets...")

	// Parse secrets
	a := new(big.Int)
	if _, ok := a.SetString(aStr, 0); !ok || a.Sign() == 0 {
		return nil, fmt.Errorf("could not parse a (must be non-zero integer)")
	}
	fmt.Printf("[WASM] wasmProve: parsed a = %s\n", a.String())

	r := new(big.Int)
	if _, ok := r.SetString(rStr, 0); !ok {
		return nil, fmt.Errorf("could not parse r")
	}
	fmt.Printf("[WASM] wasmProve: parsed r = %s\n", r.String())

	// Parse public G1 points
	fmt.Println("[WASM] wasmProve: parsing G1 point v...")
	vAff, err := parseG1CompressedHex(vHex)
	if err != nil {
		return nil, fmt.Errorf("invalid v: %w", err)
	}
	fmt.Println("[WASM] wasmProve: parsing G1 point w0...")
	w0Aff, err := parseG1CompressedHex(w0Hex)
	if err != nil {
		return nil, fmt.Errorf("invalid w0: %w", err)
	}
	fmt.Println("[WASM] wasmProve: parsing G1 point w1...")
	w1Aff, err := parseG1CompressedHex(w1Hex)
	if err != nil {
		return nil, fmt.Errorf("invalid w1: %w", err)
	}
	fmt.Println("[WASM] wasmProve: all G1 points parsed successfully")

	// Reduce secrets into Fr
	fmt.Println("[WASM] wasmProve: reducing secrets into Fr...")
	var aFr, rFr fr.Element
	aFr.SetBigInt(a)
	rFr.SetBigInt(r)

	var aRed, rRed big.Int
	aFr.BigInt(&aRed)
	rFr.BigInt(&rRed)
	fmt.Printf("[WASM] wasmProve: reduced a = %s, r = %s\n", aRed.String(), rRed.String())

	// Extract affine coords to big.Int
	fmt.Println("[WASM] wasmProve: extracting affine coordinates...")
	var vx, vy, w0x, w0y, w1x, w1y big.Int
	vAff.X.ToBigIntRegular(&vx)
	vAff.Y.ToBigIntRegular(&vy)
	w0Aff.X.ToBigIntRegular(&w0x)
	w0Aff.Y.ToBigIntRegular(&w0y)
	w1Aff.X.ToBigIntRegular(&w1x)
	w1Aff.Y.ToBigIntRegular(&w1y)
	fmt.Println("[WASM] wasmProve: affine coordinates extracted")

	// Create witness assignment using the circuit from kappa.go
	fmt.Println("[WASM] wasmProve: creating witness assignment...")
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
	fmt.Println("[WASM] wasmProve: witness assignment created")

	fmt.Println("[WASM] wasmProve: creating frontend witness...")
	witness, err := frontend.NewWitness(&assignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return nil, fmt.Errorf("new witness: %w", err)
	}
	fmt.Println("[WASM] wasmProve: frontend witness created")

	fmt.Println("[WASM] wasmProve: extracting public witness...")
	publicWitness, err := witness.Public()
	if err != nil {
		return nil, fmt.Errorf("public witness: %w", err)
	}
	fmt.Println("[WASM] wasmProve: public witness extracted")

	// Generate proof - reclaim memory first to maximize headroom
	runtime.GC()
	debug.FreeOSMemory()
	fmt.Println("[WASM] wasmProve: starting groth16.Prove (this is the heavy computation)...")
	proof, err := groth16.Prove(wasmCCS, wasmPK, witness)
	if err != nil {
		return nil, fmt.Errorf("prove: %w", err)
	}
	fmt.Println("[WASM] wasmProve: groth16.Prove completed successfully!")

	// Export proof to JSON format
	fmt.Println("[WASM] wasmProve: exporting proof to JSON format...")
	proofJSON, err := exportProofBLS(proof)
	if err != nil {
		return nil, fmt.Errorf("export proof: %w", err)
	}
	fmt.Println("[WASM] wasmProve: proof exported successfully")

	// Export public inputs
	fmt.Println("[WASM] wasmProve: exporting public inputs...")
	pubRaw, err := exportPublicInputs(publicWitness)
	if err != nil {
		return nil, fmt.Errorf("export public: %w", err)
	}
	fmt.Printf("[WASM] wasmProve: exported %d public inputs\n", len(pubRaw))

	// Prepend "1" for the constant wire (matches choosePublicInputs logic)
	inputs := append([]string{"1"}, pubRaw...)

	// Compute commitment wire (needed for on-chain Groth16 verification)
	fmt.Println("[WASM] wasmProve: computing commitment wire...")
	commitmentWire, err := computeCommitmentWireNoVK(proof, publicWitness)
	if err != nil {
		fmt.Printf("[WASM] WARNING: failed to compute commitment wire: %v\n", err)
		// Non-fatal: continue without it (will fail on-chain verification)
	} else if commitmentWire != "" {
		fmt.Printf("[WASM] wasmProve: commitment wire = %s\n", commitmentWire)
	}

	fmt.Println("[WASM] wasmProve: creating result struct...")
	result := &ProofResultWASM{
		Proof: ProofJSONWASM{
			PiA:           proofJSON.PiA,
			PiB:           proofJSON.PiB,
			PiC:           proofJSON.PiC,
			Commitments:   proofJSON.Commitments,
			CommitmentPok: proofJSON.CommitmentPok,
		},
		Public: PublicJSONWASM{
			Inputs:         inputs,
			CommitmentWire: commitmentWire,
		},
	}
	fmt.Println("[WASM] wasmProve: COMPLETE - returning result")
	return result, nil
}

// computeCommitmentWireNoVK computes the commitment wire without a VK.
// It hardcodes the committed indices [1..36] which is a fixed property of the
// vw0w1Circuit (all public inputs are committed). This avoids needing to load
// the VK in the WASM, saving ~99 minutes of deserialization.
func computeCommitmentWireNoVK(proof groth16.Proof, publicWitness backend_witness.Witness) (string, error) {
	p, ok := proof.(*groth16bls.Proof)
	if !ok {
		return "", fmt.Errorf("unexpected proof type: %T", proof)
	}
	if len(p.Commitments) == 0 {
		return "", nil // No commitment extension
	}

	// Get public witness as Fr elements
	vecAny := publicWitness.Vector()
	if vecAny == nil {
		return "", fmt.Errorf("publicWitness.Vector() returned nil")
	}

	var pubFr []fr.Element
	switch v := vecAny.(type) {
	case []fr.Element:
		pubFr = v
	default:
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
			if ev.Type() == reflect.TypeOf(fr.Element{}) {
				pubFr[i] = ev.Interface().(fr.Element)
			} else {
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

	// All 36 public inputs are committed (indices 1-36, 1-based).
	// This is a fixed property of the vw0w1Circuit.
	commitment := p.Commitments[0]
	commitmentBytes := commitment.Marshal() // 96 bytes uncompressed G1

	prehash := make([]byte, 0, len(commitmentBytes)+len(pubFr)*32)
	prehash = append(prehash, commitmentBytes...)

	for i := 0; i < len(pubFr); i++ {
		frBytes := pubFr[i].Marshal() // 32 bytes big-endian Fr
		prehash = append(prehash, frBytes...)
	}

	hFunc := hash_to_field.New([]byte(constraint.CommitmentDst))
	hFunc.Write(prehash)
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

	// Drop big buffers and reclaim memory before proving
	ccsBytes = nil
	pkBytes = nil
	runtime.GC()
	debug.FreeOSMemory()

	fmt.Println("Setup loaded successfully")
	return js.ValueOf(map[string]interface{}{
		"success": true,
	})
}

// gnarkProve is exposed to JavaScript for proof generation
func gnarkProveJS(this js.Value, args []js.Value) interface{} {
	fmt.Println("[WASM] gnarkProveJS: function called")

	// We cannot use defer/recover with named return values in WASM callbacks reliably
	// Instead, we wrap the entire logic in a helper and catch panics manually

	return gnarkProveJSInner(args)
}

// gnarkProveJSInner is the actual implementation, separated for clarity
func gnarkProveJSInner(args []js.Value) (result interface{}) {
	// Recover from panics and return error to JavaScript
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("[WASM] PANIC in gnarkProve: %v\n", r)
			result = js.ValueOf(map[string]interface{}{
				"error": fmt.Sprintf("panic: %v", r),
			})
		}
	}()

	fmt.Println("[WASM] gnarkProveJSInner: starting...")

	if len(args) < 5 {
		fmt.Println("[WASM] gnarkProveJSInner: not enough arguments")
		return js.ValueOf(map[string]interface{}{
			"error": "gnarkProve requires 5 arguments: secretA, secretR, publicV, publicW0, publicW1",
		})
	}

	fmt.Println("[WASM] gnarkProveJSInner: extracting arguments...")
	secretA := args[0].String()
	secretR := args[1].String()
	publicV := args[2].String()
	publicW0 := args[3].String()
	publicW1 := args[4].String()

	// Validate inputs before logging (avoid slice bounds errors)
	fmt.Println("[WASM] Starting proof generation...")
	fmt.Printf("[WASM]   secretA: %s\n", secretA)
	fmt.Printf("[WASM]   secretR: %s\n", secretR)
	fmt.Printf("[WASM]   publicV length: %d (expected 96)\n", len(publicV))
	fmt.Printf("[WASM]   publicW0 length: %d (expected 96)\n", len(publicW0))
	fmt.Printf("[WASM]   publicW1 length: %d (expected 96)\n", len(publicW1))

	// Validate G1 point lengths (should be 96 hex chars = 48 bytes compressed)
	if len(publicV) != 96 {
		fmt.Printf("[WASM] ERROR: publicV has wrong length\n")
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("publicV must be 96 hex chars (got %d)", len(publicV)),
		})
	}
	if len(publicW0) != 96 {
		fmt.Printf("[WASM] ERROR: publicW0 has wrong length\n")
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("publicW0 must be 96 hex chars (got %d)", len(publicW0)),
		})
	}
	if len(publicW1) != 96 {
		fmt.Printf("[WASM] ERROR: publicW1 has wrong length\n")
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("publicW1 must be 96 hex chars (got %d)", len(publicW1)),
		})
	}

	fmt.Println("[WASM] Input validation passed, calling wasmProve...")

	proofResult, err := wasmProve(secretA, secretR, publicV, publicW0, publicW1)
	if err != nil {
		fmt.Printf("[WASM] Proof generation failed: %v\n", err)
		return js.ValueOf(map[string]interface{}{
			"error": err.Error(),
		})
	}

	if proofResult == nil {
		fmt.Println("[WASM] ERROR: proofResult is nil!")
		return js.ValueOf(map[string]interface{}{
			"error": "proofResult is nil - this should not happen",
		})
	}

	fmt.Println("[WASM] Proof generation successful! Marshaling to JSON...")

	// Convert to JSON string
	jsonBytes, err := json.Marshal(proofResult)
	if err != nil {
		fmt.Printf("[WASM] ERROR: JSON marshal failed: %v\n", err)
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("json marshal: %v", err),
		})
	}

	fmt.Printf("[WASM] Proof JSON size: %d bytes\n", len(jsonBytes))
	fmt.Println("[WASM] gnarkProveJSInner: returning JSON string result")

	jsonStr := string(jsonBytes)
	fmt.Printf("[WASM] JSON string preview (first 200 chars): %.200s...\n", jsonStr)

	return js.ValueOf(jsonStr)
}

// gnarkIsReady checks if setup has been loaded
func gnarkIsReadyJS(this js.Value, args []js.Value) interface{} {
	return js.ValueOf(wasmLoaded)
}

// gnarkGtToHash computes the GT hash from scalar a.
// This is a lightweight operation that doesn't require the proving key setup.
// Used for creating encryption listings.
//
// Args:
//   - aStr: secret scalar a (decimal or 0x hex string, must be > 0)
//
// Returns:
//   - JSON object with "hash" (hex string) or "error"
func gnarkGtToHashJS(this js.Value, args []js.Value) interface{} {
	fmt.Println("[WASM] gnarkGtToHash: function called")

	if len(args) < 1 {
		return js.ValueOf(map[string]interface{}{
			"error": "gnarkGtToHash requires 1 argument: secretA",
		})
	}

	aStr := args[0].String()
	fmt.Printf("[WASM] gnarkGtToHash: parsing a = %s\n", aStr)

	a := new(big.Int)
	if _, ok := a.SetString(aStr, 0); !ok || a.Sign() == 0 {
		return js.ValueOf(map[string]interface{}{
			"error": "could not parse a (must be a non-zero integer; decimal or 0x.. hex)",
		})
	}

	fmt.Println("[WASM] gnarkGtToHash: computing pairing and MiMC hash...")
	hkHex, _, err := gtToHash(a)
	if err != nil {
		fmt.Printf("[WASM] gnarkGtToHash: error: %v\n", err)
		return js.ValueOf(map[string]interface{}{
			"error": err.Error(),
		})
	}

	fmt.Printf("[WASM] gnarkGtToHash: success, hash = %s\n", hkHex)
	return js.ValueOf(map[string]interface{}{
		"hash": hkHex,
	})
}

// gnarkDecryptToHash computes the decryption hop key hash.
// This is a lightweight operation that doesn't require the proving key setup.
// Used for decrypting encrypted data.
//
// Args:
//   - g1bHex: G1 compressed hex (96 chars) - entry["fields"][1]["fields"][0]["bytes"]
//   - r1Hex: G1 compressed hex (96 chars) - entry["fields"][0]["bytes"]
//   - sharedHex: G2 compressed hex (192 chars) - current shared value
//   - g2bHex: optional G2 compressed hex (192 chars) or empty string - for full level entries
//
// Returns:
//   - JSON object with "hash" (hex string) or "error"
func gnarkDecryptToHashJS(this js.Value, args []js.Value) interface{} {
	fmt.Println("[WASM] gnarkDecryptToHash: function called")

	if len(args) < 4 {
		return js.ValueOf(map[string]interface{}{
			"error": "gnarkDecryptToHash requires 4 arguments: g1bHex, r1Hex, sharedHex, g2bHex (use empty string for half-level)",
		})
	}

	g1bHex := args[0].String()
	r1Hex := args[1].String()
	sharedHex := args[2].String()
	g2bHex := args[3].String()

	fmt.Printf("[WASM] gnarkDecryptToHash: g1b=%d chars, r1=%d chars, shared=%d chars, g2b=%d chars\n",
		len(g1bHex), len(r1Hex), len(sharedHex), len(g2bHex))

	// Validate G1 points (96 hex chars)
	if len(g1bHex) != 96 {
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("g1bHex must be 96 hex chars (got %d)", len(g1bHex)),
		})
	}
	if len(r1Hex) != 96 {
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("r1Hex must be 96 hex chars (got %d)", len(r1Hex)),
		})
	}
	// Validate G2 point (192 hex chars)
	if len(sharedHex) != 192 {
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("sharedHex must be 192 hex chars (got %d)", len(sharedHex)),
		})
	}
	// g2bHex can be empty (for half-level) or 192 chars (for full-level)
	if g2bHex != "" && len(g2bHex) != 192 {
		return js.ValueOf(map[string]interface{}{
			"error": fmt.Sprintf("g2bHex must be empty or 192 hex chars (got %d)", len(g2bHex)),
		})
	}

	fmt.Println("[WASM] gnarkDecryptToHash: computing decryption hash...")
	hashHex, err := DecryptToHash(g1bHex, g2bHex, r1Hex, sharedHex)
	if err != nil {
		fmt.Printf("[WASM] gnarkDecryptToHash: error: %v\n", err)
		return js.ValueOf(map[string]interface{}{
			"error": err.Error(),
		})
	}

	fmt.Printf("[WASM] gnarkDecryptToHash: success, hash = %s\n", hashHex)
	return js.ValueOf(map[string]interface{}{
		"hash": hashHex,
	})
}

// main is the entry point for WASM builds
func main() {
	fmt.Println("SNARK WASM prover loaded")
	fmt.Println("Available functions: gnarkLoadSetup, gnarkProve, gnarkIsReady, gnarkGtToHash, gnarkDecryptToHash")

	// Register JavaScript functions
	js.Global().Set("gnarkLoadSetup", js.FuncOf(gnarkLoadSetupJS))
	js.Global().Set("gnarkProve", js.FuncOf(gnarkProveJS))
	js.Global().Set("gnarkIsReady", js.FuncOf(gnarkIsReadyJS))
	js.Global().Set("gnarkGtToHash", js.FuncOf(gnarkGtToHashJS))
	js.Global().Set("gnarkDecryptToHash", js.FuncOf(gnarkDecryptToHashJS))

	// Keep the Go runtime alive
	<-make(chan struct{})
}
