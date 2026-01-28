//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto/bls12_381/scalar
use cardano/address.{Script}
use cardano/certificate.{Certificate, RegisterCredential}
use cardano/transaction.{Transaction}
use types/groth.{GrothWitnessRedeemer, Register, RegisterRedeemer}

validator groth_witness {
  withdraw(redeemer: GrothWitnessRedeemer, _credential, _self) {
    let GrothWitnessRedeemer {
      groth_proof,
      groth_commitment_wire,
      groth_public,
      ..
    } = redeemer
    groth.verify_groth16(
      groth.global_snark_vk,
      groth_proof,
      groth_public,
      [groth_commitment_wire |> scalar.from_bytes |> scalar.to_int],
    )
  }

  publish(
    redeemer: RegisterRedeemer,
    certificate: Certificate,
    _transaction: Transaction,
  ) {
    let Register(script_hash) = redeemer
    when certificate is {
      RegisterCredential { credential, .. } -> credential == Script(script_hash)
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
