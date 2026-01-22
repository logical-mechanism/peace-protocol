//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_neg,
  bls12_381_g1_scalar_mul, bls12_381_g1_uncompress, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result,
}
use aiken/collection/list

// --- Constants ---
// BLS12-381 compressed point-at-infinity encoding: first byte 0xc0, rest 0.
// (c_flag=1, infinity_flag=1, x=0)

pub type CommitmentKey {
  g: ByteArray,
  // G2 compressed
  gSigmaNeg: ByteArray,
}

// G2 compressed (a.k.a. g' = -1/σ * g)

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
  // len = nPublic + 1, G1 compressed

  // NEW: gnark commitment extension verifier key material
  commitmentKeys: List<CommitmentKey>,
}

pub type GrothProof {
  piA: ByteArray,
  // G1 compressed
  piB: ByteArray,
  // G2 compressed
  piC: ByteArray,
  // G1 compressed

  // NEW: gnark commitment extension proof material
  commitments: List<ByteArray>,
  // list of G1 compressed (D_i)
  commitmentPok: ByteArray,
}

// G1 compressed (batched PoK)

// --- Helpers ---

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

// Sum commitments without ever uncompressing "infinity":
// - if empty, return identity via (0 * alpha)
// - else start accumulator from first element
pub fn sum_commitments(
  commitments: List<ByteArray>,
  alpha: G1Element,
) -> G1Element {
  when commitments is {
    [] -> bls12_381_g1_scalar_mul(0, alpha)

    [d0, ..rest] -> sum_commitments_acc(rest, bls12_381_g1_uncompress(d0))
  }
}

pub fn sum_commitments_acc(
  commitments: List<ByteArray>,
  acc: G1Element,
) -> G1Element {
  when commitments is {
    [] -> acc
    [d, ..rest] ->
      sum_commitments_acc(
        rest,
        bls12_381_g1_add(acc, bls12_381_g1_uncompress(d)),
      )
  }
}

// PoK check as an equality (no GT "1" needed):
// If gnark wants: e(D, g) * e(P, g') == 1
// then: e(D, g) == e(-P, g')
pub fn verify_commitment_pok(
  vk: SnarkVerificationKey,
  d_sum: G1Element,
  proof: GrothProof,
) -> Bool {
  if list.length(proof.commitments) == 0 {
    True
  } else {
    expect list.length(vk.commitmentKeys) == 1

    let ck =
      when vk.commitmentKeys is {
        [] -> fail @"missing commitmentKeys"
        [x, ..] -> x
      }

    let g = bls12_381_g2_uncompress(ck.g)
    let g_sigma_neg = bls12_381_g2_uncompress(ck.gSigmaNeg)
    let pok = bls12_381_g1_uncompress(proof.commitmentPok)

    let lhs = bls12_381_miller_loop(d_sum, g)
    let rhs = bls12_381_miller_loop(bls12_381_g1_neg(pok), g_sigma_neg)

    bls12_381_final_verify(lhs, rhs)
  }
}

pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  public: List<Int>,
) -> Bool {
  expect vk.nPublic > 0
  expect list.length(public) == vk.nPublic
  expect list.length(vk.vkIC) == vk.nPublic + 1

  let alpha = bls12_381_g1_uncompress(vk.vkAlpha)
  let beta = bls12_381_g2_uncompress(vk.vkBeta)
  let gamma = bls12_381_g2_uncompress(vk.vkGamma)
  let delta = bls12_381_g2_uncompress(vk.vkDelta)

  let a = bls12_381_g1_uncompress(proof.piA)
  let b = bls12_381_g2_uncompress(proof.piB)
  let c = bls12_381_g1_uncompress(proof.piC)

  let vk_x =
    when vk.vkIC is {
      [] -> fail @"empty vkIC"
      [head, ..tail] -> derive_vk_x(tail, public, bls12_381_g1_uncompress(head))
    }

  // NEW: commitment term folded into vk_x
  let d_sum = sum_commitments(proof.commitments, alpha)
  let vk_x_ext = bls12_381_g1_add(vk_x, d_sum)

  let lhs = bls12_381_miller_loop(a, b)

  let rhs =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_miller_loop(alpha, beta),
        bls12_381_miller_loop(vk_x_ext, gamma),
      ),
      bls12_381_miller_loop(c, delta),
    )

  and {
    bls12_381_final_verify(lhs, rhs)?,
    verify_commitment_pok(vk, d_sum, proof)?,
  }
}
