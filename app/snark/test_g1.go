//go:build ignore

package main

import (
	"fmt"
	"math/big"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
)

func main() {
	// Get G1 generator
	_, _, g1Gen, _ := bls12381.Generators()
	
	fmt.Printf("Go G1 base point:\n")
	fmt.Printf("  x: %s\n", g1Gen.X.String())
	fmt.Printf("  y: %s\n", g1Gen.Y.String())
	
	// Compute 2 * G1
	var result bls12381.G1Jac
	result.FromAffine(&g1Gen)
	result.ScalarMultiplication(&result, big.NewInt(2))
	
	var resultAff bls12381.G1Affine
	resultAff.FromJacobian(&result)
	
	fmt.Printf("\nGo 2*G1:\n")
	fmt.Printf("  x: %s\n", resultAff.X.String())
	fmt.Printf("  y: %s\n", resultAff.Y.String())
}
