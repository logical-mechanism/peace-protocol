//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/scalar.{Scalar}
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use digest
use types/register.{Register}

pub const schnorr_domain_tag: ByteArray = #"5343484e4f52527c50524f4f467c76317c"

pub const binding_domain_tag: ByteArray = #"42494e44494e477c50524f4f467c76317c"

pub type SchnorrProof {
  // this is z = r + c * x as a bytearray
  z_b: ByteArray,
  // this is the g^r compressed G1Element
  g_r_b: ByteArray,
}

/// Concat all of the terms together then hash the value. This is used to
/// generate a challenge value for the proof.
///
/// ```aiken
/// schnorr.fiat_shamir_heuristic(g, gr, u)
/// ```
pub fn fiat_shamir_heuristic(
  // compressed g element
  g_b: ByteArray,
  // compressed g^r element
  g_r_b: ByteArray,
  // compressed g^x element
  u_b: ByteArray,
) -> ByteArray {
  // concat g_b, g_r_b, u_b, and b together then hash the result
  schnorr_domain_tag
    |> bytearray.concat(g_b)
    |> bytearray.concat(g_r_b)
    |> bytearray.concat(u_b)
    |> digest.hash
}

/// Verify a Schnorr Sigma Protocol using the Fiat-Shamir heuristic for
/// non-interactivity.
///
/// ```aiken
/// schnorr.verify(datum.register, redeemer.proof)
/// ```
pub fn verify(user: Register, proof: SchnorrProof) -> Bool {
  //
  let z: State<Scalar> = scalar.from_bytes(proof.z_b)
  let g_z: G1Element = user.generator |> g1.decompress |> g1.scale(z)
  //
  // use the fiat-shamir heuristic to calculate the challenge then convert it to an scalar
  let c: State<Scalar> =
    fiat_shamir_heuristic(user.generator, proof.g_r_b, user.public_value)
      |> scalar.from_bytes
  //
  // the u^c computation: u^c = (g^x)^c = g^(x * c)
  let u_c: G1Element = user.public_value |> g1.decompress |> g1.scale(c)
  //
  // check if equation: g^z = g^r * u^c is true
  //
  g_z |> g1.equal(g1.add(g1.decompress(proof.g_r_b), u_c))
}

pub type BindingProof {
  // integer
  z_a_b: ByteArray,
  // integer
  z_r_b: ByteArray,
  // #<Bls12_381, G1>
  t_1_b: ByteArray,
  // #<Bls12_381, G1>
  t_2_b: ByteArray,
}

/// Concat all of the terms together then hash the value. This is used to
/// generate a challenge value for the proof.
///
/// ```aiken
/// schnorr.binding_fiat_shamir_heuristic(datum.register, redeemer.proof, entry.r1b, entry.r2, tkn)
/// ```
pub fn binding_fiat_shamir_heuristic(
  user: Register,
  proof: BindingProof,
  r1_b: ByteArray,
  r2_b: ByteArray,
  token_name: ByteArray,
) -> ByteArray {
  binding_domain_tag
    |> bytearray.concat(user.generator)
    |> bytearray.concat(user.public_value)
    |> bytearray.concat(proof.t_1_b)
    |> bytearray.concat(proof.t_2_b)
    |> bytearray.concat(r1_b)
    |> bytearray.concat(r2_b)
    |> bytearray.concat(token_name)
    |> digest.hash
}

/// Verify a Sigma Protocol using the binding Fiat-Shamir heuristic for
/// non-interactivity.
///
/// ```aiken
/// schnorr.binding_verify(datum.register, redeemer.proof)
/// ```
pub fn binding_verify(
  user: Register,
  proof: BindingProof,
  // #<Bls12_381, G1>
  r1_b: ByteArray,
  // #<Bls12_381, G1>
  r2_b: ByteArray,
  // unique token
  token_name: AssetName,
) -> Bool {
  // get the ints
  let z_a: State<Scalar> = scalar.from_bytes(proof.z_a_b)
  let z_r: State<Scalar> = scalar.from_bytes(proof.z_r_b)
  // compute the z terms
  let q_z_a: G1Element = user.generator |> g1.decompress |> g1.scale(z_a)
  let q_z_r: G1Element = user.generator |> g1.decompress |> g1.scale(z_r)
  let u_z_r: G1Element = user.public_value |> g1.decompress |> g1.scale(z_r)
  // compute the t terms
  let t1: G1Element = g1.decompress(proof.t_1_b)
  let t2: G1Element = g1.decompress(proof.t_2_b)
  // compute the r terms
  let r1: G1Element = g1.decompress(r1_b)
  let r2: G1Element = g1.decompress(r2_b)
  // compute the challenge terms
  let c: State<Scalar> =
    binding_fiat_shamir_heuristic(user, proof, r1_b, r2_b, token_name)
      |> scalar.from_bytes
  let r1_c: G1Element = r1 |> g1.scale(c)
  let r2_c: G1Element = r2 |> g1.scale(c)
  // compute the sigma protocol
  and {
    g1.equal(g1.add(q_z_a, u_z_r), g1.add(t2, r2_c)),
    g1.equal(q_z_r, g1.add(t1, r1_c)),
  }
}
