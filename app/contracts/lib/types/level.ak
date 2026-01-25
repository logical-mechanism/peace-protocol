//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Cardano implementation of
////
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
use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/g2
use aiken/crypto/bls12_381/pairing.{final_exponentiation, miller_loop}
use aiken/crypto/bls12_381/scalar.{Scalar}
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use digest
use types/register.{Register}
use types/schnorr.{BindingProof, binding_verify}

/// base seed is the block 0 hash of mainnet
pub const base_seed: ByteArray =
  #"89d9b5a5b8ddc8d7e5a6795e9774d97faf1efea59b2caf7eaf9f8c5b32059df4"

/// WANG:h0 -> in the paper this term is the g1 point
pub const wang_h0: G2Element = g2.hash_to_group(base_seed, #"57414e473a6830")

/// WANG:h1
pub const wang_h1: G2Element = g2.hash_to_group(base_seed, #"57414e473a6831")

/// WANG:h2
pub const wang_h2: G2Element = g2.hash_to_group(base_seed, #"57414e473a6832")

/// WANG:h3
pub const wang_h3: G2Element = g2.hash_to_group(base_seed, #"57414e473a6833")

/// split the level list into a half and full level
pub type HalfEncryptionLevel {
  // #<Bls12_381, G1>
  r1b: ByteArray,
  // #<Bls12_381, G1>
  r2_g1b: ByteArray,
  // #<Bls12_381, G2>  in the paper this is c13 for level-1 and R4 for level-k
  r4b: ByteArray,
}

/// Verify the first half encryption level. The token name on the encryption UTxO
/// is used with the encryption level to bind the everything together.
///
/// ```aiken
/// level.verify_first_half_level(entry, tkn)
/// ```
pub fn verify_first_half_level(
  self: HalfEncryptionLevel,
  token_name: AssetName,
) -> Bool {
  // e(g, R4) == e(R1, h1^{H(R1)} h2^{H(R1||R2||token)} h3)
  let r4: G2Element = self.r4b |> g2.decompress
  let left = miller_loop(g1.generator, r4)
  let a = self.r1b |> hash_to_scalar
  let b =
    self.r1b
      |> bytearray.concat(self.r2_g1b)
      |> bytearray.concat(token_name)
      |> hash_to_scalar
  // level one uses h1, h2, and h3 terms
  let exp =
    g2.add(g2.scale(wang_h1, a), g2.scale(wang_h2, b)) |> g2.add(wang_h3)
  let right = miller_loop(self.r1b |> g1.decompress, exp)
  final_exponentiation(left, right)
}

/// Verify the kth encryption level. The token name on the encryption UTxO
/// is used with the encryption level to bind the everything together.
///
/// ```aiken
/// level.verify_kth_half_level(entry, tkn)
/// ```
pub fn verify_kth_half_level(
  self: HalfEncryptionLevel,
  token_name: AssetName,
) -> Bool {
  // e(g, R4) == e(R1, h1^{H(R1)} h2^{H(R1||R2||token)})
  let left = miller_loop(g1.generator, self.r4b |> g2.decompress)

  let a4 = self.r1b |> hash_to_scalar
  let b4 =
    self.r1b
      |> bytearray.concat(self.r2_g1b)
      |> bytearray.concat(token_name)
      |> hash_to_scalar
  // level k only uses the h1 and h2 terms
  let exp = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
  let right = miller_loop(self.r1b |> g1.decompress, exp)

  final_exponentiation(left, right)
}

/// Internal use only; good for testing.
pub fn mk_kth_half_level(
  token_name: AssetName,
  r: State<Scalar>,
  r2_g1b: ByteArray,
) -> HalfEncryptionLevel {
  let r1b = g1.generator |> g1.scale(r) |> g1.compress

  // R4 uses hashes of (R1) and (R1 || R2 || R3)
  let a4 = r1b |> hash_to_scalar
  let b4 =
    r1b
      |> bytearray.concat(r2_g1b)
      |> bytearray.concat(token_name)
      |> hash_to_scalar

  let base = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
  let r4b = base |> g2.scale(r) |> g2.compress
  HalfEncryptionLevel { r1b, r2_g1b, r4b }
}

/// Verifies that the new level addition is valid.
///
/// ```aiken
/// level.add_new_level(this.levels, that.levels, redeemer.r4, tkn, datum.register, redeemer.binding_proof)
/// ```
pub fn add_new_half_level(
  new_half: HalfEncryptionLevel,
  old_half: HalfEncryptionLevel,
  new_full: FullEncryptionLevel,
  r5: ByteArray,
  token_name: AssetName,
  user: Register,
  proof: BindingProof,
) -> Bool {
  let expected =
    FullEncryptionLevel {
      r1b: old_half.r1b,
      r2_g1b: old_half.r2_g1b,
      r2_g2b: r5,
      r4b: old_half.r4b,
    }

  and {
    binding_verify(user, proof, new_half.r1b, new_half.r2_g1b, token_name),
    verify_kth_half_level(new_half, token_name),
    new_full == expected,
  }
}

pub type FullEncryptionLevel {
  // #<Bls12_381, G1>
  r1b: ByteArray,
  // #<Bls12_381, G1>
  r2_g1b: ByteArray,
  // #<Bls12_381, G2>
  r2_g2b: ByteArray,
  // #<Bls12_381, G2>  in the paper this is c13 for level-1 and R4 for level-k
  r4b: ByteArray,
}

// pub type EmbeddedGt {
//   // #<Bls12_381, G1>
//   g1b: ByteArray,
//   // #<Bls12_381, G2>
//   g2b: Option<ByteArray>,
// }

// pub type EncryptionLevel {
//   // #<Bls12_381, G1>
//   r1b: ByteArray,
//   // #<Bls12_381, GT>
//   r2: EmbeddedGt,
//   // #<Bls12_381, G2>  in the paper this is c13 for level-1 and R4 for level-k
//   r4b: ByteArray,
// }

/// e(q^a + x*r, h0) or e(q^a + x*r, h0) * e(q^r, p^h - s*x)
/// store just q^a + x*r or q^a + x*r and p^h - s*x
/// h0 is a constant and q^r is r1b so they can be referenced
pub const hash_to_scalar_domain_tag: ByteArray =
  #"484153487c546f7c496e747c76317c"

/// Hash some bytearray into a scalar using the protocol hash function.
///
/// ```aiken
/// level.hash_to_scalar(msg)
/// ```
pub fn hash_to_scalar(msg: ByteArray) -> State<Scalar> {
  hash_to_scalar_domain_tag
    |> bytearray.concat(msg)
    |> digest.hash
    |> scalar.from_bytes
}

// pub fn concat_embedded_gt(gt: EmbeddedGt) -> ByteArray {
//   when gt.g2b is {
//     None -> gt.g1b
//     Some(g2b) -> gt.g1b |> bytearray.concat(g2b)
//   }
// }

// pub fn mk_level_k(
//   token_name: AssetName,
//   r: State<Scalar>,
//   r2: EmbeddedGt,
// ) -> EncryptionLevel {
//   let r1b = g1.generator |> g1.scale(r) |> g1.compress

//   // R4 uses hashes of (R1) and (R1 || R2 || R3)
//   let a4 = r1b |> hash_to_scalar
//   let b4 =
//     r1b
//       |> bytearray.concat(concat_embedded_gt(r2))
//       |> bytearray.concat(token_name)
//       |> hash_to_scalar

//   let base = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
//   let r4b = base |> g2.scale(r) |> g2.compress

//   EncryptionLevel { r1b, r2, r4b }
// }

// pub fn verify_level_one(self: EncryptionLevel, token_name: AssetName) -> Bool {
//   expect None = self.r2.g2b
//   // e(g, R4) == e(R1, h1^{H(R1)} h2^{H(R1||R2||token)} h3)
//   let r4 = self.r4b |> g2.decompress
//   let left = miller_loop(g1.generator, r4)
//   let a = self.r1b |> hash_to_scalar
//   let b =
//     self.r1b
//       |> bytearray.concat(concat_embedded_gt(self.r2))
//       |> bytearray.concat(token_name)
//       |> hash_to_scalar
//   // level one uses h1, h2, and h3 terms
//   let exp =
//     g2.add(g2.scale(wang_h1, a), g2.scale(wang_h2, b)) |> g2.add(wang_h3)
//   let right = miller_loop(self.r1b |> g1.decompress, exp)
//   final_exponentiation(left, right)
// }

// pub fn verify_level_k(self: EncryptionLevel, token_name: AssetName) -> Bool {
//   expect None = self.r2.g2b
//   // e(g, R4) == e(R1, h1^{H(R1)} h2^{H(R1||R2||token)})
//   let left = miller_loop(g1.generator, self.r4b |> g2.decompress)

//   let a4 = self.r1b |> hash_to_scalar
//   let b4 =
//     self.r1b
//       |> bytearray.concat(concat_embedded_gt(self.r2))
//       |> bytearray.concat(token_name)
//       |> hash_to_scalar
//   // level k only uses the h1 and h2 terms
//   let exp = g2.add(g2.scale(wang_h1, a4), g2.scale(wang_h2, b4))
//   let right = miller_loop(self.r1b |> g1.decompress, exp)

//   final_exponentiation(left, right)
// }

// pub fn add_new_level(
//   self: List<EncryptionLevel>,
//   next: List<EncryptionLevel>,
//   r5: ByteArray,
//   token_name: AssetName,
//   user: Register,
//   proof: BindingProof,
// ) -> Bool {
//   expect [entry, expected2, ..tail2] = next
//   expect [head, ..tail] = self

//   expect None = head.r2.g2b
//   let expected =
//     EncryptionLevel {
//       ..head,
//       r2: EmbeddedGt { g1b: head.r2.g1b, g2b: Some(r5) },
//     }

//   and {
//     binding_verify(user, proof, entry.r1b, entry.r2.g1b, token_name),
//     verify_level_k(entry, token_name),
//     expected2 == expected,
//     tail2 == tail,
//   }
// }

/// We can not serialize the gt element on chain so we will represent it as the
/// concatentation of the g1 and g2 elements.
///
/// ```aiken
/// level.concat_embedded_gt(datum.r2)
/// ```
/// Internal use only; good for testing.
/// Verify the first encryption level. The token name on the encryption UTxO
/// is used with the encryption level to bind the everything together.
///
/// ```aiken
/// level.verify_level_one(entry, tkn)
/// ```
/// Verify the kth encryption level. The token name on the encryption UTxO
/// is used with the encryption level to bind the everything together.
///
/// ```aiken
/// level.verify_level_k(entry, tkn)
/// ```
/// Verifies that the new level addition is valid.
///
/// ```aiken
/// level.add_new_level(this.levels, that.levels, redeemer.r4, tkn, datum.register, redeemer.binding_proof)
/// ```
/// This can be some proof that shows r5 is authentic.
///
/// Right now it only proves:
/// e(q, R5) * e(u, g1) = e(q^H(k), p)
///
/// We need to combine this with a snark.
///
/// ```aiken
/// level.verify_r5(datum.register, redeemer.r5, redeemer.witness)
/// ```
pub fn verify_r5(user: Register, r5: ByteArray, witness: ByteArray) -> Bool {
  let l1 = miller_loop(user.generator |> g1.decompress, r5 |> g2.decompress)
  let l2 = miller_loop(user.public_value |> g1.decompress, wang_h0)
  let left = builtin.bls12_381_mul_miller_loop_result(l1, l2)
  let right = miller_loop(witness |> g1.decompress, g2.generator)
  final_exponentiation(left, right)
}
