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

// ---------- Constants ----------
pub const global_snark_vk: SnarkVerificationKey =
  SnarkVerificationKey {
    nPublic: 37,
    vkAlpha: #"8090277f0799825fe8f38d6f184daf36736c6cb4303fadbc87fb06f0e7fab461cd7b8ff013b306e81a9262a8b95a4532",
    vkBeta: #"ad19afaed44bb018d32d26134cb7dd54a3e0981fc7a63e7b73f217bde5f249c3abbf356765800adba8732c3ab815704f0bf3dad720c75505bb4aff8a4ca27778ef5aa9317e8b8c5a29f2e0c14eb99a3f8b9a292548b605bbfe6b3636873b13a1",
    vkGamma: #"829f91a476f004c06dcfc6af740e1d6676be15662c87e368552a363504dc43d715c787122f164fae1bf4ac14280796ef031fad18de3c8d934282016a1dd1ba7d476ee33a67aa194a5140dac80aee14ae2ef39b33f3259ea13620baca19f71088",
    vkDelta: #"b3065359df4da47465b272745905537c76939190cd81d16e7cb457f54ddb70e4e7eaab3478c6fedccd277ea4007c7ee207425ae618161f9ba9c6f2492addd3b4e2dd1f40419d3d1d5b3904c9e4e718ad9aa644c30281268a790640e97377ec10",
    vkIC: [
      #"af0b33b15bb9bb7aaa3eb688794bb2b7f011205b385deb8377510e422d709a32bc27255341abd6746934ada898f6a0f9",
      #"aea388ab0da4aa765be75123b6523777cd06e9c1996e0e27b39bb2a49e39eb12979dfb41da9b1d495c8e5e87c0deec49",
      #"8ac518584be522b4b93668ed68ad14044557e63f8b5a308414e6b08fcf1b2c331e360c397b44b519b500001ee4d66d4f",
      #"8ea8d55bcc7140bcf6812264b130812c3c8a3ce476fc94b5f98bf38743343df67e0a2aa4510da102ffbff60d7fd6624f",
      #"a208a567d439a9a04f1f445dab2ab03aed2948ea177c9de0b5b1d54280dc2d216de10b7a298311722c2fa339aed22c94",
      #"86e9ce00660c2c31dfadb32726a4328d53bb4d6b203985cffd2cb747e4bb35fa3724e7371de757d8db52b6afe477c61b",
      #"aa631e1b301ebd310a63a423ff07a983d62f17c33da612f2865a951537147ce21da73a65b8d8837957bad801b19b173a",
      #"b615d7a13f030ddc0e1855ca16c212b3e39f37533d31d7fbec3a64ed24e04678e27c1c35a3a9c5b26d8ddcae414f9cc5",
      #"b512643d6f6d9e0d06fe99f0459e68545a18d9cbd30b2d42c5802b67957822ae5c73bf186808475dda81eda4d8e9f405",
      #"af0d1c40491afaf397386c2a362371dd86a8ce20c91bda102713556da337d5a30b571f201c0d46420969a645a67b5d9d",
      #"b688577e926cb94919f0982f8c0b5f0fea16e42b66561bbb1019388b8413a274625c16353ec068660e5ed5829dcb3094",
      #"a57e96387c97a89c03e7ca3c2a223c1d32da294c168bca7971760e7ba8b7c4cb0e87dfd16e83dcc08fa21f0a405702de",
      #"8be5433370565b3f1a42bc11b5206d7fb0034ce94b08f05b8f12bf18ed7ea8bf0b30a8b3f102277d4ca12d66ee0c3556",
      #"8e6c18a25b98376abaa95e1465f64fab1d5fb357d294957b8bcf33d34d5f40f9678ff854b6dfd7ee6a6a47cc36c36724",
      #"b23d9310e1dd4939ae8662c2f6da0ff652ce7ad268742576d37bb31a1f83b97a5fad5609a92e5632553af842e45f60c1",
      #"a8386f5f46f649b8cd0f91b6a63fed9490493a2fff70fca1b4d3493ecf848e4bad63f9a8fb5294c9a92cad7e40d1ae09",
      #"a1d26f0fadad346c721bed9fcb777f6f6115a56ec85eb0ad8d2640596fd6828af818f18a45e814a99fb8cec4536499e4",
      #"88a1c7d612a90b478e57d0e346527506790194461b6fb4db6deb5c89c6efdb687c4dada4ad983327404f44ff3bfd21af",
      #"b14acf66c47f474c242f4dfd21fa86b7f0f0b565fa927a161671f584130f2eda7726d875624fae8d2cf01fff0d38b72c",
      #"8f89b6b971919125f235e0a02ebb14c1c4b2c8514a51ca19781308571283e809a979f0c9efcc9e663a710466040240ac",
      #"b9048448d30169a336f42f9e87d59aedf11d9186d34a6aa066f21fe49f9efd9057dc72fb68d597e3ad7cd6c5431e7f3d",
      #"b3a20985c2e65dc9250db11d49e6b4fcbda64b1036e37c44dae228edb75f3d85c23be0d482e77f465de034d69c4a9a09",
      #"ab8417522131f3435481d233ced1d242010cd58e49c44b942704b9915d98c1028eeb28de3f4199cb7615231c073a9261",
      #"96312a23a285e871bf5dba5ea8778d3fbdd134f061b7514bbbb458072877784fcdede4ce11295260966155e123873e2f",
      #"a9fa2b5a45b811959a9ca2d867714d533e1bd6a6152e6653a8c716c5f32dabcf511e3235dda7e8e72d46965c618b75ac",
      #"88ed7718e4078f7bc194f5582325a98047914904f6b766239b4f72bd57b29472b106b42b9a34e65824c78c2909509a4b",
      #"86acaf96ddb8da9c548d8ca961cc6dfff674c7f213ff1d966014b4c0e4d47a8a3ce2ad3e727302cebeb9d2b22dea2fad",
      #"93ee3efe12bd37f0815237ea131e592ac2835d0ddc432863503428415a2247d9a067410b493436ff42a08ba0eec6efca",
      #"807aff14e8c91e9f25ea927b8a85d7a309f3b19146a7b3735f4f7852fabab80a39998a41ac2a7f0833512a9720e4df72",
      #"9244ff4f13fe551be8d292fbce228376ef432e0d26a1c35a27680950f8ede951011bfa1b09590b8c782372eaffe5d892",
      #"948a934aa4f5ac17a3addac6f7bb894bff77ebc7c425c87c3eeeca82785af785f8954e0df36e62eb440056fb7990b42d",
      #"89625dfd73b1e3e38e7122d5cfde472317ee499be1053a24d6982a2f5f1a641bb5d243ac3e4ad5d68a6202c9b2113a47",
      #"a020f3e3024756aa478735d977dd24d89e0e415a6257eb0bdb90c8b82360c62cb62eeb5f6a83c6cdb470b86364c807b9",
      #"8485e70f6e1ca850e452041da0364817036792a28b4871323c6e1210270181fb13487bba0bc96ca8561383cccbc0df57",
      #"934b2f0bf6820219969bfe18e6e51f1de9c35e9669cc7f879b94ddf4ecee4ac1003e1bc29443e12d4f93c88249417cb4",
      #"83603915672d2814c8844257b754125a62de4a8b065a3032928c26762e11bbb86738212bd7299ad7ec34131703dddc44",
      #"83b45901622116b3ebb0cd52e016760ab371b33577bc44303c99f2d7996100455f5ff32dfcbbc8761447952c56657159",
      #"88aa5282c830add1849a901f883dd1f1707df1a98ab3151c811f9fe5b18b45ef61133e05ff917a8faf7919ada234696a",
    ],
    commitmentKeys: [
      CommitmentKey {
        g: #"a1442831bc1a1b2717976d84b5b285cb817898871b50fd8cbb32c8d3bae6cd73bdc521b4c3f8f67c6888e985cd0fa8fd07da7e63a2fe6e5a6ebdf7af9b1a41ee84c9be53c6e351bd1dc40d7fb8c865eaa61d20eb4e7d91a78518eac75ad0cebd",
        gSigmaNeg: #"a1b3e5cba77bba832026984adb01bcf0514208325895b659eb6dfe2962e1ae3f3dec387edba635781aa4d74ffa1482f014a110fcb1a4242358eb6ede5b3d8e146e374df7fee8bcd66b59fb70c8804fa8329af2854bf2383ee6eec16bb7b4aa71",
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

