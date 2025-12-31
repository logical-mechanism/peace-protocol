use aiken/builtin.{
  bls12_381_final_verify, bls12_381_g1_add, bls12_381_g1_scalar_mul,
  bls12_381_g1_uncompress, bls12_381_g2_uncompress, bls12_381_miller_loop,
  bls12_381_mul_miller_loop_result, head_list, null_list, tail_list,
}

pub type SnarkVerificationKey {
  nPublic: Int,
  // G1 (compressed)
  vkAlpha: ByteArray,
  // G2 (compressed)
  vkBeta: ByteArray,
  // G2 (compressed)
  vkGamma: ByteArray,
  // G2 (compressed)
  vkDelta: ByteArray,
  // IC[0..nPublic] (each compressed G1)
  vkIC: List<ByteArray>,
}

pub type GrothProof {
  // G1 (compressed)
  piA: ByteArray,
  // G2 (compressed)
  piB: ByteArray,
  // G1 (compressed)
  piC: ByteArray,
}

fn len_list(xs: List<a>) -> Int {
  when xs is {
    [] -> 0
    [_h, ..t] -> 1 + len_list(t)
  }
}

// Compute vk_x = IC0 + sum_{j=0..n-1} inputs[j] * IC[j+1]
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
    [] ->
      // At this point, ic_tail should be empty (because vkIC len == inputs len + 1)
      // We don't *need* to enforce it here since verify_groth16 checks lengths,
      // but keeping it tight makes debugging simpler.
      acc

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

pub fn verify_groth16(
  vk: SnarkVerificationKey,
  proof: GrothProof,
  inputs: List<Int>,
) -> Bool {
  // These must match the exact JSON you export:
  // - public.json Inputs length == vk.nPublic
  // - vk.vkIC length == vk.nPublic + 1
  if vk.nPublic != len_list(inputs) {
    False
  } else if len_list(vk.vkIC) != len_list(inputs) + 1 {
    False
  } else {
    // Uncompress proof elements
    let a: G1Element = bls12_381_g1_uncompress(proof.piA)
    let b: G2Element = bls12_381_g2_uncompress(proof.piB)
    let c: G1Element = bls12_381_g1_uncompress(proof.piC)

    // Uncompress vk elements
    let alpha: G1Element = bls12_381_g1_uncompress(vk.vkAlpha)
    let beta: G2Element = bls12_381_g2_uncompress(vk.vkBeta)
    let gamma: G2Element = bls12_381_g2_uncompress(vk.vkGamma)
    let delta: G2Element = bls12_381_g2_uncompress(vk.vkDelta)

    // vk_x from IC + public inputs
    let vk_x: G1Element = compute_vk_x(vk.vkIC, inputs)

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
