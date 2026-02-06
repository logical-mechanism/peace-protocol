// Copyright (C) 2025 Logical Mechanism LLC
// SPDX-License-Identifier: GPL-3.0-only

// debug_verify.go

package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
)

func debugVerify() {
	outDir := "out"

	// Load VK
	vkData, err := os.ReadFile(filepath.Join(outDir, "vk.json"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "read vk.json: %v\n", err)
		os.Exit(1)
	}
	var vkJSON VKJSON
	if err := json.Unmarshal(vkData, &vkJSON); err != nil {
		fmt.Fprintf(os.Stderr, "unmarshal vk.json: %v\n", err)
		os.Exit(1)
	}

	// Load public inputs
	publicData, err := os.ReadFile(filepath.Join(outDir, "public.json"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "read public.json: %v\n", err)
		os.Exit(1)
	}
	var publicJSON PublicJSON
	if err := json.Unmarshal(publicData, &publicJSON); err != nil {
		fmt.Fprintf(os.Stderr, "unmarshal public.json: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("nPublic: %d\n", vkJSON.NPublic)
	fmt.Printf("len(IC): %d\n", len(vkJSON.VkIC))
	fmt.Printf("len(public inputs): %d\n", len(publicJSON.Inputs))
	fmt.Printf("inputs[0]: %s\n", publicJSON.Inputs[0])

	// Parse IC
	IC := make([]bls12381.G1Affine, len(vkJSON.VkIC))
	for i, icHex := range vkJSON.VkIC {
		raw, err := hex.DecodeString(icHex)
		if err != nil {
			fmt.Fprintf(os.Stderr, "decode IC[%d]: %v\n", i, err)
			os.Exit(1)
		}
		if _, err := IC[i].SetBytes(raw); err != nil {
			fmt.Fprintf(os.Stderr, "IC[%d].SetBytes: %v\n", i, err)
			os.Exit(1)
		}
	}

	// Compute vk_x using the exported public inputs (including leading "1")
	fmt.Println("\n=== vk_x with all 37 public inputs (including leading '1') ===")
	vkx_full := IC[0]
	for i := 0; i < len(publicJSON.Inputs); i++ {
		var s fr.Element
		if _, err := s.SetString(publicJSON.Inputs[i]); err != nil {
			fmt.Fprintf(os.Stderr, "parse input[%d]: %v\n", i, err)
			os.Exit(1)
		}
		var sBig big.Int
		s.BigInt(&sBig)
		var term bls12381.G1Affine
		term.ScalarMultiplication(&IC[i+1], &sBig)
		vkx_full.Add(&vkx_full, &term)
	}
	vkx_full_bytes := vkx_full.Bytes()
	fmt.Printf("vk_x (hex): %s\n", hex.EncodeToString(vkx_full_bytes[:]))

	// Compute vk_x using only the 36 public inputs (skipping leading "1")
	fmt.Println("\n=== vk_x with 36 public inputs (skipping leading '1') ===")
	vkx_36 := IC[0]
	for i := 1; i < len(publicJSON.Inputs); i++ {
		var s fr.Element
		if _, err := s.SetString(publicJSON.Inputs[i]); err != nil {
			fmt.Fprintf(os.Stderr, "parse input[%d]: %v\n", i, err)
			os.Exit(1)
		}
		var sBig big.Int
		s.BigInt(&sBig)
		var term bls12381.G1Affine
		term.ScalarMultiplication(&IC[i], &sBig)
		vkx_36.Add(&vkx_36, &term)
	}
	vkx_36_bytes := vkx_36.Bytes()
	fmt.Printf("vk_x (hex): %s\n", hex.EncodeToString(vkx_36_bytes[:]))

	// Compute vk_x using 36 inputs with only 37 IC elements
	fmt.Println("\n=== vk_x with 36 inputs and first 37 IC elements ===")
	vkx_37ic := IC[0]
	for i := 1; i < len(publicJSON.Inputs); i++ {
		var s fr.Element
		if _, err := s.SetString(publicJSON.Inputs[i]); err != nil {
			fmt.Fprintf(os.Stderr, "parse input[%d]: %v\n", i, err)
			os.Exit(1)
		}
		if i >= 37 {
			fmt.Println("  WARNING: i >= 37, skipping")
			continue
		}
		var sBig big.Int
		s.BigInt(&sBig)
		var term bls12381.G1Affine
		term.ScalarMultiplication(&IC[i], &sBig)
		vkx_37ic.Add(&vkx_37ic, &term)
	}
	vkx_37ic_bytes := vkx_37ic.Bytes()
	fmt.Printf("vk_x (hex): %s\n", hex.EncodeToString(vkx_37ic_bytes[:]))

	// Now load proof and VK and verify using gnark
	fmt.Println("\n=== Verifying with gnark ===")

	// Load proof
	proofData, err := os.ReadFile(filepath.Join(outDir, "proof.json"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "read proof.json: %v\n", err)
		os.Exit(1)
	}
	var proofJSON ProofJSON
	if err := json.Unmarshal(proofData, &proofJSON); err != nil {
		fmt.Fprintf(os.Stderr, "unmarshal proof.json: %v\n", err)
		os.Exit(1)
	}

	// Parse proof elements
	var A, C bls12381.G1Affine
	rawA, _ := hex.DecodeString(proofJSON.PiA)
	A.SetBytes(rawA)
	rawC, _ := hex.DecodeString(proofJSON.PiC)
	C.SetBytes(rawC)

	var B bls12381.G2Affine
	rawB, _ := hex.DecodeString(proofJSON.PiB)
	B.SetBytes(rawB)

	// Parse VK elements
	var alpha bls12381.G1Affine
	rawAlpha, _ := hex.DecodeString(vkJSON.VkAlpha)
	alpha.SetBytes(rawAlpha)

	var beta, gamma, delta bls12381.G2Affine
	rawBeta, _ := hex.DecodeString(vkJSON.VkBeta)
	beta.SetBytes(rawBeta)
	rawGamma, _ := hex.DecodeString(vkJSON.VkGamma)
	gamma.SetBytes(rawGamma)
	rawDelta, _ := hex.DecodeString(vkJSON.VkDelta)
	delta.SetBytes(rawDelta)

	// Compute pairings: e(A, B) == e(α, β) * e(vk_x, γ) * e(C, δ)
	// Using the 36-input vk_x
	left, _ := bls12381.Pair([]bls12381.G1Affine{A}, []bls12381.G2Affine{B})

	p1, _ := bls12381.Pair([]bls12381.G1Affine{alpha}, []bls12381.G2Affine{beta})
	p2, _ := bls12381.Pair([]bls12381.G1Affine{vkx_37ic}, []bls12381.G2Affine{gamma})
	p3, _ := bls12381.Pair([]bls12381.G1Affine{C}, []bls12381.G2Affine{delta})

	right := p1
	right.Mul(&right, &p2)
	right.Mul(&right, &p3)

	fmt.Printf("left == right (with 36-input vk_x): %v\n", left.Equal(&right))

	// Try with 37-input vk_x
	p2_full, _ := bls12381.Pair([]bls12381.G1Affine{vkx_full}, []bls12381.G2Affine{gamma})
	right_full := p1
	right_full.Mul(&right_full, &p2_full)
	right_full.Mul(&right_full, &p3)

	fmt.Printf("left == right (with 37-input vk_x): %v\n", left.Equal(&right_full))

	// Try alternative formulation: e(A,B) · e(vk_x, -γ) · e(C, -δ) = e(α, β)
	fmt.Println("\n=== Alternative: e(A,B) · e(vk_x, -γ) · e(C, -δ) = e(α, β) ===")

	var neg_gamma, neg_delta bls12381.G2Affine
	neg_gamma.Neg(&gamma)
	neg_delta.Neg(&delta)

	p2_neg, _ := bls12381.Pair([]bls12381.G1Affine{vkx_37ic}, []bls12381.G2Affine{neg_gamma})
	p3_neg, _ := bls12381.Pair([]bls12381.G1Affine{C}, []bls12381.G2Affine{neg_delta})

	left_alt := left
	left_alt.Mul(&left_alt, &p2_neg)
	left_alt.Mul(&left_alt, &p3_neg)

	fmt.Printf("left_alt == p1 (with 36-input vk_x, negated γ,δ): %v\n", left_alt.Equal(&p1))

	// Try with negated A: e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
	fmt.Println("\n=== Alternative: e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1 ===")

	var neg_A bls12381.G1Affine
	neg_A.Neg(&A)

	p_negA_B, _ := bls12381.Pair([]bls12381.G1Affine{neg_A}, []bls12381.G2Affine{B})

	product := p_negA_B
	product.Mul(&product, &p1)
	product.Mul(&product, &p2)
	product.Mul(&product, &p3)

	var one bls12381.GT
	one.SetOne()

	fmt.Printf("product == 1 (with 36-input vk_x, -A): %v\n", product.Equal(&one))
}
