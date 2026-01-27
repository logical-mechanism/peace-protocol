//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/collection/list
use aiken/crypto/bls12_381/scalar
use aiken/option
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}
use search
use types/groth.{
  EntryGrothMint, GrothDatum, GrothMintRedeemer, GrothSpendRedeemer,
  LeaveGrothBurn,
}
use util

validator contract {
  mint(redeemer: GrothMintRedeemer, policy_id: PolicyId, self: Transaction) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. }: Transaction =
      self
    when redeemer is {
      EntryGrothMint(groth_proof, groth_commitment_wire, groth_public) -> {
        // token name is based off the first UTxO being spent in this transaction
        let token_name: AssetName = util.generate_token_name(inputs)
        // find the output that holds the token being minted
        expect Some(Output {
          address: Address { payment_credential, .. },
          datum: InlineDatum(output_datum_data),
          reference_script,
          ..
        }): Option<Output> =
          search.for_output_by_token(outputs, policy_id, token_name)
        // Groth datum needs to be validated so destruct it
        expect GrothDatum { owner_vkh, token, public_integers }: GrothDatum =
          output_datum_data
        //
        and {
          // do groth stuff
          (public_integers == groth_public)?,
          groth.verify_groth16(
            groth.global_snark_vk,
            groth_proof,
            groth_public,
            [groth_commitment_wire |> scalar.from_bytes |> scalar.to_int],
          )?,
          groth.verify_commitments(groth.global_snark_vk, groth_proof)?,
          // token name needs to be in the datum
          (token == token_name)?,
          // script output can not have a reference script
          option.is_none(reference_script)?,
          // must be going to the Groth contract
          (Script(policy_id) == payment_credential)?,
          // a single token should be minted in this transaction
          assets.has_nft_strict(mint, policy_id, token_name)?,
          // owner_vkh must sign
          list.has(extra_signatories, owner_vkh)?,
        }
      }
      // single token burn here
      LeaveGrothBurn(tkn) ->
        (( mint |> assets.flatten ) == [(policy_id, tkn, -1)])?
    }
  }

  spend(
    maybe_datum: Option<Data>,
    _redeemer: GrothSpendRedeemer,
    utxo: OutputReference,
    self: Transaction,
  ) {
    when maybe_datum is {
      Some(this_datum) ->
        if this_datum is GrothDatum {
          let Transaction { inputs, outputs, extra_signatories, .. }: Transaction =
            self
          let GrothDatum { owner_vkh, token, .. } = this_datum
          expect Some(this_input): Option<Input> =
            inputs
              |> transaction.find_input(utxo)
          expect Script(this_script): PaymentCredential =
            this_input.output.address.payment_credential
          let is_holding_token: Bool =
            assets.has_nft(this_input.output.value, this_script, token)
          if is_holding_token {
            // token must be burnt, so lets check that no output holds that token
            let burn_token: Bool =
              list.all(
                outputs,
                fn(output) {
                  assets.quantity_of(output.value, this_script, token) == 0
                },
              )
            //
            and {
              // owner_vkh must sign
              list.has(extra_signatories, owner_vkh)?,
              // must burn token
              burn_token?,
            }
          } else {
            // invalid start
            True
          }
        } else {
          // bad datum
          True
        }
      // no datum
      None -> True
    }
  }

  else(_) {
    fail
  }
}
