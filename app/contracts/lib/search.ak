//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use cardano/assets.{AssetName, PolicyId}
use aiken/crypto.{ScriptHash}
use cardano/address.{Script}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
  Withdraw,
}
use types/reference.{ReferenceDatum}

fn get_first(self: Pairs<k, v>, key: k) -> Option<v> {
  when self is {
    [] -> None
    [Pair(k, v), ..rest] ->
      if k == key {
        Some(v)
      } else {
        get_first(rest, key)
      }
  }
}

/// Find the first occurrence of an output with a value that contains a specific
/// token. The token amount is strict.
///
/// ```aiken
/// search.for_output_by_token(outputs, pid, tkn)
/// ```
pub fn for_output_by_token(
  outputs: List<Output>,
  pid: PolicyId,
  tkn: AssetName,
) -> Option<Output> {
  when outputs is {
    [] -> None
    [output, ..rest] ->
      if assets.has_nft_strict(output.value, pid, tkn) {
        Some(output)
      } else {
        for_output_by_token(rest, pid, tkn)
      }
  }
}

/// Find the first occurance of an input with a value that contains a specific
/// token. The token amount is strict.
///
/// ```aiken
/// search.for_input_by_token(inputs, pid, tkn)
/// ```
pub fn for_input_by_token(
  inputs: List<Input>,
  pid: PolicyId,
  tkn: AssetName,
) -> Option<Input> {
  when inputs is {
    [] -> None
    [input, ..rest] ->
      if assets.has_nft_strict(input.output.value, pid, tkn) {
        Some(input)
      } else {
        for_input_by_token(rest, pid, tkn)
      }
  }
}

/// Proves that some input has the genesis policy id and token name then
/// attempts to return the datum on that utxo as a ReferenceDatum. This
/// function failing is the expected behavior.
///
/// ```aiken
/// search.for_reference_datum(inputs, pid, tkn)
/// ```
pub fn for_reference_datum(
  reference_inputs: List<Input>,
  genesis_pid: PolicyId,
  genesis_tkn: AssetName,
) -> ReferenceDatum {
  expect Some(Input {
    output: Output { datum: InlineDatum(reference_datum_data), .. },
    ..
  }): Option<Input> =
    for_input_by_token(reference_inputs, genesis_pid, genesis_tkn)
  expect reference_datum: ReferenceDatum = reference_datum_data
  reference_datum
}

/// We need to find the first redeemer by searching for a spend output reference.
///
/// ```aiken
/// search.for_spend_redeemer_by_output_reference(redeemers, output_reference)
/// ```
pub fn for_spend_redeemer_by_output_reference(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  output_reference: OutputReference,
) -> Option<Redeemer> {
  get_first(redeemers, Spend(output_reference))
}

/// Find the withdraw redeemer for a given script hash.
///
/// ```aiken
/// search.for_withdraw_redeemer_by_script_hash(redeemers, script_hash)
/// ```
pub fn for_withdraw_redeemer_by_script_hash(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  script_hash: ScriptHash,
) -> Option<Redeemer> {
  get_first(redeemers, Withdraw(Script(script_hash)))
}
