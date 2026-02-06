//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use limb_compression.{verify_limb_compression}
use search
use types/bidding.{BidDatum, UseBid}
use types/encryption.{
  CancelEncryption, EncryptionDatum, EncryptionMintRedeemer,
  EncryptionSpendRedeemer, EntryEncryptionMint, LeaveEncryptionBurn, Open,
  Pending, RemoveEncryption, UseEncryption, UseSnark,
}
use types/groth.{GrothWitnessRedeemer, verify_commitments}
use types/level.{FullEncryptionLevel}
use types/reference.{ReferenceDatum}
use types/register
use types/schnorr
use util

fn has(self: List<a>, elem: a) -> Bool {
  when self is {
    [] -> False
    [x, ..rest] ->
      if x == elem {
        True
      } else {
        has(rest, elem)
      }
  }
}

fn no_output_holds_token(
  outputs: List<Output>,
  pid: PolicyId,
  tkn: AssetName,
) -> Bool {
  when outputs is {
    [] -> True
    [output, ..rest] ->
      if assets.quantity_of(output.value, pid, tkn) == 0 {
        no_output_holds_token(rest, pid, tkn)
      } else {
        False
      }
  }
}

validator contract(genesis_pid: PolicyId, genesis_tkn: AssetName) {
  mint(redeemer: EncryptionMintRedeemer, policy_id: PolicyId, self: Transaction) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. }: Transaction =
      self
    when redeemer is {
      EntryEncryptionMint(schnorr_proof, binding_proof) -> {
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
        // encryption datum needs to be validated so destruct it
        expect EncryptionDatum {
          owner_vkh,
          owner_g1,
          token,
          half_level,
          full_level,
          status,
          ..
        }: EncryptionDatum = output_datum_data
        // enter into the open state
        expect Open = status
        //
        and {
          // token name needs to be in the datum
          (token == token_name),
          // script output can not have a reference script
          (reference_script == None),
          // must be going to the encryption contract
          (Script(policy_id) == payment_credential),
          // a single token should be minted in this transaction
          assets.has_nft_strict(mint, policy_id, token_name),
          // owner_vkh must sign
          has(extra_signatories, owner_vkh),
          // owner g1 point must be known
          schnorr.verify(owner_g1, schnorr_proof),
          // owner g1 point must be valid
          register.is_register_valid(owner_g1),
          // must be valid level 1
          level.verify_first_half_level(half_level, token_name),
          full_level == None,
          // must be using original owner
          schnorr.binding_verify(
            owner_g1,
            binding_proof,
            half_level.r1b,
            half_level.r2_g1b,
            token_name,
          ),
        }
      }
      // single token burn here
      LeaveEncryptionBurn(tkn) ->
        ( mint |> assets.flatten ) == [(policy_id, tkn, -1)]
    }
  }

  spend(
    maybe_datum: Option<Data>,
    redeemer: EncryptionSpendRedeemer,
    utxo: OutputReference,
    self: Transaction,
  ) {
    when maybe_datum is {
      Some(this_datum) ->
        if this_datum is EncryptionDatum {
          let Transaction {
            inputs,
            outputs,
            extra_signatories,
            reference_inputs,
            redeemers,
            validity_range,
            ..
          }: Transaction = self
          let EncryptionDatum {
            owner_vkh,
            owner_g1,
            token,
            half_level,
            capsule,
            status,
            ..
          } = this_datum
          expect Some(this_input): Option<Input> =
            inputs
              |> transaction.find_input(utxo)
          expect Script(this_script): PaymentCredential =
            this_input.output.address.payment_credential
          when redeemer is {
            RemoveEncryption -> {
              let is_holding_token: Bool =
                assets.has_nft(this_input.output.value, this_script, token)
              if is_holding_token {
                // token must be burnt, so lets check that no output holds that token
                let burn_token: Bool =
                  no_output_holds_token(outputs, this_script, token)
                // cant remove if pending
                expect Open = status
                //
                and {
                  // owner_vkh must sign
                  has(extra_signatories, owner_vkh),
                  // must burn token
                  burn_token,
                }
              } else {
                // invalid start
                True
              }
            }
            UseEncryption(witness, r5, selected_bid_token, binding_proof) -> {
              // this token going back
              expect Some(Output {
                address: Address { payment_credential, .. },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // datum going back
              expect EncryptionDatum {
                owner_vkh: next_owner_vkh,
                owner_g1: next_owner_g1,
                token: next_token,
                half_level: next_half_level,
                full_level: maybe_next_full_level,
                capsule: next_capsule,
                status: next_status,
              }: EncryptionDatum = output_datum_data
              // get the bidding contract hash from the reference datum
              let ReferenceDatum { bid, .. }: ReferenceDatum =
                search.for_reference_datum(
                  reference_inputs,
                  genesis_pid,
                  genesis_tkn,
                )
              // get the bidding contract redeemer
              expect Some(Input {
                output_reference,
                output: Output {
                  address: Address {
                    payment_credential: bid_payment_credential,
                    ..
                  },
                  datum: InlineDatum(bidding_datum_data),
                  ..
                },
              }) = search.for_input_by_token(inputs, bid, selected_bid_token)
              expect Some(spend_redeemer): Option<Redeemer> =
                search.for_spend_redeemer_by_output_reference(
                  redeemers,
                  output_reference,
                )
              expect UseBid = spend_redeemer
              expect BidDatum {
                owner_vkh: bid_owner_vkh,
                owner_g1: bid_owner_g1,
                ..
              }: BidDatum = bidding_datum_data
              expect Some(next_full_level): Option<FullEncryptionLevel> =
                maybe_next_full_level
              // must be in pending and going to open
              expect Pending(groth_public, _) = status
              expect Open = next_status
              //
              and {
                // verify limb compression
                verify_limb_compression(
                  bid_owner_g1.public_value,
                  witness,
                  next_half_level.r2_g1b,
                  groth_public,
                ),
                // cipher text can not change
                (capsule == next_capsule),
                // this token can not chnage
                (token == next_token),
                // bid owner is new owner
                (bid_owner_vkh == next_owner_vkh),
                (bid_owner_g1 == next_owner_g1),
                // check if correct script hashes
                (Script(this_script) == payment_credential),
                (Script(bid) == bid_payment_credential),
                // script output can not have a reference script
                (reference_script == None),
                // consistency check; expand here for better r5 validation
                level.verify_r5(owner_g1, r5, witness),
                // correct level addition
                level.add_new_half_level(
                  next_half_level,
                  half_level,
                  next_full_level,
                  r5,
                  token,
                  bid_owner_g1,
                  binding_proof,
                ),
                // owner_vkh must sign
                has(extra_signatories, owner_vkh),
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }

            UseSnark -> {
              expect Open = status
              // this token going back
              expect Some(Output {
                address: Address { payment_credential, .. },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // get the groth script hash and snark vk from the reference datum
              let ReferenceDatum { groth: groth_script, snark_vk, .. }: ReferenceDatum =
                search.for_reference_datum(
                  reference_inputs,
                  genesis_pid,
                  genesis_tkn,
                )
              // get the groth_witness withdraw redeemer
              expect Some(withdraw_redeemer): Option<Redeemer> =
                search.for_withdraw_redeemer_by_script_hash(
                  redeemers,
                  groth_script,
                )
              expect GrothWitnessRedeemer { groth_proof, groth_public, ttl, .. }: GrothWitnessRedeemer =
                withdraw_redeemer
              // we need to know how to make the ttl
              expect Interval {
                lower_bound: IntervalBound { bound_type: Finite(lb), .. },
                upper_bound: IntervalBound { bound_type: Finite(ub), .. },
              } = validity_range
              let finite_interval_length: Int = ub - lb
              let expected_ttl: Int = ub + encryption.pending_ttl
              // build out the new status
              let expected_output_datum_data: Data =
                EncryptionDatum {
                  ..this_datum,
                  status: Pending(groth_public, ttl),
                }
              //
              and {
                // validity range stuff
                (expected_ttl <= ttl),
                (ttl <= 2 * expected_ttl),
                (finite_interval_length <= encryption.snark_validity_window),
                // do groth stuff via groth_witness withdraw validator
                verify_commitments(snark_vk, groth_proof),
                // owner must sign it
                has(extra_signatories, owner_vkh),
                // datum must go back to open
                (output_datum_data == expected_output_datum_data),
                // check if correct script hashes
                (Script(this_script) == payment_credential),
                // script output can not have a reference script
                (reference_script == None),
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }

            CancelEncryption -> {
              // this token going back
              expect Some(Output {
                address: Address { payment_credential, .. },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // everything is constant but the status
              let expected_output_datum_data: Data =
                EncryptionDatum { ..this_datum, status: Open }
              // cancel the encryption process if it takes too long
              expect Pending(_, ttl) = status
              // either expired or cancel
              let expired_or_cancel: Bool = or {
                  when validity_range.lower_bound.bound_type is {
                    Finite(lb) -> lb > ttl
                    _ -> False
                  },
                  has(extra_signatories, owner_vkh),
                }
              //
              and {
                // either owner signs to cancel or it has expired
                expired_or_cancel,
                // datum must go back to open
                (output_datum_data == expected_output_datum_data),
                // check if correct script hashes
                (Script(this_script) == payment_credential),
                // script output can not have a reference script
                (reference_script == None),
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }
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
