//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////
//// Baseline benchmarks for util-level helpers.
////
//// These helpers are called from every output-emitting redeemer
//// (is_protocol_output / is_protocol_input gate every continuing
//// output across encryption.ak and bidding.ak; construct_token_name
//// is called by genesis and every entry mint). Establishing a
//// baseline cost here lets future optimization claims quote a
//// before/after delta.

use aiken/fuzz
use cardano/address.{Address, Inline, Script, VerificationKey}
use cardano/assets.{from_lovelace}
use cardano/transaction.{NoDatum, Output, OutputReference, TransactionId}
use util

const dummy_pid = #"01010101010101010101010101010101010101010101010101010101"

const dummy_stake_vkh =
  #"02020202020202020202020202020202020202020202020202020202"

const dummy_tx_id: TransactionId =
  #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

fn canonical_output(_size: Int) -> Fuzzer<Output> {
  fuzz.constant(
    Output {
      address: Address {
        payment_credential: Script(dummy_pid),
        stake_credential: None,
      },
      value: from_lovelace(2),
      datum: NoDatum,
      reference_script: None,
    },
  )
}

fn adversarial_stake_output(_size: Int) -> Fuzzer<Output> {
  fuzz.constant(
    Output {
      address: Address {
        payment_credential: Script(dummy_pid),
        stake_credential: Some(Inline(VerificationKey(dummy_stake_vkh))),
      },
      value: from_lovelace(2),
      datum: NoDatum,
      reference_script: None,
    },
  )
}

bench util__is_protocol_output__canonical(o: Output via canonical_output) {
  // Hot-path baseline: the canonical (accept) branch.
  util.is_protocol_output(o, dummy_pid)
}

bench util__is_protocol_output__rejects_adversarial_stake(
  o: Output via adversarial_stake_output,
) {
  // Hot-path baseline: the reject branch (H-01 attack).
  util.is_protocol_output(o, dummy_pid)
}

fn const_idx(_size: Int) -> Fuzzer<Int> {
  fuzz.constant(7)
}

bench util__construct_token_name(idx: Int via const_idx) {
  // Called by every entry mint to derive the per-deployment token name.
  util.construct_token_name(dummy_tx_id, idx)
}

fn const_output_ref(_size: Int) -> Fuzzer<OutputReference> {
  fuzz.constant(
    OutputReference { transaction_id: dummy_tx_id, output_index: 0 },
  )
}

// Used as a stand-in baseline for genesis__mint__one_shot_bootstrap.
// The genesis mint validator's dominant work is constructing the token
// name and comparing the output address against the reference datum's
// derived address; both are bytewise comparisons fed by util helpers.
bench genesis__mint__one_shot_bootstrap(
  _or: OutputReference via const_output_ref,
) {
  let tkn = util.construct_token_name(dummy_tx_id, 0)
  tkn == util.construct_token_name(dummy_tx_id, 0)
}
