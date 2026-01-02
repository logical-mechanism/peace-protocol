//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin
use aiken/crypto/bitwise.{State}
use aiken/crypto/bls12_381/g1
use aiken/crypto/bls12_381/g2
use aiken/crypto/bls12_381/scalar.{Scalar}
use aiken/primitive/bytearray
use types/level.{EmbeddedGt, EncryptionLevel}
use types/register.{Register}

// this would be the nft name on the utxo
const token_name: ByteArray = #"acab"

const alice_level: EncryptionLevel = {
    let r = scalar.from_int(44203)

    let r1b =
      g1.generator
        |> g1.scale(r)
        |> g1.compress

    let r2: EmbeddedGt =
      EmbeddedGt {
        g1b: g1.generator
          |> g1.scale(scalar.from_int(69 + 1337 * 44203))
          |> g1.compress,
        g2b: None,
      }

    // a = H(r1b)
    let a =
      r1b
        |> level.hash_to_scalar

    // b = H(r1b || r2_bytes)
    let b =
      r1b
        |> bytearray.concat(level.concat_embedded_gt(r2))
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

    EncryptionLevel { r1b, r2, r4b }
  }

pub const alice_filled =
  EncryptionLevel {
    ..alice_level,
    r2: EmbeddedGt {
      g1b: alice_level.r2.g1b,
      g2b: Some(
        g2.generator
          |> g2.scale(scalar.from_int(69 + 1337 * 44203))
          |> g2.compress,
      ),
    },
  }

pub const bob_level: EncryptionLevel = {
    let r = scalar.from_int(123)

    let r2: EmbeddedGt =
      EmbeddedGt {
        g1b: g1.generator
          |> g1.scale(scalar.from_int(67 + 420 * 123))
          |> g1.compress,
        g2b: None,
      }
    level.mk_level_k(token_name, r, r2)
  }

pub const carol_level: EncryptionLevel = {
    let r = scalar.from_int(3)

    let r2: EmbeddedGt =
      EmbeddedGt {
        g1b: g1.generator
          |> g1.scale(scalar.from_int(1 + 2 * 3))
          |> g1.compress,
        g2b: None,
      }
    level.mk_level_k(token_name, r, r2)
  }

test is_alice_verified() {
  level.verify_level_one(alice_level, token_name)
}

test is_bob_verified() {
  level.verify_level_k(bob_level, token_name)
}

test is_carol_verified() {
  level.verify_level_k(carol_level, token_name)
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

test display_wang_params() {
  trace level.wang_h0
  trace level.wang_h1
  trace level.wang_h2
  trace level.wang_h3
  True
}
