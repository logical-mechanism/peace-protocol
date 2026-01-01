use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_neg,
  bls12_381_g1_scalar_mul, bls12_381_g1_uncompress, bls12_381_g2_uncompress,
  bls12_381_miller_loop, bls12_381_mul_miller_loop_result, head_list, null_list,
  tail_list,
}

pub type SnarkVerificationKey {
  nPublic: Int,
  vkAlpha: ByteArray,
  // G1
  vkBeta: ByteArray,
  // G2
  vkGamma: ByteArray,
  // G2
  vkDelta: ByteArray,
  // G2
  vkIC: List<ByteArray>,
}

pub type GrothProof {
  piA: ByteArray,
  // G1
  piB: ByteArray,
  // G2
  piC: ByteArray,
}

// G1

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

// Compressed infinity for BLS12-381 G1 in the standard “compressed” format is 48 bytes:
// 0xC0 followed by 47 zero bytes.
pub const g1_inf: ByteArray =
  #"c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

// Standard compressed generator for BLS12-381 G2 (96 bytes). This is the one you already used in tests.
pub const g2_gen: ByteArray =
  #"8541197b983a417f537947eb1835f153141e96e5456e93439f54ee43644cb4207f9eff02733d6872303a3b2dedfeae4d0fa64b17e9b7825176514a3a951256a0416a1bf37982540c304d4dd135e92b87ef276a4ac8ec2349f261e741885cfc90"

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

    // prod = e(A,B) * e(-alpha,beta) * e(-vk_x,gamma) * e(-C,delta)
    let p1 = bls12_381_miller_loop(a, b)
    let p2 = bls12_381_miller_loop(bls12_381_g1_neg(alpha), beta)
    let p3 = bls12_381_miller_loop(bls12_381_g1_neg(vk_x), gamma)
    let p4 = bls12_381_miller_loop(bls12_381_g1_neg(c), delta)

    let p12 = bls12_381_mul_miller_loop_result(p1, p2)
    let p123 = bls12_381_mul_miller_loop_result(p12, p3)
    let prod = bls12_381_mul_miller_loop_result(p123, p4)

    // one = e(infinity, g2_gen)
    let inf_g1 = bls12_381_g1_uncompress(g1_inf)
    let gen_g2 = bls12_381_g2_uncompress(g2_gen)
    let one = bls12_381_miller_loop(inf_g1, gen_g2)

    bls12_381_final_verify(prod, one)
  }
}
