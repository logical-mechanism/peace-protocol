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
pub const global_snark_vk: SnarkVerificationKey =
  SnarkVerificationKey {
    nPublic: 37,
    vkAlpha: #"b3667cc4a87485b14913f18cbae8979214bed547140d5b5c9b80767a9d631bd40da76e3fcfcab4477858ce4ff46ac8a2",
    vkBeta: #"a21cef177a8523fa9fdb0091b24fbb15907c586f715d22004c4d755ddcb41fa27663ba27764069d3753894d6e46b139e07201c83db4666a7f74bd83f5a3bbc69b315b3b7c8f5005b0e6feb080ba295c3b4b2e63f40fba201ab55c8ffbe5e9bfd",
    vkGamma: #"b8cd208095084bdfecfc4e33777def62368dbc06b38267e695cd777b175125e14baead1d0edfb3f431fd2696717fc6b40e3e8f86f3114c1c74a02b620bc3b3ac43cbbd4d83ae4d56d9a5ae4dbcb3722dc59498226ad17594d2761cc9ce23210b",
    vkDelta: #"a1226f5f625d883e25dc73ba496baba0dda9bacdc3cd8635c09564e913ea93c8f12cf551da561db1a9c828937c96fde2116850801c47ba37a5b20b2336cc5171ee2a0087b82a00de6f37308806ad9d53a356c0bf2279935c09c5042b1b3a1717",
    vkIC: [
      #"b183011d325e9349645edfa9c47b8ca759157c40b647c992b17dc7573f0b3094baac2a9c0d9c88b9bb823bebf168a6a4",
      #"b2e5b4fadfdde93622140eed54af93b06514c274c44989f961ec8744061326687410b5daac3626cc099ebe243fff05a5",
      #"81d9a1ad60eeac43e4c63c49b6ba6d1ca2c235ad0605babbeb2536095106faa1ea3c909815d52d32a08d690944911679",
      #"8087e9b5e1ced39c8bbd36724c9bd7ea40bbfbe468cae0ebceb3c82e9f463cc89b7644715170f58429fc4a79bdc05d72",
      #"8534d451400efa90995d6d528db580958c1edae886996db593ed85c641e24ef2f793faf07ae92b68f3e555b612cb0856",
      #"a002b09fb543a42ceb1caeb71ccb5c78c694415ef43d38cba06fb184ac67544a40cdf028a82b7c993f96a8fb13f478fe",
      #"b3042cf6beda1b2c7b262b84408f8027c47128a9183234aee218741338cd72b745e6307e75d34afadf6e5fcd2800de6a",
      #"94d9a08489832c13386544630f46268e559d92fcc9084c21875a96377ccbc6ba6ddd02dd78a9cc5d1b7eeccf3b4219e0",
      #"84c507d05b13205e22025d7e474a82014e03ade977e0224de07b2a192f46a03615de5f95d758c24493f17008a006b745",
      #"900fc16a81612634a150dfb5c4f2a7f2bb16598a2dbc1e83b55ddd2157ffdb2c7b4ad761830ffcade6f633846da89d93",
      #"ad0d79bceb5d46ff8e8159cf5df96e70c1da8be09ff7ee954a831e2e76c16816e4afe468c300f3cfaa67d2bd40eb3754",
      #"98ac45034fa4745f93ed2cc8d8a328e6b9e5074416e8f0391db2fabebd1eb2a4f64e3e15b8b6199242e896afa0cdd00f",
      #"b7062b7bd305eb4604694ab1bf824e162aacbfbf6b4d4ce7d6d62cee3b93ab94ea11983690e4b4c6fe2289cb780c4fe0",
      #"b529309fe39fa5d751ad50426f4e7b1be2b7e0adf012834b3abdfe1abce4ada0a8f2a4350889acdfd9bd9b88bba81e8d",
      #"a6816a2efcf4a5dd1c7c3feab8c932d6ecf8638175f5f1722ab4c305a0420179c7454b201588afc8a8a8e17275be3dfd",
      #"b4c118535fc4a0e57e0d0745214f541d2ca5df50efd337a4b4210079484c38cd15f5efd7e3499ec732fa7d61af0001d2",
      #"80c79b2cfa51db99507335ac3c06989fec86ac954d5fe8c2ac168330aeb66f4e2ad386992b7dcaa9115cb4907e97b15f",
      #"abe445cd4aa2be4d07b71e039493cb974ff2a03c853737f83a5b6e00dda2b948bb628c435af82484edf79ae5d498076c",
      #"96adbd1a51189872bdb17289d0d52600b98409478e3b8785e91a2c22af8c236b6418e4db33c5845cf00df4d9df30ab4a",
      #"a7aac3aaa1dffd17c9df3ccd067b1e0e8b405d1e4f2a493217694612cef0a195cf0b7ddeac7a61f2c922e0da74d555d0",
      #"b4ed9a2ad34406051ca6bc5d304f9aed4239d4a6649e555f3ecb7cbf1ec0b36082edb70b337431455c1a30ddb66bca15",
      #"8a9868038ba82877527bb3fd6375bbec31b482954fe5fdc86bbe5954a37f029e30281bb2049d8ececebab415c9e2487a",
      #"98bb36bbb0f39fdad7591962f9353dce75570e31b43d0e2e73b6731561765af0dccda010c53d28ca79a5989403cc9df9",
      #"8785cc9d78fd0e73c74ec74b2f131f4e65e33dd97b05bc2fd18a2ca65a7aa758da7d2de02a94ebfb635c1d1d32e6882e",
      #"8364eeb81d5ce60fbd2a6abce4823b88e76c48957bedff0e642956ae34cbf2f5f67b5f026714df9dd8f12833c441035a",
      #"949eae38d5bee1e30a0076952863f45dc7b1166475d8e6078a4f5a64cda0918d2e226ab88d73abb4b42bafdb000e028a",
      #"abc929c4823aa79eb80efdcbbd105b351fe04a1e6b41e34992e833fdb56e8cbb91af438ae57536f81a44163d2e217d14",
      #"b94d148b7ef34a75bbaed9faecd4bb8b7dcfae313aacd20cfaef634adf299001ed03b152eb694abe237ceb5b365b0139",
      #"8d53bc3120aefbb89149d24c67a287ece83aad8322364ca2e1fb110e2afc41073de40feb8acd6461a5f5ab32877fca26",
      #"83c85b6aab99be8d38b78a72e3ebcdb1fde5e005caced794becf5118a38aaf92e4f2b338b420c1df3e11f40d1bd9848a",
      #"8ff0de0547c8d21746b26ede735aadb3d8b9b1530055b063af7609c9c7b0f41663f8e47839414311394f43e141b318bf",
      #"b79bb35b88d8e28b3f395c9274da2e434310168b3b93dc018c70a2b14d00e50099b1811d79db35e6d0a07c5d064584f4",
      #"814b413b5797c8f5b899afe807c213d44b2cfcd0171faba8d05ef6f74dcffac359bd2939f218874cc146f6027b8cbe19",
      #"91a7519925bf67e9eb7bf6e07c6033d2f1b2c5782af9afe7b0b8a688685634e0b602b737586146987ac6e0136425fc49",
      #"b198bd46ffc6991f9160bc8f637ab643089843d3686fe22f733706dd7025531f9f2644398171302e8eef5cf8ffa706e8",
      #"945185106cb9886e37d6ee27126f7910ea4ffd3ff35d1de947336d7493ffdabd959261b04a3e6a97934655bc3ad55e72",
      #"844357b31df240afe82343d2141ccec489b87efeb5fc0c9c5f975538bf4557f336c13254f810f0d4c1d9753774d08aec",
      #"962b8dc72c5f56b0c746ad58744395c277ac32b98b817ef1047d25a977917c1b17ff446d5f974af124991984e43d8e03",
    ],
    commitmentKeys: [
      CommitmentKey {
        g: #"8e589a7f946696a02832e4a860c3fcb25045206aef94a1b7c6cd033fc2a621425a1da3eb4314d1c304bdeac447a431c8072362dc75607e1663dbfc306af2a7ac1816e4ca52580386a789f381a2bb3038a16f1b1dcd66702955131321bdada89e",
        gSigmaNeg: #"a527b3f039318dd4571df87489f45e692c1cdca2d148a516a3267f71b8cfdcf1431e8b544573ed7ef4acbcc23bcdabed105c2d2af8b19dc8990de46fca9c48ee0048cceacd104df54a157cfb36e0ebbf5e911695026ca719ad9ab61209dc30e8",
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
  bls12_381_final_verify(prod, ml_one(alpha, beta))?
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

    bls12_381_final_verify(prod, identity)?
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
