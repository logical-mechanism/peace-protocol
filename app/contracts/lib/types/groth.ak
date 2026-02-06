//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Groth16 verifier (gnark variant with commitment extension)
//// - Main check: e(A,B) * e(vk_x,-gamma) * e(C,-delta) == e(alpha,beta)
//// - Commitment PoK check as "pairing product == 1"

use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_scalar_mul,
  bls12_381_g1_uncompress, bls12_381_g2_neg, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result,
}
use aiken/crypto.{ScriptHash}

pub type GrothWitnessRedeemer {
  groth_proof: GrothProof,
  groth_commitment_wire: GrothCommitmentWire,
  groth_public: GrothPublic,
  ttl: Int,
}

pub type RegisterRedeemer {
  Register(ScriptHash)
}

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
  // len = nPublic + nCommitments (G1 compressed)
  // IC[0] = constant term for witness[0]=1
  // IC[1..nPublic-1] = public inputs (nPublic-1 elements)
  // IC[nPublic..] = commitment wires (nCommitments elements)
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

pub type GrothPublic =
  List<Int>

pub type GrothCommitmentWire =
  ByteArray

// ---------- Helpers ----------

// Single-pass: processes first n IC elements with `public`, rest with `wires`
fn derive_vk_x_combined(
  ic_tail: List<ByteArray>,
  public: List<Int>,
  wires: List<Int>,
  n: Int,
  acc: G1Element,
) -> G1Element {
  when ic_tail is {
    [] -> acc
    [ic_i, ..rest_ic] -> {
      let pt = bls12_381_g1_uncompress(ic_i)
      if n > 0 {
        when public is {
          [] -> fail @"public shorter than vkIC"
          [s, ..rest_pub] ->
            derive_vk_x_combined(
              rest_ic,
              rest_pub,
              wires,
              n - 1,
              bls12_381_g1_add(acc, bls12_381_g1_scalar_mul(s, pt)),
            )
        }
      } else {
        when wires is {
          [] -> fail @"wires shorter than vkIC"
          [w, ..rest_w] ->
            derive_vk_x_combined(
              rest_ic,
              public,
              rest_w,
              0,
              bls12_381_g1_add(acc, bls12_381_g1_scalar_mul(w, pt)),
            )
        }
      }
    }
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

// ---------- Main verifier ----------
//
// gnark commitment extension uses the commitment wire (hash of D and committed publics)
// to multiply an additional IC element. The commitment D is only used in the PoK check.
//
// We do the main Groth16 check as:
//
//   e(A, B)
// * e(vk_x, -gamma)
// * e(C, -delta)
// == e(alpha, beta)
//
// where vk_x = IC[0] + sum(IC[i+1] * pub[i]) + sum(IC[nPublic+1+j] * wire[j])
//
pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  public: List<Int>,
  commitment_wires: List<Int>,
) -> Bool {
  let n_raw_public = vk.nPublic - 1

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
  expect [head, ..tail] = vk.vkIC
  let vk_x = {
    let base =
      derive_vk_x_combined(
        tail,
        public,
        commitment_wires,
        n_raw_public,
        bls12_381_g1_uncompress(head),
      )
    add_commitments(proof.commitments, base)
  }

  let lhs =
    bls12_381_mul_miller_loop_result(
      bls12_381_mul_miller_loop_result(
        bls12_381_miller_loop(a, b),
        bls12_381_miller_loop(vk_x, bls12_381_g2_neg(gamma)),
      ),
      bls12_381_miller_loop(c, bls12_381_g2_neg(delta)),
    )
  let rhs = bls12_381_miller_loop(alpha, beta)

  // Main Groth16 pairing check
  bls12_381_final_verify(lhs, rhs)
}

// ---------- Standalone Commitment Verification ----------
//
// Verifies the commitment proof of knowledge (PoK) separately from the main
// Groth16 verification. This can be used to verify commitments independently.
//
// gnark's Pedersen commitment PoK verification equation (from pedersen.go):
//   e(commitment, GSigmaNeg) * e(knowledgeProof, G) == 1
//
// For a single commitment D with PoK:
//   e(D, gSigmaNeg) * e(PoK, g) == 1
//
// where:
//   D = commitment point in G1
//   PoK = proof of knowledge in G1
//   g = commitment key generator in G2
//   gSigmaNeg = g^{-σ} (commitment key element in G2)
//
pub fn verify_commitments(vk: SnarkVerificationKey, proof: GrothProof) -> Bool {
  when proof.commitments is {
    [] -> True
    _ -> {
      expect [ck] = vk.commitmentKeys

      // Uncompress G2 elements from commitment key
      let g = bls12_381_g2_uncompress(ck.g)
      let g_sigma_neg = bls12_381_g2_uncompress(ck.gSigmaNeg)

      // Uncompress PoK from proof
      let pok = bls12_381_g1_uncompress(proof.commitmentPok)

      // Compute sum of commitments D_sum = D_0 + D_1 + ... + D_n
      let d_sum =
        when proof.commitments is {
          [] -> fail @"no commitments to sum"
          [d0, ..rest] -> sum_commitments_acc(rest, bls12_381_g1_uncompress(d0))
        }

      // Verify: e(D_sum, gSigmaNeg) * e(PoK, g) == 1
      // Note: Order matters! gnark's equation has gSigmaNeg paired with commitment
      let prod =
        bls12_381_mul_miller_loop_result(
          bls12_381_miller_loop(d_sum, g_sigma_neg),
          bls12_381_miller_loop(pok, g),
        )

      // Compare against identity: e(0*g1, g2) = 1 in GT
      let identity = bls12_381_miller_loop(bls12_381_g1_scalar_mul(0, d_sum), g)

      bls12_381_final_verify(prod, identity)
    }
  }
}

