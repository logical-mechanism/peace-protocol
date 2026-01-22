//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_scalar_mul,
  bls12_381_g1_uncompress, bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result,
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

pub fn derive_vk_x(
  vk_ic_tail: List<ByteArray>,
  public: List<Int>,
  acc: G1Element,
) -> G1Element {
  when vk_ic_tail is {
    [] -> acc
    [ic_i, ..rest_ic] ->
      when public is {
        [] -> fail @"public shorter than vkIC tail"
        [s, ..rest_public] ->
          derive_vk_x(
            rest_ic,
            rest_public,
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
  // strict shape checks (your test vectors assume these)
  expect vk.nPublic > 0
  expect list.length(public) == vk.nPublic
  expect list.length(vk.vkIC) == vk.nPublic + 1

  // uncompress once
  let alpha = bls12_381_g1_uncompress(vk.vkAlpha)
  let beta = bls12_381_g2_uncompress(vk.vkBeta)
  let gamma = bls12_381_g2_uncompress(vk.vkGamma)
  let delta = bls12_381_g2_uncompress(vk.vkDelta)

  let a = bls12_381_g1_uncompress(proof.piA)
  let b = bls12_381_g2_uncompress(proof.piB)
  let c = bls12_381_g1_uncompress(proof.piC)

  // vk_x = IC[0] + Σ inputs[i] * IC[i+1]
  let vk_x =
    when vk.vkIC is {
      [] -> fail @"empty vkIC"
      [head, ..tail] -> derive_vk_x(tail, public, bls12_381_g1_uncompress(head))
    }

  // lhs = e(A, B)
  let lhs = bls12_381_miller_loop(a, b)

  // rhs = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
  let rhs =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_miller_loop(alpha, beta),
        bls12_381_miller_loop(vk_x, gamma),
      ),
      bls12_381_miller_loop(c, delta),
    )

  bls12_381_final_verify(lhs, rhs)
}
