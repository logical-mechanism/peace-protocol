// Copyright 2025-2026 Logical Mechanism LLC
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"encoding/hex"
	"fmt"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
)

// G1CompressedHex serializes a BLS12-381 G1Affine point to its 48-byte IETF
// compressed form and returns it as a lowercase hex string (96 characters).
func G1CompressedHex(p bls12381.G1Affine) (string, error) {
	b := p.Bytes() // 48 bytes compressed (IETF)
	if len(b) != 48 {
		return "", fmt.Errorf("unexpected G1 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}

// G2CompressedHex serializes a BLS12-381 G2Affine point to its 96-byte IETF
// compressed form and returns it as a lowercase hex string (192 characters).
func G2CompressedHex(p bls12381.G2Affine) (string, error) {
	b := p.Bytes() // 96 bytes compressed (IETF)
	if len(b) != 96 {
		return "", fmt.Errorf("unexpected G2 compressed length: %d", len(b))
	}
	return hex.EncodeToString(b[:]), nil
}
