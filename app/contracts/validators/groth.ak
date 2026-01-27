//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto/bls12_381/scalar
use types/groth.{GrothWitnessRedeemer}

validator groth_witness {
  withdraw(redeemer: GrothWitnessRedeemer, _credential, _self) {
    let GrothWitnessRedeemer {
      groth_proof,
      groth_commitment_wire,
      groth_public,
    } = redeemer
    groth.verify_groth16(
      groth.global_snark_vk,
      groth_proof,
      groth_public,
      [groth_commitment_wire |> scalar.from_bytes |> scalar.to_int],
    )
  }

  else(_) {
    fail
  }
}
