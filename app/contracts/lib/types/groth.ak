//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Groth16 verifier (gnark variant with commitment extension)
//// - Main check as "pairing product == 1"
//// - Commitment PoK check as "pairing product == 1"
//// - Avoids uncompressing infinity by using (0 * alpha) for G1 identity

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_scalar_mul,
  bls12_381_g1_uncompress, bls12_381_g2_neg, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result,
}
use aiken/collection/list

// ---------- Types ----------

pub type CommitmentKey {
  g: ByteArray,
  // G2 compressed
  gSigmaNeg: ByteArray,
}

// G2 compressed (gnark's "GRootSigmaNeg"/similar)

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
  // len = nPublic + 1 (G1 compressed)

  // gnark commitment-extension verifier material
  commitmentKeys: List<CommitmentKey>,
}

pub type GrothProof {
  piA: ByteArray,
  // G1 compressed
  piB: ByteArray,
  // G2 compressed
  piC: ByteArray,
  // G1 compressed

  // gnark commitment-extension proof material
  commitments: List<ByteArray>,
  // list of G1 compressed (D_i)
  commitmentPok: ByteArray,
}

// G1 compressed (batched PoK)

// ---------- Helpers ----------

// vk_x = IC[0] + Σ public[i] * IC[i+1]
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

// Sum commitments without ever uncompressing infinity:
// - empty -> identity via (0 * alpha)
// - non-empty -> start acc from first commitment
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

// A MillerLoopResult representing 1 in GT: e(0_G1, seed_g2) = 1.
// 0_G1 is produced safely as (0 * seed_g1).
pub fn ml_one(seed_g1: G1Element, seed_g2: G2Element) -> MillerLoopResult {
  bls12_381_miller_loop(bls12_381_g1_scalar_mul(0, seed_g1), seed_g2)
}

// Commitment PoK check as "pairing product == 1":
//   e(D_sum, g) * e(pok, gSigmaNeg) == 1
pub fn verify_commitment_pok(
  vk: SnarkVerificationKey,
  d_sum: G1Element,
  proof: GrothProof,
  alpha: G1Element,
) -> Bool {
  if list.length(proof.commitments) == 0 {
    True
  } else {
    // Common gnark shape: single commitment key + single batched PoK
    expect list.length(vk.commitmentKeys) == 1

    let ck =
      when vk.commitmentKeys is {
        [] -> fail @"missing commitmentKeys"
        [x, ..] -> x
      }

    let g = bls12_381_g2_uncompress(ck.g)
    let g_sigma_neg = bls12_381_g2_uncompress(ck.gSigmaNeg)
    let pok = bls12_381_g1_uncompress(proof.commitmentPok)

    let prod =
      bls12_381_mul_miller_loop_result(
        bls12_381_miller_loop(d_sum, g),
        bls12_381_miller_loop(pok, g_sigma_neg),
      )

    bls12_381_final_verify(prod, ml_one(alpha, g))?
  }
}

// ---------- Main verifier ----------
//
// gnark commitment extension folds ΣD_i into the same G1 term paired with gamma.
// We do the main Groth16 check as a single "product == 1":
//
//   e(A, B)
// * e(vk_x + ΣD_i, -gamma)
// * e(C, -delta)
// * e(alpha, -beta)
// == 1
//
pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  public: List<Int>,
) -> Bool {
  // strict shape checks
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

  let vk_x =
    when vk.vkIC is {
      [] -> fail @"empty vkIC"
      [head, ..tail] -> derive_vk_x(tail, public, bls12_381_g1_uncompress(head))
    }

  let d_sum = sum_commitments(proof.commitments, alpha)
  let vk_x_ext = bls12_381_g1_add(vk_x, d_sum)

  let prod =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_mul_miller_loop_result(
          bls12_381_miller_loop(a, b),
          bls12_381_miller_loop(vk_x_ext, bls12_381_g2_neg(gamma)),
        ),
        bls12_381_miller_loop(c, bls12_381_g2_neg(delta)),
      ),
      bls12_381_miller_loop(alpha, bls12_381_g2_neg(beta)),
    )

  and {
    // Main Groth16(+commitments) product == 1
    bls12_381_final_verify(prod, ml_one(alpha, beta))?,
    // Commitment PoK product == 1
    verify_commitment_pok(vk, d_sum, proof, alpha)?,
  }
}
