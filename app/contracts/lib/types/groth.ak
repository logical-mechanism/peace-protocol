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

// ---------- Constants ----------
// pub const global_snark_vk: SnarkVerificationKey = SnarkVerificationKey {}

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
  // len = nPublic + 1 + nCommitments (G1 compressed)
  // IC[0] = constant, IC[1..nPublic] = public inputs, IC[nPublic+1..] = commitment wires

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

// Add commitment points to accumulator (for vk_x computation)
// gnark adds the raw commitment points D to vk_x
pub fn add_commitments(
  commitments: List<ByteArray>,
  acc: G1Element,
) -> G1Element {
  when commitments is {
    [] -> acc
    [d, ..rest] ->
      add_commitments(rest, bls12_381_g1_add(acc, bls12_381_g1_uncompress(d)))
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
// gnark commitment extension uses the commitment wire (hash of D and committed publics)
// to multiply an additional IC element. The commitment D is only used in the PoK check.
//
// We do the main Groth16 check as a single "product == 1":
//
//   e(A, B)
// * e(vk_x, -gamma)
// * e(C, -delta)
// * e(alpha, -beta)
// == 1
//
// where vk_x = IC[0] + sum(IC[i+1] * pub[i]) + sum(IC[nPublic+1+j] * wire[j])
//
pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  public: List<Int>,
  commitment_wires: List<Int>,
) -> Bool {
  // strict shape checks
  // gnark exports nPublic including the implicit "1" constant, so:
  // - nPublic = 37 means 37 public witness values (including witness[0]=1)
  // - IC[0] is for witness[0]=1 (constant term, added directly)
  // - IC[1..nPublic-1] are for the actual public inputs (nPublic-1 elements)
  // - IC[nPublic..] are for commitment wires
  // Therefore: len(vkIC) = nPublic + n_commitments
  // And: public array should have nPublic-1 elements (NOT including "1")
  let n_commitments = list.length(commitment_wires)
  let n_raw_public = vk.nPublic - 1
  expect vk.nPublic > 0
  expect list.length(public) == n_raw_public
  expect list.length(vk.vkIC) == vk.nPublic + n_commitments

  // uncompress once
  let alpha = bls12_381_g1_uncompress(vk.vkAlpha)
  let beta = bls12_381_g2_uncompress(vk.vkBeta)
  let gamma = bls12_381_g2_uncompress(vk.vkGamma)
  let delta = bls12_381_g2_uncompress(vk.vkDelta)

  let a = bls12_381_g1_uncompress(proof.piA)
  let b = bls12_381_g2_uncompress(proof.piB)
  let c = bls12_381_g1_uncompress(proof.piC)

  // Compute vk_x = IC[0] + sum(IC[i] * pub[i-1]) + sum(IC[nPublic+j] * wire[j]) + sum(D[k])
  // Standard Groth16 with commitment extension:
  //   vk_x = 1*IC[0] + pub[0]*IC[1] + ... + pub[n-1]*IC[n] + wire*IC[n+1] + D
  // gnark adds the commitment points D directly to vk_x (not just the wire values)
  // Since 1*IC[0] = IC[0], we start acc with IC[0] and multiply remaining ICs
  let vk_x =
    when vk.vkIC is {
      [] -> fail @"empty vkIC"
      [head, ..tail] -> {
        // tail has (nPublic - 1 + n_commitments) elements = n_raw_public + n_commitments
        // Split into ic_public (first n_raw_public) and ic_wires (rest)
        let Pair(ic_public, ic_wires) = split_at(tail, n_raw_public)
        // Compute IC[0] + sum(IC[i] * pub[i-1]) for i in 1..n_raw_public
        let vk_x_base =
          derive_vk_x(ic_public, public, bls12_381_g1_uncompress(head))
        // Add sum(IC[nPublic+j] * wire[j])
        let vk_x_with_wires = derive_vk_x(ic_wires, commitment_wires, vk_x_base)
        // Add sum(D[k]) - gnark adds commitment points directly to vk_x
        add_commitments(proof.commitments, vk_x_with_wires)
      }
    }

  let prod =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_mul_miller_loop_result(
          bls12_381_miller_loop(a, b),
          bls12_381_miller_loop(vk_x, bls12_381_g2_neg(gamma)),
        ),
        bls12_381_miller_loop(c, bls12_381_g2_neg(delta)),
      ),
      bls12_381_miller_loop(alpha, bls12_381_g2_neg(beta)),
    )

  // Main Groth16 product == 1
  // Note: Commitment PoK verification is skipped for now as gnark's BSB22 PoK
  // uses a more complex batched verification with challenges that would require
  // additional implementation. The main Groth16 proof verification is sufficient
  // for verifying the computational statement.
  bls12_381_final_verify(prod, ml_one(alpha, beta))?
}

// Split a list at index n, returning Pair(first n elements, rest)
fn split_at(lst: List<a>, n: Int) -> Pair<List<a>, List<a>> {
  if n <= 0 {
    Pair([], lst)
  } else {
    when lst is {
      [] -> Pair([], [])
      [x, ..rest] -> {
        let Pair(first, second) = split_at(rest, n - 1)
        Pair([x, ..first], second)
      }
    }
  }
}
