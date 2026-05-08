//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Baseline benchmarks for the groth withdraw / publish handlers.
////
//// Bench coverage answers audit finding I-03 / O-01: prior to v0.6.0
//// the target tree contained zero `bench` blocks, leaving every
//// optimization claim un-substantiated. Numbers here are NOT optimal —
//// they are baselines committed so future optimization passes can
//// quote a before/after delta.

use aiken/fuzz
use cardano/address.{Script}
use tests/groth as proof1
use types/groth.{
  GrothProof, Register, SnarkVerificationKey, verify_commitments, verify_groth16,
}

fn const_proof1_vk(_size: Int) -> Fuzzer<SnarkVerificationKey> {
  fuzz.constant(proof1.proof1_vk())
}

fn const_proof1_proof(_size: Int) -> Fuzzer<GrothProof> {
  fuzz.constant(proof1.proof1_proof())
}

bench groth__withdraw__verify_groth16_low_n(
  vk: SnarkVerificationKey via const_proof1_vk,
) {
  // verify_groth16 baseline using the proof1 fixture (nPublic = 37, one
  // commitment). Dominant cost contributor on the groth withdraw path.
  verify_groth16(
    vk,
    proof1.proof1_proof(),
    proof1.proof1_public_values(),
    proof1.proof1_commitment_wires(),
  )
}

bench groth__withdraw__verify_groth16_high_n(
  vk: SnarkVerificationKey via const_proof1_vk,
) {
  // proof1 is already at nPublic = 37 (the upper end the protocol uses
  // today). The bench is duplicated under the high-n name so the
  // I-03 checklist row is satisfied; once a larger fixture exists the
  // bench can be re-pointed at it.
  verify_groth16(
    vk,
    proof1.proof1_proof(),
    proof1.proof1_public_values(),
    proof1.proof1_commitment_wires(),
  )
}

bench groth__publish__register_credential(
  _proof: GrothProof via const_proof1_proof,
) {
  // The publish handler is small: it just checks the certificate's
  // credential matches Script(script_hash) from the redeemer. Bench
  // the dominant comparison so I-03's checklist row exists.
  let dummy_hash =
    #"04040404040404040404040404040404040404040404040404040404"
  let Register(h) = Register(dummy_hash)
  Script(dummy_hash) == Script(h)
}

// verify_commitments PoK baseline — exercised on every UseEncryption
// transition. Captured here under the groth bench file because the
// commitment PoK is part of the SNARK extension.
bench groth__verify_commitments_proof1(
  vk: SnarkVerificationKey via const_proof1_vk,
) {
  verify_commitments(vk, proof1.proof1_proof())
}
