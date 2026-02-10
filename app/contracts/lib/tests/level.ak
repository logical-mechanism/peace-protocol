//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin
use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/g2
use aiken/crypto/bls12_381/scalar.{Scalar}
use aiken/primitive/bytearray
use types/level.{HalfEncryptionLevel}
use types/register.{Register}

// this would be the nft name on the utxo
const token_name: ByteArray = #"acab"

const alice_level: HalfEncryptionLevel = {
    let r = scalar.from_int(44203)

    let r1b =
      g1.generator
        |> g1.scale(r)
        |> g1.compress

    let r2_g1b: ByteArray =
      g1.generator
        |> g1.scale(scalar.from_int(69 + 1337 * 44203))
        |> g1.compress

    // a = H(r1b)
    let a =
      r1b
        |> level.hash_to_scalar

    // b = H(r1b || r2_bytes)
    let b =
      r1b
        |> bytearray.concat(r2_g1b)
        |> bytearray.concat(token_name)
        |> level.hash_to_scalar

    // exp = h1^a * h2^b * h3   (written additively in G2)
    let exp =
      g2.add(g2.scale(level.wang_h1, a), g2.scale(level.wang_h2, b))
        |> g2.add(level.wang_h3)

    // r4 = exp^r
    let r4b =
      exp
        |> g2.scale(r)
        |> g2.compress

    HalfEncryptionLevel { r1b, r2_g1b, r4b }
  }

pub const bob_level: HalfEncryptionLevel = {
    let r = scalar.from_int(123)

    let r2_g1b: ByteArray =
      g1.generator
        |> g1.scale(scalar.from_int(67 + 420 * 123))
        |> g1.compress
    level.mk_kth_half_level(token_name, r, r2_g1b)
  }

pub const carol_level: HalfEncryptionLevel = {
    let r = scalar.from_int(3)

    let r2_g1b: ByteArray =
      g1.generator
        |> g1.scale(scalar.from_int(1 + 2 * 3))
        |> g1.compress
    level.mk_kth_half_level(token_name, r, r2_g1b)
  }

test is_alice_verified() {
  level.verify_first_half_level(alice_level, token_name)
}

test is_bob_verified() {
  level.verify_kth_half_level(bob_level, token_name)
}

test is_bob_verified_incorrectly() fail {
  level.verify_first_half_level(bob_level, token_name)
}

test is_carol_verified() {
  level.verify_kth_half_level(carol_level, token_name)
}

test is_valid_r5_term() {
  let x: State<Scalar> = scalar.from_int(44203)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }

  let hk: State<Scalar> = level.hash_to_scalar(#"acab")
  let w0: G1Element = g1.generator |> g1.scale(hk)
  let r5: G2Element =
    g2.add(
      g2.generator |> g2.scale(hk),
      level.wang_h0 |> builtin.bls12_381_g2_neg |> g2.scale(x),
    )
  level.verify_r5(user, r5 |> g2.compress, w0 |> g1.compress)
}

test bob_cant_fake_r5() fail {
  let x: State<Scalar> = scalar.from_int(44203)
  let y: State<Scalar> = scalar.from_int(12345)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(y) |> g1.compress,
    }

  let hk: State<Scalar> = level.hash_to_scalar(#"acab")
  let w0: G1Element = g1.generator |> g1.scale(hk)
  let r5: G2Element =
    g2.add(
      g2.generator |> g2.scale(hk),
      level.wang_h0 |> builtin.bls12_381_g2_neg |> g2.scale(x),
    )
  level.verify_r5(user, r5 |> g2.compress, w0 |> g1.compress)
}

test display_wang_params() {
  trace level.wang_h0
  trace level.wang_h1
  trace level.wang_h2
  trace level.wang_h3
  True
}

// carol's kth level should fail first-level verification (same as bob)
test is_carol_verified_incorrectly() fail {
  level.verify_first_half_level(carol_level, token_name)
}

// alice's first-level should fail kth-level verification
test is_alice_verified_incorrectly_as_kth() fail {
  level.verify_kth_half_level(alice_level, token_name)
}

// a valid level with the wrong token name should fail
test alice_level_wrong_token() fail {
  level.verify_first_half_level(alice_level, #"beef")
}

// a valid kth level with the wrong token name should fail
test bob_level_wrong_token() fail {
  level.verify_kth_half_level(bob_level, #"beef")
}

// r5 with swapped witness and r5 should fail
test r5_fails_with_swapped_args() fail {
  let x: State<Scalar> = scalar.from_int(44203)
  let user: Register =
    Register {
      generator: g1.generator |> g1.compress,
      public_value: g1.generator |> g1.scale(x) |> g1.compress,
    }

  let hk: State<Scalar> = level.hash_to_scalar(#"acab")
  let w0: G1Element = g1.generator |> g1.scale(hk)
  let r5: G2Element =
    g2.add(
      g2.generator |> g2.scale(hk),
      level.wang_h0 |> builtin.bls12_381_g2_neg |> g2.scale(x),
    )
  // swap the arguments: pass r5 as witness and w0 as r5
  // r5 is G2 compressed (96 bytes), w0 is G1 compressed (48 bytes)
  // g2.decompress on a 48-byte value will fail
  level.verify_r5(user, w0 |> g1.compress, r5 |> g2.compress)
}
