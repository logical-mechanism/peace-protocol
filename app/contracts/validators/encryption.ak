////
////

use aiken/collection/list
use aiken/option
use cardano/address.{Address, PaymentCredential, Script}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, Transaction,
}
use search
use types/bidding.{BidDatum, UseBid}
use types/encryption.{
  EncryptionDatum, EncryptionMintRedeemer, EncryptionSpendRedeemer,
  EntryEncryptionMint, LeaveEncryptionBurn, RemoveEncryption, UseEncryption,
}
use types/level.{EncryptionLevel}
use types/reference.{ReferenceDatum}
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
        // find the output that holds the token being minted
        expect Some(Output {
          address: Address { payment_credential, .. },
          datum: InlineDatum(output_datum_data),
          reference_script,
          ..
        }): Option<Output> =
          search.for_output_by_token(outputs, policy_id, token_name)
        // encryption datum needs to be validated so destruct it
        expect EncryptionDatum { owner_vkh, owner_g1, token, levels, .. }: EncryptionDatum =
          output_datum_data
        expect [entry]: List<EncryptionLevel> = levels
        //
        //
        //
        and {
          // token name needs to be in the datum
          (token == token_name)?,
          // script output can not have a reference script
          option.is_none(reference_script)?,
          // must be going to the encryption contract
          (Script(policy_id) == payment_credential)?,
          // a single token should be minted in this transaction
          assets.has_nft_strict(mint, policy_id, token_name)?,
          // owner_vkh must sign
          list.has(extra_signatories, owner_vkh)?,
          // owner g1 point must be known
          schnorr.verify(owner_g1, schnorr_proof)?,
          // must be valid level 1
          level.verify_level_one(token_name, entry)?,
          // must be using original owner
          schnorr.binding_verify(
            owner_g1,
            binding_proof,
            entry.r1b,
            entry.r2.g1b,
            token_name,
          )?,
        }
      }
      // 
      // single token burn here
      LeaveEncryptionBurn(tkn) ->
        (( mint |> assets.flatten ) == [(policy_id, tkn, -1)])?
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
            ..
          }: Transaction = self
          let EncryptionDatum { owner_vkh, owner_g1, token, levels, capsule } =
            this_datum
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
                  list.all(
                    outputs,
                    fn(output) {
                      assets.quantity_of(output.value, this_script, token) == 0
                    },
                  )
                //
                // Burn the token and get a signature from the keeper.
                //
                // This assumes the owner vkh is wellformed.
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
                levels: next_levels,
                capsule: next_capsule,
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
                token: bid_token,
                ..
              }: BidDatum = bidding_datum_data
              //
              //
              //
              and {
                // cipher text can not change
                (capsule == next_capsule)?,
                // bid owner is new owner
                (bid_owner_vkh == next_owner_vkh)?,
                // bid owner is new owner
                (bid_owner_g1 == next_owner_g1)?,
                // this token can not chnage
                (token == next_token)?,
                // the selected bid token is the bid token
                (bid_token == selected_bid_token)?,
                // check if correct script hashes
                (Script(this_script) == payment_credential)?,
                (Script(bid) == bid_payment_credential)?,
                // script output can not have a reference script
                option.is_none(reference_script)?,
                // consistency check; expand here for better r5 validation
                level.verify_r5(owner_g1, r5, witness)?,
                // correct level addition
                level.add_new_level(
                  levels,
                  next_levels,
                  r5,
                  token,
                  bid_owner_g1,
                  binding_proof,
                )?,
                // owner_vkh must sign
                list.has(extra_signatories, owner_vkh)?,
                // force token to already exist
                assets.has_nft(this_input.output.value, this_script, token)?,
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
