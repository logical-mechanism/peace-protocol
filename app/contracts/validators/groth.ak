//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto/bls12_381/scalar
use cardano/address.{Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/certificate.{Certificate, RegisterCredential}
use cardano/transaction.{Transaction}
use search
use types/groth.{GrothWitnessRedeemer, Register, RegisterRedeemer}
use types/reference.{ReferenceDatum}

validator groth_witness(genesis_pid: PolicyId, genesis_tkn: AssetName) {
  withdraw(redeemer: GrothWitnessRedeemer, _credential, self: Transaction) {
    let GrothWitnessRedeemer {
      groth_proof,
      groth_commitment_wire,
      groth_public,
      ..
    } = redeemer
    let Transaction { reference_inputs, .. } = self
    let ReferenceDatum { snark_vk, .. }: ReferenceDatum =
      search.for_reference_datum(reference_inputs, genesis_pid, genesis_tkn)
    groth.verify_groth16(
      snark_vk,
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
