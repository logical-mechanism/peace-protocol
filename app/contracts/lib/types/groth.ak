//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_scalar_mul,
  bls12_381_g1_uncompress, bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result,
}

pub type SnarkVerificationKey {
  nPublic: Int,
  // G1 compressed
  vkAlpha: ByteArray,
  // G2 compressed
  vkBeta: ByteArray,
  // G2 compressed
  vkGamma: ByteArray,
  // G2 compressed
  vkDelta: ByteArray,
  // list of G1 compressed, length = nPublic + 1
  vkIC: List<ByteArray>,
}

pub type GrothProof {
  // G1 compressed
  piA: ByteArray,
  // G2 compressed
  piB: ByteArray,
  // G1 compressed
  piC: ByteArray,
}

pub fn pairing(g1: ByteArray, g2: ByteArray) -> MillerLoopResult {
  bls12_381_miller_loop(
    bls12_381_g1_uncompress(g1),
    bls12_381_g2_uncompress(g2),
  )
}

pub fn derive(
  vk_ic: List<ByteArray>,
  public: List<Int>,
  result: G1Element,
) -> G1Element {
  when vk_ic is {
    [] -> result
    [i, ..vk_ic] ->
      when public is {
        [] -> fail
        [scalar, ..public] ->
          derive(
            vk_ic,
            public,
            bls12_381_g1_add(
              result,
              bls12_381_g1_scalar_mul(scalar, bls12_381_g1_uncompress(i)),
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
  // let n = vk.nPublic
  let eAB = pairing(proof.piA, proof.piB)
  let eAlphaBeta = pairing(vk.vkAlpha, vk.vkBeta)

  let vkI =
    when vk.vkIC is {
      [] -> fail @"empty vkIC?"
      [head, ..tail] -> derive(tail, public, bls12_381_g1_uncompress(head))
    }

  let eIGamma = bls12_381_miller_loop(vkI, bls12_381_g2_uncompress(vk.vkGamma))
  let eCDelta = pairing(proof.piC, vk.vkDelta)

  // * Miller functions
  let mlr1 = bls12_381_mul_miller_loop_result(eAlphaBeta, eIGamma)
  let mlr2 = bls12_381_mul_miller_loop_result(mlr1, eCDelta)

  bls12_381_final_verify(eAB, mlr2)
}
