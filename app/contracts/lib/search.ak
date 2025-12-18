use aiken/collection/list
use aiken/collection/pairs
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Redeemer, ScriptPurpose, Spend,
}
use types/reference.{ReferenceDatum}

/// Find the first occurrence of an output with a value that contains a specific
/// token. The token amount does not matter here, it just needs to have at least one.
///
/// ```aiken
/// search.for_output_by_token(outputs, pid, tkn)
/// ```
pub fn for_output_by_token(
  outputs: List<Output>,
  pid: PolicyId,
  tkn: AssetName,
) -> Option<Output> {
  list.find(
    outputs,
    fn(Output { value, .. }) { assets.has_nft_strict(value, pid, tkn) },
  )
}

/// Find the first occurance of an input with a value that contains a specific
/// token. The token amount does not matter here, it just needs to at least one.
///
/// ```aiken
/// search.for_input_by_token(inputs, pid, tkn)
/// ```
pub fn for_input_by_token(
  inputs: List<Input>,
  pid: PolicyId,
  tkn: AssetName,
) -> Option<Input> {
  list.find(
    inputs,
    fn(Input { output: Output { value, .. }, .. }) {
      assets.has_nft_strict(value, pid, tkn)
    },
  )
}

/// Proves that some input has the genesis policy id and token name then
/// attempts to return the datum on that utxo as a ReferenceDatum.
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

/// We need to find a redeemer by output reference.
///
/// ```aiken
/// search.for_spend_redeemer_by_output_reference(redeemers, output_reference)
/// ```
pub fn for_spend_redeemer_by_output_reference(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  output_reference: OutputReference,
) -> Option<Redeemer> {
  pairs.get_first(redeemers, Spend(output_reference))
}
