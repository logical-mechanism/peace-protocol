//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{ScriptHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, TransactionId,
}
use search
use types/reference.{ReferenceDatum}
use util

validator contract(
  tx_id: TransactionId,
  tx_idx: Int,
  reference_hash: ScriptHash,
) {
  mint(_redeemer: Data, policy_id: PolicyId, self: Transaction) {
    let Transaction { inputs, outputs, mint, .. } = self
    let token_name: AssetName = util.construct_token_name(tx_id, tx_idx)
    // if some(_input) then the tx_id#tx_idx UTxO is being spent
    expect Some(_) =
      inputs
        |> transaction.find_input(
            // just pass in the output reference for it
            OutputReference { transaction_id: tx_id, output_index: tx_idx },
          )
    // search for the output holding this token
    expect Some(Output {
      address: output_address,
      datum: InlineDatum(output_datum_data),
      reference_script,
      ..
    }): Option<Output> =
      search.for_output_by_token(outputs, policy_id, token_name)
    // construct the address of the reference contract
    expect ReferenceDatum { reference, .. }: ReferenceDatum = output_datum_data
    let reference_datum_address: Address = address.from_script(reference)
    //
    and {
      // a single token should be minted in this transaction
      assets.has_nft_strict(mint, policy_id, token_name),
      // M-01: pin the operator-supplied reference hash to the parameter
      // baked in at compile time. Without this check the reference field
      // would be operator-trust only, which would let a mis-deployed system
      // anchor protocol trust on a script the operator controls instead of
      // the always-fail reference.ak.
      reference == reference_hash,
      // must be sent to the reference address
      output_address == reference_datum_address,
      // script output can not have a reference script
      reference_script == None,
    }
  }

  else(_) {
    fail
  }
}
