//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/primitive/bytearray

// 2^64
const pow2_64: Int = 18_446_744_073_709_551_616

// BLS12-381 base field modulus p (Fp), 48 bytes
const bls12_381_fp_modulus: ByteArray =
  #"1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"

fn limbs_u64le_to_int(limbs: List<Int>) -> Int {
  when limbs is {
    [] -> 0
    [limb, ..rest] -> limb + pow2_64 * limbs_u64le_to_int(rest)
  }
}

// Canonical "sign" bit rule used by blst-style serialization:
// sign = 1 iff y is lexicographically larger than (-y mod p) == (p - y).
fn bls_sign_bit_from_y(y: Int) -> Int {
  // Convert p from bytes to Int (big-endian) :contentReference[oaicite:1]{index=1}
  let p = bytearray.to_int_big_endian(bls12_381_fp_modulus)

  // assume y is already reduced (0 <= y < p) for points coming from valid decompression
  let negy = p - y

  if y > negy {
    0x20
  } else {
    0
  }
}

pub fn g1_compress_from_xy_limbs(
  x_limbs: List<Int>,
  y_limbs: List<Int>,
) -> ByteArray {
  let x = limbs_u64le_to_int(x_limbs)
  let y = limbs_u64le_to_int(y_limbs)

  // 48-byte big-endian x
  let x_bytes = bytearray.from_int_big_endian(x, 48)

  let sign = bls_sign_bit_from_y(y)

  // set compression bit 0x80 and sign bit 0x20 (if needed)
  let b0 = bytearray.at(x_bytes, 0)
  let b0p = b0 + 0x80 + sign

  let head = bytearray.from_int_big_endian(b0p, 1)
  let tail = bytearray.drop(x_bytes, 1)

  bytearray.concat(head, tail)
}

pub fn limbs_match_g1_point(
  expected_compressed: ByteArray,
  x_limbs: List<Int>,
  y_limbs: List<Int>,
) -> Bool {
  g1_compress_from_xy_limbs(x_limbs, y_limbs) == expected_compressed
}

fn take6(xs: List<Int>) -> (List<Int>, List<Int>) {
  expect [a, b, c, d, e, f, ..rest] = xs
  ([a, b, c, d, e, f], rest)
}

/// Three G1 points decode into six points, requiring six integers to be
/// represented, totallying 36 elements.
///
pub fn verify_limb_compression(
  v: ByteArray,
  w0: ByteArray,
  w1: ByteArray,
  public_integers: List<Int>,
) -> Bool {
  let (v_x, r0) = take6(public_integers)
  let (v_y, r1) = take6(r0)
  let (w0_x, r2) = take6(r1)
  let (w0_y, r3) = take6(r2)
  let (w1_x, r4) = take6(r3)
  let (w1_y, _) = take6(r4)
  and {
    limbs_match_g1_point(v, v_x, v_y),
    limbs_match_g1_point(w0, w0_x, w0_y),
    limbs_match_g1_point(w1, w1_x, w1_y),
  }
}
