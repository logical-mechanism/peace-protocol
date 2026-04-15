//// Copyright 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: Apache-2.0
////
//// Shared types for the example_spend validator. Lives in lib/ so that
//// test modules can import the redeemer shape (Aiken disallows importing
//// validator modules from libraries).

use gnark_cardano/groth.{GrothProof}

/// Redeemer for the example_spend validator.
///
/// The first three fields are the raw G1 points the proof committed to,
/// and the last three are the proof material itself. Splitting it this way
/// keeps the application data (`pk`, `them`, `shared`) separate from the
/// crypto plumbing (`groth_proof`, `groth_commitment_wire`, `groth_public`).
pub type ExampleSpendRedeemer {
  // Application data: the three G1 points the prover committed to.
  pk: ByteArray,
  // 48-byte IETF compressed G1
  them: ByteArray,
  // 48-byte IETF compressed G1
  shared: ByteArray,
  // 48-byte IETF compressed G1

  // Proof material.
  groth_proof: GrothProof,
  // Commitment wire as 32 big-endian bytes (gnark's hash_to_field output).
  groth_commitment_wire: ByteArray,
  // The full public-input integer list as gnark would have computed it from
  // the three points above. The validator re-derives this list-of-points →
  // expected-bytes mapping, but it cannot recompute the limbs themselves
  // (that would require Fp arithmetic on-chain, which isn't worth the cost).
  // So the user supplies the limbs and the validator verifies they
  // reconstruct to the same compressed points it already trusts.
  groth_public: List<Int>,
}
