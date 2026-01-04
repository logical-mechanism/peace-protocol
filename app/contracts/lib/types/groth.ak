//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_neg,
  bls12_381_g1_scalar_mul, bls12_381_g1_uncompress, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result,
}
use aiken/collection/list

pub type SnarkVerificationKey {
  nPublic: Int,
  vkAlpha: ByteArray,
  // G1 compressed
  vkBeta: ByteArray,
  // G2 compressed
  vkGamma: ByteArray,
  // G2 compressed
  vkDelta: ByteArray,
  // G2 compressed
  vkIC: List<ByteArray>,
}

// len = nPublic + 1, G1 compressed

pub type GrothProof {
  piA: ByteArray,
  // G1 compressed
  piB: ByteArray,
  // G2 compressed
  piC: ByteArray,
}

// G1 compressed

pub fn pairing(g1: ByteArray, g2: ByteArray) -> MillerLoopResult {
  bls12_381_miller_loop(
    bls12_381_g1_uncompress(g1),
    bls12_381_g2_uncompress(g2),
  )
}

pub fn derive(
  vk_ic: List<ByteArray>,
  public: List<Int>,
  acc: G1Element,
) -> G1Element {
  when vk_ic is {
    [] -> acc
    [ic_i, ..vk_ic] ->
      when public is {
        [] -> fail @"public shorter than vkIC tail"
        [s, ..public] ->
          derive(
            vk_ic,
            public,
            bls12_381_g1_add(
              acc,
              bls12_381_g1_scalar_mul(s, bls12_381_g1_uncompress(ic_i)),
            ),
          )
      }
  }
}

pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  public: List<Int>,
) -> Bool {
  // --- Strict shape checks (prevents silent mismatch) ---
  expect vk.nPublic > 0

  expect list.length(public) == vk.nPublic

  expect list.length(vk.vkIC) == vk.nPublic + 1

  // --- Build vk_x (aka vkI) ---
  let vkI =
    when vk.vkIC is {
      [] -> fail @"empty vkIC"
      [head, ..tail] -> derive(tail, public, bls12_381_g1_uncompress(head))
    }

  // --- RHS = e(alpha,beta) * e(vk_x,gamma) * e(C,delta) ---
  let eAlphaBeta = pairing(vk.vkAlpha, vk.vkBeta)

  let eIGamma = bls12_381_miller_loop(vkI, bls12_381_g2_uncompress(vk.vkGamma))

  let eCDelta = pairing(proof.piC, vk.vkDelta)

  let rhs =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(eAlphaBeta, eIGamma),
      eCDelta,
    )

  // --- LHS = e(A,B) ---
  let a = bls12_381_g1_uncompress(proof.piA)
  let b = bls12_381_g2_uncompress(proof.piB)

  let lhs = bls12_381_miller_loop(a, b)

  // Try the two conventions you already discovered in Python:
  // 1) A
  // 2) -A
  if bls12_381_final_verify(lhs, rhs) {
    True
  } else {
    bls12_381_final_verify(bls12_381_miller_loop(bls12_381_g1_neg(a), b), rhs)
  }
}
