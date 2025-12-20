//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Cardano implementation of
//// A Fully Secure Unidirectional and Multi-use Proxy Re-encryption Scheme by Wang & Cao
////
//// NOTE (storage minimization / GT embedding)
//// ----------------------------------------
//// We can’t store or do full arithmetic on GT elements on-chain, and storing extra
//// group elements is expensive. So `EmbeddedGt` stores only the *minimal* factors
//// needed to *reconstruct* the GT value during validation, while everything else
//// is treated as an implied constant or a value that can be referenced elsewhere
//// (e.g. contract constants like `wang_h0`, or fields already present on the level
//// such as `r1b`).
////
//// Concretely:
//// - Any fixed “parameter” points (h0/h1/h2/h3, generators, etc.) are NOT stored.
//// - Any factor already available from the surrounding datum/context (like `r1b`)
////   is NOT duplicated inside `EmbeddedGt`.
//// - `EmbeddedGt` therefore represents “GT-by-construction”: the validator
////   interprets it as a pairing product built from (a) minimal stored factors and
////   (b) implied constants / referenced values.
////
//// Off-chain, a user can still decrypt by fetching whatever additional public
//// data is needed from the UTxO/contract state; we optimize the on-chain datum
//// purely for validation cost and size.
////

use aiken/builtin
use aiken/crypto
use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/g2
use aiken/crypto/bls12_381/pairing.{final_exponentiation, miller_loop}
use aiken/crypto/bls12_381/scalar.{Scalar}
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use types/register.{Register}
use types/schnorr.{BindingProof, binding_verify}

// base seed is the block 0 hash of mainnet
pub const base_seed: ByteArray =
  #"89d9b5a5b8ddc8d7e5a6795e9774d97faf1efea59b2caf7eaf9f8c5b32059df4"

// WANG:h0 -> in paper its the g1 point
pub const wang_h0: G2Element = g2.hash_to_group(base_seed, #"57414e473a6830")

// WANG:h1
pub const wang_h1: G2Element = g2.hash_to_group(base_seed, #"57414e473a6831")

// WANG:h2
pub const wang_h2: G2Element = g2.hash_to_group(base_seed, #"57414e473a6832")

// WANG:h3
pub const wang_h3: G2Element = g2.hash_to_group(base_seed, #"57414e473a6833")

/// e(q^a + x*r, h0) or e(q^a + x*r, h0) * e(q^r, p^h - s*x)
/// store just q^a + x*r or q^a + x*r and p^h - s*x
/// h0 is a constant and q^r is r1b so they can be referenced
pub type EmbeddedGt {
  // #<Bls12_381, G1>
  g1b: ByteArray,
  // #<Bls12_381, G2>
  g2b: Option<ByteArray>,
}

pub type EncryptionLevel {
  // #<Bls12_381, G1>
  r1b: ByteArray,
  // #<Bls12_381, GT>
  r2: EmbeddedGt,
  // #<Bls12_381, G2>  (c13 for level-1, R4 for level-k)
  r4b: ByteArray,
}

pub fn hash_scalar(msg: ByteArray) -> State<Scalar> {
  // Use 256-bit hash so scalar.from_bytes has a full-width input.
  msg |> crypto.blake2b_224 |> scalar.from_bytes
}

pub fn concat_embedded_gt(gt: EmbeddedGt) -> ByteArray {
  when gt.g2b is {
    None -> gt.g1b
    Some(p) -> gt.g1b |> bytearray.concat(p)
  }
}

/// Good for testing
pub fn mk_level_k(
  token_name: AssetName,
  r: State<Scalar>,
  r2: EmbeddedGt,
) -> EncryptionLevel {
  let r1b = g1.generator |> g1.scale(r) |> g1.compress

  // R4 uses hashes of (R1) and (R1 || R2 || R3)
  let a4 = r1b |> hash_scalar
  let b4 =
    r1b
      |> bytearray.concat(concat_embedded_gt(r2))
      |> bytearray.concat(token_name)
      |> hash_scalar

  let base = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
  let r4b = base |> g2.scale(r) |> g2.compress

  EncryptionLevel { r1b, r2, r4b }
}

pub fn verify_level_one(token_name: AssetName, self: EncryptionLevel) -> Bool {
  expect None = self.r2.g2b
  let r4 = self.r4b |> g2.decompress
  let left = miller_loop(g1.generator, r4)
  let a = self.r1b |> hash_scalar
  let b =
    self.r1b
      |> bytearray.concat(concat_embedded_gt(self.r2))
      |> bytearray.concat(token_name)
      |> hash_scalar
  let exp =
    g2.add(g2.scale(wang_h1, a), g2.scale(wang_h2, b)) |> g2.add(wang_h3)
  let right = miller_loop(self.r1b |> g1.decompress, exp)
  final_exponentiation(left, right)
}

pub fn verify_level_k(token_name: AssetName, self: EncryptionLevel) -> Bool {
  expect None = self.r2.g2b
  // e(g, R4) == e(R1, h1^{H1(R1)} h2^{H1(R1||R2||R3)})
  let left = miller_loop(g1.generator, self.r4b |> g2.decompress)

  let a4 = self.r1b |> hash_scalar
  let b4 =
    self.r1b
      |> bytearray.concat(concat_embedded_gt(self.r2))
      |> bytearray.concat(token_name)
      |> hash_scalar

  let exp = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
  let right = miller_loop(self.r1b |> g1.decompress, exp)

  final_exponentiation(left, right)
}

pub fn add_new_level(
  self: List<EncryptionLevel>,
  next: List<EncryptionLevel>,
  r5: ByteArray,
  token_name: AssetName,
  user: Register,
  proof: BindingProof,
) -> Bool {
  expect [entry, expected2, ..tail2] = next
  expect [head, ..tail] = self

  expect None = head.r2.g2b
  let expected =
    EncryptionLevel {
      ..head,
      r2: EmbeddedGt { g1b: head.r2.g1b, g2b: Some(r5) },
    }

  and {
    binding_verify(user, proof, entry.r1b, entry.r2.g1b, token_name),
    verify_level_k(token_name, entry),
    expected2 == expected,
    tail2 == tail,
  }
}

/// This can be some proof that shows r5 is authentic
///
/// Right now it only proves:
/// e(q, R5) * e(u, g1) = e(q^H(k), p)
///
/// We need to combine this with a snark that proves:
/// hk = H(k) where k and hk are secrets
/// P = q^hk where P is public and q is the g1 generator
///
/// Then it would be a complete proof for the r5 term.
pub fn verify_r5(user: Register, r5: ByteArray, witness: ByteArray) -> Bool {
  let l1 = miller_loop(user.generator |> g1.decompress, r5 |> g2.decompress)
  let l2 = miller_loop(user.public_value |> g1.decompress, wang_h0)
  let left = builtin.bls12_381_mul_miller_loop_result(l1, l2)
  let right = miller_loop(witness |> g1.decompress, g2.generator)
  final_exponentiation(left, right)
}
