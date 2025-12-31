use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_compress,
  bls12_381_g1_neg, bls12_381_g1_scalar_mul, bls12_381_g1_uncompress,
  bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result, head_list, null_list, tail_list,
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

// Produce a MillerLoopResult that is the identity under final exponentiation.
// e(0_G1, Q) = 1 for any valid Q in G2.
fn ml_one(any_g1: G1Element, any_g2: G2Element) -> MillerLoopResult {
  let g1_zero: G1Element = bls12_381_g1_scalar_mul(0, any_g1)
  bls12_381_miller_loop(g1_zero, any_g2)
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

    // Build the "should equal 1" product:
    // e(A,B) * e(-alpha,beta) * e(-vk_x,gamma) * e(-C,delta)
    let p1 = bls12_381_miller_loop(a, b)
    let p2 = bls12_381_miller_loop(bls12_381_g1_neg(alpha), beta)
    let p3 = bls12_381_miller_loop(bls12_381_g1_neg(vk_x), gamma)
    let p4 = bls12_381_miller_loop(bls12_381_g1_neg(c), delta)

    let p12 = bls12_381_mul_miller_loop_result(p1, p2)
    let p123 = bls12_381_mul_miller_loop_result(p12, p3)
    let prod = bls12_381_mul_miller_loop_result(p123, p4)

    let one = ml_one(alpha, beta)

    bls12_381_final_verify(prod, one)
  }
}
