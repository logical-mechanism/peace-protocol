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

// ---------- Constants ----------
pub const global_snark_vk: SnarkVerificationKey =
  SnarkVerificationKey {
    nPublic: 37,
    vkAlpha: #"af51e41ccd01e60285d4471a5249368ac0bb6b0bd355153c7abbf12e71f355bef124b6c75398d4f3309e18b57bcd8cb3",
    vkBeta: #"8d48594a6f1db27b142dc23483df9c34d6a22a72d6c728306360be181d734ccc211eee07ffb172c99573c87d4d3c67090a4264bf4641520ae0cb598438dbb7b67e81cfc58f9fc797eb1660a0c30dc86a0bc76e37564386e322e25d5ea7702dff",
    vkGamma: #"9278a72a31ed1df7df95fbdb8d4eae8ae9d39b5d63068b3cd5739a677f743443edf49214042e9ebd1c75e70b675cecc0152ae5eaabf0d5ff09703e590ac14a65add91aa88138d936b0b9e657b9ace58dc6f7c7517af70503286e8ec3c562b888",
    vkDelta: #"b2df8a435d2dbe314611cbdee13a2bb78bb00b972e97cbea536207c9e1b03fe9325ae364bde913cdf0685c8f3316a45d17b6e8940fe95c5260dbde40dc5d341127e89cf47a93abc711781c340d2e44876eec9dfa8342b0d044b8c3e282549155",
    vkIC: [
      #"854a1c0ec5c5ff3cd004016d808d783aa302948887808ab085ae2999f61591265eedb533055ba0a911519477f893b73a",
      #"91d4acc132dd2d44e8b16883643e451d0fb006aae4f0efa46b1bea496d2a4215b2ac44ef9912797095ea407bea2a6ff0",
      #"a906cfd48a345552ca1a0d158937a2d5630aa590c6e0569cad5057a069973e304cb6e613dc05e993e20db155fc39808a",
      #"a3340e9f8357dd70ae33d4d344ee5c04b3594822f2ebfb7d1f25fcf6c531f299343f0508e58b31a0cf34fe677c19461b",
      #"826def5a042337fbacadfa5fa1492b9638d119108d68780f84637e76ddfb7ab873878e9b10bd9299ba2208d7ccb48d08",
      #"b493d27c7301a5c7218dbb8bda0c50014d4a3fb75008c7a6c00a625c6e5e2ae8faa641031117d90293aeed03f76f8f85",
      #"99f950fada66dd9e52bf82b8edfb16b8e16801235c8f4443837b3f981b4318e8486a5de94be7155c6aea1ec49edde76b",
      #"a4cce553751a12b51ab228f631abe3f48ad908b70e7036d6cb120c198209df35b65faabd30dd6e5514801e2ecf7a111d",
      #"9759c29b3f613cacecb5a3a86e08789c97e8f68c6ae311f770dba4f48d9f57e00c6a1ec166129b693de1a76c309e7f7e",
      #"b1e80f9bbab7de0c03391f1fcc0709b653a989fbde1a521e575ff1167d9b2f6545f107c47d70af85865e94b19efc11f7",
      #"a2fc94a067cb937b4e1c87411e760e4609d6855e8c82cfee440cb420deaf5e700cdd397b3d2275badce8962139220e54",
      #"8e719a48b4985ca4849e01fe9607ea7e2e3d1bd7dac480d8db917afb7f0830648262c6d222624a67021fc5b9be5df42e",
      #"919a73c3b9c00eae9f99ddb60fabbb6b303a9a6432b4cf8ddce9725e484a505ab926bafdbd3740191a5dafa9e28a2749",
      #"b995564573671ed38c6f2c9e026e1c5334a737a1c204983aef99963f4c94eaebcf545221e7aaf4abed894782d01b0bfb",
      #"89c3730b91b954f6a4eec0f4aae272560acee8632d585d5035aa2246a35e7e24d59433d5546d181cf6cef8b6df980a78",
      #"928808c0872103664d428d4d5b6c49abbf6260348014319b2786d6dc8590aec39a4678841b74303a2f2d3a980545aef4",
      #"90cd934474972c83f399fbfb44706b9d1d1d5a94a80fb0e5068f252888265ca8499cd1bc7231638da857b4d909ce590f",
      #"ae89dcd46a4e65185c6e557c8b870ee3bf83166728a9e30b7463703b89813709537d785d80294a643ff10166afb73217",
      #"8fc02fdec892f55dbbcea9f0b75bae4a33163f5ef80c2aa00ead95f2e2370b8b5d7944e4ed77da1af97208d598ab88aa",
      #"9439ff55212939c11a9d6b4c95fae33b838ccf030433625ecb837ddfd60db3b3a7a7c1356cb316513dd254041e970525",
      #"90541a71e910f7bc6a0f9946554920820592bc141a6187d2dd8b5fbd029beb5db4d801c7b59e10be43d2f33f8411d9a6",
      #"a1f0605ff4b174006aefb1fc9f1882a56df2e754745a0af3abb20215c6c9f1fe85239cdfa15e03bc955f796e98bad12c",
      #"8ab55e1684102622b4b53cd324ba90031f24d673b86c36ae4ccb9ac640cf2b16b3d11d3d121c909fb572b248cc90729f",
      #"92dc79058c1f1d8fee8d20b87a108eb970775a68e9dae484029fc9c8f8c113c405cc5925ce5fffdbd75dedc908226a58",
      #"ab757b808032ec879ea0752ca58cb6f1cd02de715e468df074e1e05752aa6214e71e26f556771032403997ae89ab3e75",
      #"908c0ce0b4adcf74597252bcf881a95265df0b0d47e6053a51fc888e33f3c00c9cc930afb1c935f44a8f6e502f8145cc",
      #"acc99326429a46231ad38e5e78b30779f47a71451be8d1096f226b529591ce2f32b73de8256106f6af568aa1d739d044",
      #"8d7250b5b2d2cc9bcbdbd14d5d0fe25a6ab8ae36e34362e88dbc4c081d803b73270d51163406b67fd478d16e707eaad9",
      #"87022a465cbda4e97bf3e41ab32f9ee872e6eb935492b10f7fee362cff9622349eaa7de9f6d62107521a804f280b76fd",
      #"b7f774009322fa8b1f7411bb346082d286cfff81a9ddde03c49ef1f0db91d5759d5bd9d03e9355dd44fbe1d812b25e02",
      #"b1d4547c42e81a3d45228e9fc295321ccac0bb960758aa5dce6f50805232a0b80979007f6d168426edb3e9e84b78b5df",
      #"a6e28431c3f8bd4b8b34b05cf1a6ab12d33b401c88a3b176109205d0c78a31bbc72b71d642a30752e584c47b70c186da",
      #"858097972804e3bbdd06a93a793c3cf5f6dc54bf4d4503d2c3aa7950d2f7f07849405f58b164c0d5f99f9857bf98e312",
      #"a0dfcd22e4e4303dcfcc10b780ac2aa7a68707792e0042ff2f80d0a04721a98d63bcfad698f3d2a4ab9e83aebe816cfb",
      #"9982d6a984c72e23ac86ebdaf193b62c43697aefb7faddb4eb1be49fab8a6f5c32b75e9841de2b24451cea21f793befb",
      #"b5ff97c573177ba23290c399c4ce3d70384b68f197e43c9bac46529911bdccf4ec2cabfbcbf147c41314b785a3643ec1",
      #"b0a618e0a0a0e1463b8bf6faa7e3290e61ada246ce6ac962bbe56a6512572d150e0317658e8a94c0496c6ff5614167fc",
      #"8cefc8cca3c97dc3adb13c0e65729d2d1895dc8dea7f44036f454c35e20d4475c618d88bf986d42b426d18a663635623",
    ],
    commitmentKeys: [
      CommitmentKey {
        g: #"aafe387c01ac0fc4f6aeef3c6e29885021dd0f6a516cc0d7e5abd2b11aa51a38031a2a028c42392a4ece4c5673333fca06bf11a9dfa019c94e3039bba3aae36465bf33f955cab3d36156393b8de7b09b12a2be42793d0964c50a0f5527e26577",
        gSigmaNeg: #"a8c19f63cdf7734d1f24f47272144ff185d603ee7e81462636afa67429a98602806c5c149ba4f4e6b3fcad6c4dd86171109b4d05c591e9833e4810b209e428a0ec89b619611c23f8c1852e212fdb779ec0940486c6c1e2c98baaba5bda4c0b3a",
      },
    ],
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
  bls12_381_final_verify(prod, ml_one(alpha, beta))
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
  // If no commitments, nothing to verify
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
