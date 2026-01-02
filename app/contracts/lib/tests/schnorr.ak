//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/scalar.{Scalar}
use types/register.{Register}
use types/schnorr.{BindingProof, SchnorrProof}

test test_schnorr_fiat_shamir() {
  let g =
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
  let gr =
    #"8dd9e8affcd88844e190397d0746b4ed973504d2002c200790516f798b165f8632fa03901fdc4cc9368f46bae78eba04"
  let u =
    #"8d6af734d26f38f603cb3030ed71075d8f23e6c798ddc4897d08d7e2fce68fe37080cb671b3668dcac63dff778dc7dd8"
  let c = schnorr.fiat_shamir_heuristic(g, gr, u)
  c == #"ace9c7140e074ae54571dc5707ba6d16287d7ae883bd6062957f04bb"
}

test test_binding_fiat_shamir() {
  let x: State<Scalar> = scalar.from_int(44203)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  let alpha: State<Scalar> = scalar.from_int(3456)
  let rho: State<Scalar> = scalar.from_int(5678)
  let t1: ByteArray = g1.generator |> g1.scale(rho) |> g1.compress
  let t2: ByteArray =
    g1.add(
      g1.generator |> g1.scale(alpha),
      g1.generator |> g1.scale(scalar.mul(x, rho)),
    )
      |> g1.compress
  let half_proof = BindingProof { z_a_b: #"", z_r_b: #"", t_1_b: t1, t_2_b: t2 }
  let r1 =
    #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
  let r2 =
    #"8dd9e8affcd88844e190397d0746b4ed973504d2002c200790516f798b165f8632fa03901fdc4cc9368f46bae78eba04"
  let tkn = #"acab"
  let c = schnorr.binding_fiat_shamir_heuristic(user, half_proof, r1, r2, tkn)
  c == #"c8435846499a6e73e7b26ff0d7a5802ebc080e677f138e972a8701db"
}

// shows how it is constant time
test simple_schnorr_proof() {
  // some secret x 
  let x: State<Scalar> = scalar.from_int(44203)
  // the datum register using the g1 generator and the public value for x
  let datum: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  // a random number
  let r: State<Scalar> = scalar.from_int(1337)
  // calculate the g^r term
  let g: G1Element = g1.generator
  let g_r: G1Element = g1.scale(g, r)
  let g_r_b: ByteArray = g_r |> g1.compress
  // the challenge number using a fiat shamir transform
  let c: State<Scalar> =
    schnorr.fiat_shamir_heuristic(datum.generator, g_r_b, datum.public_value)
      |> scalar.from_bytes
  // the z value
  let z: State<Scalar> = scalar.mul(c, x) |> scalar.add(r)
  let z_b: ByteArray = scalar.to_bytes(z)
  let proof = SchnorrProof { z_b, g_r_b }
  schnorr.verify(datum, proof)
}

test simple_binding_proof() {
  let token_name = #"acab"
  // set up the user
  let x: State<Scalar> = scalar.from_int(44203)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }
  // set up the r terms
  let a: State<Scalar> = scalar.from_int(1337)
  let r: State<Scalar> = scalar.from_int(67)
  let r1_b: ByteArray = g1.generator |> g1.scale(r) |> g1.compress
  let r2_b: ByteArray =
    g1.generator |> g1.scale(scalar.add(a, scalar.mul(x, r))) |> g1.compress
  // set up the proof
  let alpha: State<Scalar> = scalar.from_int(3456)
  let rho: State<Scalar> = scalar.from_int(5678)
  let t1: ByteArray = g1.generator |> g1.scale(rho) |> g1.compress
  let t2: ByteArray =
    g1.add(
      g1.generator |> g1.scale(alpha),
      g1.generator |> g1.scale(scalar.mul(x, rho)),
    )
      |> g1.compress
  let half_proof = BindingProof { z_a_b: #"", z_r_b: #"", t_1_b: t1, t_2_b: t2 }
  let c: State<Scalar> =
    schnorr.binding_fiat_shamir_heuristic(
      user,
      half_proof,
      r1_b,
      r2_b,
      token_name,
    )
      |> scalar.from_bytes
  let z_a: ByteArray = scalar.mul(c, a) |> scalar.add(alpha) |> scalar.to_bytes
  let z_r: ByteArray = scalar.mul(c, r) |> scalar.add(rho) |> scalar.to_bytes
  let proof = BindingProof { z_a_b: z_a, z_r_b: z_r, t_1_b: t1, t_2_b: t2 }
  schnorr.binding_verify(user, proof, r1_b, r2_b, token_name)
}
