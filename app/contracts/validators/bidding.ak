//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/collection/list
use aiken/option
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use search
use types/bidding.{
  BidDatum, BidMintRedeemer, BidSpendRedeemer, EntryBidMint, LeaveBidBurn,
  RemoveBid, UseBid,
}
use types/encryption.{UseEncryption}
use types/reference.{ReferenceDatum}
use types/register
use types/schnorr
use util

validator contract(genesis_pid: PolicyId, genesis_tkn: AssetName) {
  mint(redeemer: BidMintRedeemer, policy_id: PolicyId, self: Transaction) {
    let Transaction {
      inputs,
      outputs,
      reference_inputs,
      mint,
      extra_signatories,
      ..
    }: Transaction = self
    when redeemer is {
      EntryBidMint(schnorr_proof) -> {
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
        // reputation datum needs to be validated so destruct it
        expect BidDatum { owner_vkh, owner_g1, pointer, token }: BidDatum =
          output_datum_data
        // get encryption contract info from reference data
        let ReferenceDatum { encryption, .. }: ReferenceDatum =
          search.for_reference_datum(reference_inputs, genesis_pid, genesis_tkn)
        // reference the encryption utxo for the existence check
        expect Some(_) =
          search.for_input_by_token(reference_inputs, encryption, token)
        //
        //
        //
        and {
          // script output can not have a reference script
          option.is_none(reference_script)?,
          // must be going to the bid contract
          (Script(policy_id) == payment_credential)?,
          // a single token should be minted in this transaction
          assets.has_nft_strict(mint, policy_id, token_name)?,
          // owner_vkh must sign
          list.has(extra_signatories, owner_vkh)?,
          // owner g1 point must be known
          schnorr.verify(owner_g1, schnorr_proof)?,
          // owner g1 point must be valid
          register.is_register_valid(owner_g1)?,
          // token name needs to be in the datum
          (pointer == token_name)?,
        }
      }
      // 
      // single token burn here
      LeaveBidBurn(tkn) ->
        (( mint |> assets.flatten ) == [(policy_id, tkn, -1)])?
    }
  }

  spend(
    maybe_datum: Option<Data>,
    redeemer: BidSpendRedeemer,
    utxo: OutputReference,
    self: Transaction,
  ) {
    when maybe_datum is {
      Some(this_datum) ->
        if this_datum is BidDatum {
          let Transaction {
            inputs,
            outputs,
            reference_inputs,
            extra_signatories,
            redeemers,
            ..
          }: Transaction = self
          let BidDatum { owner_vkh, pointer, token, .. } = this_datum
          expect Some(this_input): Option<Input> =
            inputs
              |> transaction.find_input(utxo)
          expect Script(this_script): PaymentCredential =
            this_input.output.address.payment_credential
          when redeemer is {
            RemoveBid -> {
              let is_holding_token: Bool =
                assets.has_nft(this_input.output.value, this_script, pointer)
              if is_holding_token {
                // token must be burnt, so lets check that no output holds that token
                let burn_token: Bool =
                  list.all(
                    outputs,
                    fn(output) {
                      assets.quantity_of(output.value, this_script, pointer) == 0
                    },
                  )
                //
                // Burn the token and get a signature from the keeper.
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
            }
            UseBid -> {
              // make sure the encrpytion is being spent
              // get encryption contract info from reference data
              let ReferenceDatum { encryption, .. }: ReferenceDatum =
                search.for_reference_datum(
                  reference_inputs,
                  genesis_pid,
                  genesis_tkn,
                )
              // expect a single input if we filter all inputs for the encryption script hash
              expect [
                Input {
                  output_reference,
                  output: Output { value: encryption_value, .. },
                },
              ]: List<Input> =
                inputs
                  |> list.filter(
                      fn(input) {
                        input.output.address.payment_credential == Script(
                          encryption,
                        )
                      },
                    )
              // burn this token
              let burn_token: Bool =
                list.all(
                  outputs,
                  fn(output) {
                    assets.quantity_of(output.value, this_script, pointer) == 0
                  },
                )
              // expect a single input if we filter all inputs for this payment credential
              expect [_]: List<Input> =
                inputs
                  |> list.filter(
                      fn(input) {
                        input.output.address.payment_credential == Script(
                          this_script,
                        )
                      },
                    )
              expect Some(spend_redeemer): Option<Redeemer> =
                search.for_spend_redeemer_by_output_reference(
                  redeemers,
                  output_reference,
                )
              expect UseEncryption(_, _, selected_bid_token, _) = spend_redeemer
              //
              //
              //
              and {
                burn_token?,
                assets.has_nft_strict(encryption_value, encryption, token)?,
                (selected_bid_token == pointer)?,
              }
            }
          }
        } else {
          True
        }
      None -> True
    }
  }

  else(_) {
    fail
  }
}
