//// Copyright 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: Apache-2.0
////
//// Limb compression / decompression for BLS12-381 G1 points.
////
//// gnark serializes a public G1 point into the witness vector as 12 native
//// (Fr) "limbs" — 6 limbs per Fp coordinate (X then Y), with each limb a
//// little-endian u64 fragment of the underlying base-field element.
////
//// On-chain, we usually have the *raw* G1 point (e.g. from a redeemer), and
//// the proof's `groth_public` list of integers must be EXACTLY the limb
//// representation gnark would have produced. This module bridges the two:
////
////   - `g1_compress_from_xy_limbs` reassembles 12 limbs into a 48-byte
////     IETF-compressed G1 point. Use it to *verify* that a list of integers
////     came from a specific G1 point: hash one against the other.
////
////   - `verify_g1_limbs_against_compressed` is a thin wrapper that does
////     exactly that one-shot check (uncompressed input → expected match).
////
////   - `verify_g1_list_against_compressed` does the same for an ordered
////     list of N G1 points consuming the next 12*N limbs of a public-input
////     list.
////
//// G2 limb decompression follows the same principle (4 Fp coords × 6 limbs
//// = 24 limbs per G2 point) but is omitted here — gnark's `Fp2` ordering
//// and IETF G2 compression flags add enough complexity that the right
//// abstraction depends on what your circuit does. The G1 helpers are
//// included because every G1-input circuit hits the same code path, so
//// porting it once saves boilerplate.

use aiken/primitive/bytearray

// 2^64 — the base for little-endian u64 limb reconstruction.
const pow2_64: Int = 18_446_744_073_709_551_616

// BLS12-381 base field modulus p (Fp), 48 bytes big-endian.
const bls12_381_fp_modulus: ByteArray =
  #"1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"

/// Reassemble a list of u64 limbs (little-endian) into a single big integer.
fn limbs_u64le_to_int(limbs: List<Int>) -> Int {
  when limbs is {
    [] -> 0
    [limb, ..rest] -> limb + pow2_64 * limbs_u64le_to_int(rest)
  }
}

// BLS12-381 G1 compression sets a "sign bit" (0x20) iff y is lexicographically
// larger than -y mod p (which, since y < p, is the same as y > p/2).
fn bls_sign_bit_from_y(y: Int) -> Int {
  let p = bytearray.to_int_big_endian(bls12_381_fp_modulus)
  let neg_y = p - y
  if y > neg_y {
    0x20
  } else {
    0
  }
}

/// Reconstruct a 48-byte IETF-compressed G1 point from its 12 native Fr limbs
/// (6 for X, 6 for Y), in the same little-endian order gnark emits them.
pub fn g1_compress_from_xy_limbs(
  x_limbs: List<Int>,
  y_limbs: List<Int>,
) -> ByteArray {
  let x = limbs_u64le_to_int(x_limbs)
  let y = limbs_u64le_to_int(y_limbs)

  // 48-byte big-endian X
  let x_bytes = bytearray.from_int_big_endian(x, 48)

  let sign = bls_sign_bit_from_y(y)

  // Set compression bit (0x80) and sign bit (0x20 if Y is lex-larger)
  let b0 = bytearray.at(x_bytes, 0)
  let b0p = b0 + 0x80 + sign

  let head = bytearray.from_int_big_endian(b0p, 1)
  let tail = bytearray.drop(x_bytes, 1)

  bytearray.concat(head, tail)
}

/// True iff the next 12 limbs of `xy_limbs` (6 X-limbs then 6 Y-limbs)
/// reconstruct to the same compressed bytes as `expected_compressed`.
///
/// Use this when your contract has a known G1 point (e.g. from a redeemer
/// or datum) and you want to verify that the proof's public-input list
/// committed to *exactly* that point.
pub fn verify_g1_limbs_against_compressed(
  expected_compressed: ByteArray,
  xy_limbs: List<Int>,
) -> Bool {
  expect [x0, x1, x2, x3, x4, x5, y0, y1, y2, y3, y4, y5, ..] = xy_limbs
  g1_compress_from_xy_limbs(
    [x0, x1, x2, x3, x4, x5],
    [y0, y1, y2, y3, y4, y5],
  ) == expected_compressed
}

/// Drop the first 12 entries of a limb list — convenience for chaining
/// multiple `verify_g1_limbs_against_compressed` calls against the same
/// `groth_public` list (each G1 consumes 12 limbs).
pub fn drop_g1(xy_limbs: List<Int>) -> List<Int> {
  when xy_limbs is {
    [_, _, _, _, _, _, _, _, _, _, _, _, ..rest] -> rest
    _ -> fail @"drop_g1: fewer than 12 limbs remaining"
  }
}

/// Verify that an ordered list of N G1 points (as compressed bytes) matches
/// the first 12*N entries of `xy_limbs`. Returns True iff every point
/// reconstructs from its corresponding 12-limb slice.
///
/// This is the typical entry point for a validator that holds raw G1 points
/// in the redeemer and needs to bind them to the proof's public inputs in
/// one shot.
pub fn verify_g1_list_against_compressed(
  expected_points: List<ByteArray>,
  xy_limbs: List<Int>,
) -> Bool {
  when expected_points is {
    [] -> True
    [p, ..rest] ->
      verify_g1_limbs_against_compressed(p, xy_limbs) && verify_g1_list_against_compressed(
        rest,
        drop_g1(xy_limbs),
      )
  }
}
