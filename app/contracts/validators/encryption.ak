//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/collection/list.{has}
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
  Pending, RemoveEncryption, UpdateEncryptionPrice, UseEncryption, UseSnark,
}
use types/groth.{GrothWitnessRedeemer, verify_commitments}
use types/level.{FullEncryptionLevel}
use types/reference.{ReferenceDatum}
use types/register
use types/schnorr
use util

validator contract(genesis_pid: PolicyId, genesis_tkn: AssetName) {
  mint(redeemer: EncryptionMintRedeemer, policy_id: PolicyId, self: Transaction) {
    let Transaction { inputs, outputs, mint, extra_signatories, .. }: Transaction =
      self
    when redeemer is {
      EntryEncryptionMint(schnorr_proof, binding_proof) -> {
        // token name is based off the first UTxO being spent in this transaction
        let token_name: AssetName = util.generate_token_name(inputs)
        // find the output that holds the token being minted.
        //
        // H-01 fix (inlined for size): destructure the address into both
        // `payment_credential` AND `stake_credential` here so they can
        // be compared in the `and {}` block below. The equivalent
        // `util.is_protocol_output(o, h)` helper exists for unit tests
        // but is not called inside the validators because cross-module
        // calls do not inline and inflated each handler by ~1KB.
        expect Some(Output {
          address: Address { payment_credential, stake_credential },
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
          token == token_name,
          // H-01 perimeter pin (inlined): payment_credential = Script(h),
          // stake_credential = None, reference_script = None.
          payment_credential == Script(policy_id),
          stake_credential == None,
          reference_script == None,
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
                  search.no_output_holds_token(outputs, this_script, token)
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
                // hyperstructure escape (H-03 carried Intentional): the
                // UTxO has a valid EncryptionDatum shape but does not
                // hold the protocol NFT, so it is junk that ended up at
                // this script address by accident. Returning True lets
                // the depositor recover the funds. Combined with the
                // bad-datum branch below, every non-protocol UTxO at
                // this address is sweepable by design.
                True
              }
            }
            UseEncryption(witness, r5, selected_bid_token, binding_proof) -> {
              // H-04 carried (Design Tradeoff): lovelace not preserved on
              // continuing encryption UTxOs across UseEncryption / UseSnark
              // / CancelEncryption. By design — see audit §H-04. The
              // motivation is a "penalty mechanism": if the seller lets a
              // Pending state expire, anyone may CancelEncryption and the
              // continuing output need only carry min-ADA. Reversing the
              // policy means adding `lovelace_of(input) <= lovelace_of(
              // output)` here, in UseSnark, and in CancelEncryption.

              // this token going back. H-01 fix (inlined): destructure
              // the perimeter fields here so they can be compared below.
              expect Some(Output {
                address: Address { payment_credential, stake_credential },
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
                new_price: next_new_price,
              }: EncryptionDatum = output_datum_data
              // get the bidding contract hash and snark vk from the reference datum
              let ReferenceDatum { bid, snark_vk, .. }: ReferenceDatum =
                search.for_reference_datum(
                  reference_inputs,
                  genesis_pid,
                  genesis_tkn,
                )
              // get the bidding contract redeemer. H-01 fix (inlined):
              // pin the bid input's perimeter at the destructure site
              // so the singleton-input filter can't be bypassed.
              expect Some(Input {
                output_reference,
                output: Output {
                  address: Address {
                    payment_credential: bid_payment_credential,
                    stake_credential: bid_stake_credential,
                  },
                  datum: InlineDatum(bidding_datum_data),
                  reference_script: bid_reference_script,
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
                new_price: bid_new_price,
                ..
              }: BidDatum = bidding_datum_data
              expect Some(next_full_level): Option<FullEncryptionLevel> =
                maybe_next_full_level
              // must be in pending and going to open
              expect Pending(groth_proof, groth_public, _) = status
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
                // verify commitment proof of knowledge
                verify_commitments(snark_vk, groth_proof),
                // cipher text can not change
                capsule == next_capsule,
                // this token can not chnage
                token == next_token,
                // bid owner is new owner
                bid_owner_vkh == next_owner_vkh,
                bid_owner_g1 == next_owner_g1,
                // new price comes from the bid datum
                bid_new_price == next_new_price,
                // H-01 perimeter pin (inlined): continuing encryption
                // output. payment_credential = Script(this_script),
                // stake_credential = None, reference_script = None.
                payment_credential == Script(this_script),
                stake_credential == None,
                reference_script == None,
                // H-01 perimeter pin (inlined): bid input. Same shape;
                // a hostile builder cannot smuggle an adversarial
                // stake_credential or attached reference_script through
                // the bid-input lookup path.
                bid_payment_credential == Script(bid),
                bid_stake_credential == None,
                bid_reference_script == None,
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
              // H-04 carried (Design Tradeoff): lovelace not preserved
              // — see UseEncryption above for rationale.
              expect Open = status
              // this token going back. H-01 fix (inlined).
              expect Some(Output {
                address: Address { payment_credential, stake_credential },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // get the groth script hash from the reference datum
              let ReferenceDatum { groth: groth_script, .. }: ReferenceDatum =
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
                  status: Pending(groth_proof, groth_public, ttl),
                }
              //
              and {
                // validity range stuff
                expected_ttl <= ttl,
                ttl <= 2 * expected_ttl,
                finite_interval_length <= encryption.snark_validity_window,
                // owner must sign it
                has(extra_signatories, owner_vkh),
                // datum must go back to open
                output_datum_data == expected_output_datum_data,
                // H-01 perimeter pin (inlined): closes the signed UseSnark
                // path against stake-credential hijack.
                payment_credential == Script(this_script),
                stake_credential == None,
                reference_script == None,
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }

            CancelEncryption -> {
              // H-04 carried (Design Tradeoff): the *permissionless* TTL-
              // expired branch is the highest-impact penalty path —
              // anyone can drain the lovelace once the Pending TTL is
              // past, leaving only min-ADA. This is the seller's penalty
              // for letting Pending expire. See audit §H-04.
              // this token going back. H-01 fix (inlined).
              expect Some(Output {
                address: Address { payment_credential, stake_credential },
                datum: InlineDatum(output_datum_data),
                reference_script,
                ..
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // everything is constant but the status
              let expected_output_datum_data: Data =
                EncryptionDatum { ..this_datum, status: Open }
              // cancel the encryption process if it takes too long
              expect Pending(_, _, ttl) = status
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
                output_datum_data == expected_output_datum_data,
                // H-01 perimeter pin (inlined): closes the *permissionless*
                // TTL-expired CancelEncryption branch — the highest-impact
                // H-01 attack path.
                payment_credential == Script(this_script),
                stake_credential == None,
                reference_script == None,
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }

            UpdateEncryptionPrice(price) -> {
              // L-03 carried (Design Tradeoff): owner may self-drain
              // lovelace on this path — only non-ADA tokens are pinned
              // (`input_tokens == output_tokens` below). The owner is
              // signed-in, so this is owner-controlled; see audit §L-03.
              //
              // I-05 carried (Advisory): `price` is an advisory `new_price`
              // only — it is NOT bound to lovelace_of(output). Off-chain
              // UIs MUST present "bid amount" and "declared resale price"
              // separately. See audit §I-05 / lib/types/encryption.ak.
              // this token going back. H-01 fix (inlined).
              expect Some(Output {
                address: Address { payment_credential, stake_credential },
                datum: InlineDatum(output_datum_data),
                reference_script,
                value: output_value,
              }): Option<Output> =
                search.for_output_by_token(outputs, this_script, token)
              // can only update price when open
              expect Open = status
              // everything is constant but the new_price
              let expected_output_datum_data: Data =
                EncryptionDatum { ..this_datum, new_price: price }
              // ensure non-ADA tokens are preserved
              let input_tokens =
                this_input.output.value |> assets.without_lovelace
              let output_tokens = output_value |> assets.without_lovelace
              //
              and {
                // price must be non-negative
                price >= 0,
                // only the new_price field can change
                output_datum_data == expected_output_datum_data,
                // non-ADA tokens must be preserved
                input_tokens == output_tokens,
                // owner_vkh must sign
                has(extra_signatories, owner_vkh),
                // H-01 perimeter pin (inlined): closes the signed
                // UpdateEncryptionPrice path.
                payment_credential == Script(this_script),
                stake_credential == None,
                reference_script == None,
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token),
              }
            }
          }
        } else {
          // bad datum: hyperstructure escape — any UTxO arriving at the
          // encryption script address with a non-EncryptionDatum shape is
          // freely sweepable. Documented intent (H-02 carried Intentional)
          // — entry can only happen by accident or external mis-deposit.
          True
        }
      // hyperstructure escape (H-02 carried Intentional): a UTxO at the
      // encryption script address with no inline datum is junk. Returning
      // True lets the depositor recover the funds.
      None -> True
    }
  }

  else(_) {
    fail
  }
}
