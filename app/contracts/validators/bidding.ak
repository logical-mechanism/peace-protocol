//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/collection/list.{has}
use aiken/interval.{Finite}
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use search
use types/bidding.{
  BidDatum, BidMintRedeemer, BidSpendRedeemer, EntryBidMint, LeaveBidBurn,
  RemoveBid, UpdateBidPrice, UseBid,
}
use types/encryption.{UseEncryption}
use types/reference.{ReferenceDatum}
use types/register
use types/schnorr
use util

validator contract(genesis_pid: PolicyId, genesis_tkn: AssetName) {
  mint(redeemer: BidMintRedeemer, policy_id: PolicyId, self: Transaction) {
    let  
        Transaction {
          inputs,
          outputs,
          reference_inputs,
          mint,
          extra_signatories,
          validity_range,
          ..
        }: Transaction
      = self
    when redeemer is {
      EntryBidMint(schnorr_proof) -> {
        // token name is based off the first UTxO being spent in this transaction
        let token_name: AssetName = util.generate_token_name(inputs)
        // find the output that holds the token being minted. H-01 fix
        // (inlined): destructure the perimeter fields here so they can
        // be compared in the `and {}` block below.
        expect  
            Some(Output {
              address: Address { payment_credential, stake_credential },
              datum: InlineDatum(output_datum_data),
              reference_script,
              ..
            }): Option<Output>
          = search.for_output_by_token(outputs, policy_id, token_name)
        // reputation datum needs to be validated so destruct it
        expect  
            BidDatum { owner_vkh, owner_g1, pointer, token, locked_until, .. }: BidDatum
          = output_datum_data
        // get encryption contract info from reference data
        let ReferenceDatum { encryption, .. }: ReferenceDatum = search.for_reference_datum(
          reference_inputs,
          genesis_pid,
          genesis_tkn,
        )
        // reference the encryption utxo for the existence check
        expect Some(_) = search.for_input_by_token(
          reference_inputs,
          encryption,
          token,
        )
        // locked_until must be at least minimum_bid_lock from now
        let lock_is_valid: Bool = when
          validity_range.upper_bound.bound_type
        is {
          Finite(ub) -> locked_until >= ub + bidding.minimum_bid_lock
          _ -> False
        }
        //
        and {
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
          // token name needs to be in the datum
          pointer == token_name,
          // bid must be locked for at least minimum_bid_lock
          lock_is_valid,
        }
      }
      // single token burn here
      LeaveBidBurn(tkn) -> ( mint |> assets.flatten ) == [(policy_id, tkn, -1)]
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
          let  
              Transaction {
                inputs,
                outputs,
                reference_inputs,
                extra_signatories,
                redeemers,
                validity_range,
                ..
              }: Transaction
            = self
          let BidDatum { owner_vkh, pointer, token, locked_until, .. } = this_datum
          expect Some(this_input): Option<Input> = inputs
            |> transaction.find_input(utxo)
          expect Script(this_script): PaymentCredential = this_input.output.address.payment_credential
          when redeemer is {
            RemoveBid -> {
              let is_holding_token: Bool = assets.has_nft(
                this_input.output.value,
                this_script,
                pointer,
              )
              if is_holding_token {
                // token must be burnt, so lets check that no output holds that token
                let burn_token: Bool = search.no_output_holds_token(
                  outputs,
                  this_script,
                  pointer,
                )
                // bid can only be removed after lock expires
                let lock_expired: Bool = when
                  validity_range.lower_bound.bound_type
                is {
                  Finite(lb) -> lb > locked_until
                  _ -> False
                }
                //
                and {
                  // owner_vkh must sign
                  has(extra_signatories, owner_vkh),
                  // must burn token
                  burn_token,
                  // lock must have expired
                  lock_expired,
                }
              } else {
                // hyperstructure escape (H-03 carried Intentional): the
                // UTxO has a valid BidDatum shape but does not hold the
                // protocol NFT, so it is junk. Returning True lets the
                // depositor recover the funds. See audit §H-03.
                True
              }
            }
            UseBid -> {
              // make sure the encrpytion is being spent
              // get encryption contract info from reference data
              let ReferenceDatum { encryption, .. }: ReferenceDatum = search.for_reference_datum(
                reference_inputs,
                genesis_pid,
                genesis_tkn,
              )
              // expect a single input if we filter all inputs for the
              // encryption script hash. H-01 fix (inlined): pin the
              // perimeter (stake_cred=None, reference_script=None) inside
              // the filter predicate so a hostile builder cannot smuggle
              // an adversarial stake_credential through. The singleton
              // assertion below means the one remaining input satisfies
              // all three predicates.
              expect  
                  [
                    Input {
                      output_reference,
                      output: Output { value: encryption_value, .. },
                    },
                  ]: List<Input>
                = inputs
                |> list.filter(
                    fn(input) {
                      and {
                        input.output.address.payment_credential == Script(
                          encryption,
                        ),
                        input.output.address.stake_credential == None,
                        input.output.reference_script == None,
                      }
                    },
                  )
              // burn this token
              let burn_token: Bool = search.no_output_holds_token(
                outputs,
                this_script,
                pointer,
              )
              // expect a single input for this payment credential, with
              // the same H-01 perimeter pinning applied.
              expect [_]: List<Input> = inputs
                |> list.filter(
                    fn(input) {
                      and {
                        input.output.address.payment_credential == Script(
                          this_script,
                        ),
                        input.output.address.stake_credential == None,
                        input.output.reference_script == None,
                      }
                    },
                  )
              expect Some(spend_redeemer): Option<Redeemer> = search.for_spend_redeemer_by_output_reference(
                redeemers,
                output_reference,
              )
              expect UseEncryption(_, _, selected_bid_token, _) = spend_redeemer
              //
              and {
                burn_token,
                assets.has_nft_strict(encryption_value, encryption, token),
                selected_bid_token == pointer,
              }
            }

            UpdateBidPrice(price) -> {
              // L-03 carried (Design Tradeoff): owner may self-drain
              // lovelace on this path — only non-ADA tokens are pinned
              // (`input_tokens == output_tokens` below). The owner is
              // signed-in, so this is owner-controlled; see audit §L-03.
              //
              // I-05 carried (Advisory): `price` is an advisory `new_price`
              // only — it is NOT bound to lovelace_of(output). Off-chain
              // UIs MUST present "bid amount" and "declared resale price"
              // separately. See audit §I-05 / lib/types/bidding.ak.
              // this pointer going back. H-01 fix (inlined).
              expect  
                  Some(Output {
                    address: Address { payment_credential, stake_credential },
                    datum: InlineDatum(output_datum_data),
                    reference_script,
                    value: output_value,
                  }): Option<Output>
                = search.for_output_by_token(outputs, this_script, pointer)
              // everything is constant but the new_price
              let expected_output_datum_data: Data = BidDatum {
                ..this_datum,
                new_price: price,
              }
              // ensure non-ADA tokens are preserved
              let input_tokens = this_input.output.value
                |> assets.without_lovelace
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
                // UpdateBidPrice path against stake-credential hijack.
                payment_credential == Script(this_script),
                stake_credential == None,
                reference_script == None,
                // force pointer to already exist
                assets.has_nft(this_input.output.value, this_script, pointer),
              }
            }
          }
        } else {
          // bad datum: hyperstructure escape — any UTxO arriving at the
          // bidding script address with a non-BidDatum shape is freely
          // sweepable. Documented intent (H-02 carried Intentional)
          // — entry can only happen by accident or external mis-deposit.
          True
        }
      // hyperstructure escape (H-02 carried Intentional): a UTxO at the
      // bidding script address with no inline datum is junk. Returning
      // True lets the depositor recover the funds.
      None -> True
    }
  }

  else(_) {
    fail
  }
}
