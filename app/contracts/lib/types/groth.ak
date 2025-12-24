use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_compress,
  bls12_381_g1_scalar_mul, bls12_381_g1_uncompress, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result, head_list, null_list,
  tail_list,
}
use aiken/crypto
use aiken/primitive/bytearray

pub fn public_inputs_from_w(w: ByteArray) -> List<Int> {
  let d = crypto.sha2_256(w)

  let left = bytearray.take(d, n: 16)
  let right = bytearray.drop(d, n: 16)

  let i0 = bytearray.to_int_big_endian(left)
  let i1 = bytearray.to_int_big_endian(right)

  [i0, i1]
}

pub type SnarkVerificationKey {
  nPublic: Int,
  // G1
  vkAlpha: ByteArray,
  // G2
  vkBeta: ByteArray,
  // G2
  vkGamma: ByteArray,
  // G2
  vkDelta: ByteArray,
  // IC[0..nPublic]
  vkIC: List<ByteArray>,
}

pub type GrothProof {
  // G1
  piA: ByteArray,
  // G2
  piB: ByteArray,
  // G1
  piC: ByteArray,
}

fn len_list(xs: List<a>) -> Int {
  when xs is {
    [] -> 0
    [_h, ..t] -> 1 + len_list(t)
  }
}

fn compute_vk_x(vkIC: List<ByteArray>, inputs: List<Int>) -> G1Element {
  // enforce non-empty IC
  expect !null_list(vkIC)

  let ic0_bytes = head_list(vkIC)
  let ic_tail = tail_list(vkIC)

  let acc0: G1Element = bls12_381_g1_uncompress(ic0_bytes)

  compute_vk_x_go(acc0, inputs, ic_tail)
}

fn compute_vk_x_go(
  acc: G1Element,
  inputs: List<Int>,
  ic_tail: List<ByteArray>,
) -> G1Element {
  when inputs is {
    [] -> acc

    [i, ..rest_inputs] -> {
      // “expect …” must be tied to an expression result.
      expect !null_list(ic_tail)

      let ic_i_bytes = head_list(ic_tail)
      let ic_rest = tail_list(ic_tail)

      let ic_i: G1Element = bls12_381_g1_uncompress(ic_i_bytes)
      let term: G1Element = bls12_381_g1_scalar_mul(i, ic_i)
      let acc1: G1Element = bls12_381_g1_add(acc, term)

      compute_vk_x_go(acc1, rest_inputs, ic_rest)
    }
  }
}

pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  inputs: List<Int>,
) -> Bool {
  if vk.nPublic != len_list(inputs) {
    False
  } else if len_list(vk.vkIC) != len_list(inputs) + 1 {
    False
  } else {
    let a: G1Element = bls12_381_g1_uncompress(proof.piA)
    let b: G2Element = bls12_381_g2_uncompress(proof.piB)
    let c: G1Element = bls12_381_g1_uncompress(proof.piC)

    let alpha: G1Element = bls12_381_g1_uncompress(vk.vkAlpha)
    let beta: G2Element = bls12_381_g2_uncompress(vk.vkBeta)
    let gamma: G2Element = bls12_381_g2_uncompress(vk.vkGamma)
    let delta: G2Element = bls12_381_g2_uncompress(vk.vkDelta)

    let vk_x: G1Element = compute_vk_x(vk.vkIC, inputs)

    trace bls12_381_g1_compress(vk_x)

    // left = e(A, B)
    let left = bls12_381_miller_loop(a, b)

    // right = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
    let r1 = bls12_381_miller_loop(alpha, beta)
    let r2 = bls12_381_miller_loop(vk_x, gamma)
    let r3 = bls12_381_miller_loop(c, delta)

    let right12 = bls12_381_mul_miller_loop_result(r1, r2)
    let right = bls12_381_mul_miller_loop_result(right12, r3)

    bls12_381_final_verify(left, right)
  }
}
