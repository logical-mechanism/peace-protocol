//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, Value}
use cardano/transaction.{
  Datum, InlineDatum, Input, Mint, NoDatum, Output, OutputReference, Redeemer,
  ScriptPurpose, Spend,
}
use search
use types/groth.{SnarkVerificationKey}
use types/reference.{ReferenceDatum}

/// ------------------------------------------------------------
/// Shared helpers (keep in this test file for reuse)
/// ------------------------------------------------------------
const genesis_pid: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

const genesis_tkn: AssetName = #"67656e65736973"

const other_tkn: AssetName = #"6f74686572"

const tx_id: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

fn mk_addr() -> Address {
  address.from_script(genesis_pid)
}

fn mk_value_with_genesis_nft() -> Value {
  assets.from_lovelace(2)
    |> assets.add(genesis_pid, genesis_tkn, 1)
}

fn mk_output(value: Value, datum: Datum) -> Output {
  Output { address: mk_addr(), value, datum, reference_script: None }
}

fn mk_input(output_index: Int, output: Output) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: tx_id, output_index },
    output,
  }
}

fn mk_output_reference(output_index: Int) -> OutputReference {
  OutputReference { transaction_id: tx_id, output_index }
}

fn mk_test_vk() -> SnarkVerificationKey {
  SnarkVerificationKey {
    nPublic: 1,
    vkAlpha: #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
    vkBeta: #"93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8",
    vkGamma: #"93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8",
    vkDelta: #"93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8",
    vkIC: [],
    commitmentKeys: [],
  }
}

/// ------------------------------------------------------------
/// Tests: for_output_by_token
/// ------------------------------------------------------------
test for_output_by_token__empty_list_returns_none() {
  expect None = search.for_output_by_token([], genesis_pid, genesis_tkn)
}

test for_output_by_token__finds_first_match_in_order() {
  let o0 = mk_output(assets.from_lovelace(2), NoDatum)

  let o1 = mk_output(mk_value_with_genesis_nft(), InlineDatum(1))

  let o2 = mk_output(mk_value_with_genesis_nft(), InlineDatum(2))

  let result =
    search.for_output_by_token([o0, o1, o2], genesis_pid, genesis_tkn)

  expect Some(Output { datum, .. }) = result
  datum == InlineDatum(1)
}

test for_output_by_token__strict_rejects_extra_tokens() {
  let value_bad =
    mk_value_with_genesis_nft()
      |> assets.add(genesis_pid, other_tkn, 1)

  let o = mk_output(value_bad, NoDatum)

  expect None = search.for_output_by_token([o], genesis_pid, genesis_tkn)
}

/// ------------------------------------------------------------
/// Tests: for_input_by_token
/// ------------------------------------------------------------
test for_input_by_token__empty_list_returns_none() {
  expect None = search.for_input_by_token([], genesis_pid, genesis_tkn)
}

test for_input_by_token__finds_first_match_in_order() {
  let i0 = mk_input(0, mk_output(assets.from_lovelace(2), NoDatum))

  let i1 = mk_input(1, mk_output(mk_value_with_genesis_nft(), InlineDatum(42)))

  let i2 = mk_input(2, mk_output(mk_value_with_genesis_nft(), InlineDatum(99)))

  let result = search.for_input_by_token([i0, i1, i2], genesis_pid, genesis_tkn)

  expect Some(Input {
    output_reference: OutputReference { output_index, .. },
    ..
  }) = result
  output_index == 1
}

test for_input_by_token__strict_rejects_extra_tokens() {
  let value_bad =
    mk_value_with_genesis_nft()
      |> assets.add(genesis_pid, other_tkn, 1)

  let i = mk_input(0, mk_output(value_bad, NoDatum))

  expect None = search.for_input_by_token([i], genesis_pid, genesis_tkn)
}

/// ------------------------------------------------------------
/// Tests: for_reference_datum
/// ------------------------------------------------------------
test for_reference_datum__returns_reference_datum_on_happy_path() {
  let expected: ReferenceDatum =
    ReferenceDatum {
      reference: #"11111111111111111111111111111111111111111111111111111111",
      encryption: #"22222222222222222222222222222222222222222222222222222222",
      bid: #"33333333333333333333333333333333333333333333333333333333",
      groth: #"44444444444444444444444444444444444444444444444444444444",
      snark_vk: mk_test_vk(),
    }

  let datum_data: Data = expected

  let ref_input =
    mk_input(0, mk_output(mk_value_with_genesis_nft(), InlineDatum(datum_data)))

  let got = search.for_reference_datum([ref_input], genesis_pid, genesis_tkn)

  got == expected
}

test for_reference_datum__fails_when_token_missing() fail {
  let ref_input = mk_input(0, mk_output(assets.from_lovelace(2), NoDatum))

  expect _got =
    search.for_reference_datum([ref_input], genesis_pid, genesis_tkn)
}

test for_reference_datum__fails_when_datum_not_inline() fail {
  let ref_input = mk_input(0, mk_output(mk_value_with_genesis_nft(), NoDatum))

  expect _got =
    search.for_reference_datum([ref_input], genesis_pid, genesis_tkn)
}

test for_reference_datum__fails_when_inline_datum_wrong_shape() fail {
  let ref_input =
    mk_input(0, mk_output(mk_value_with_genesis_nft(), InlineDatum(42)))

  expect _got =
    search.for_reference_datum([ref_input], genesis_pid, genesis_tkn)
}

/// ------------------------------------------------------------
/// Tests: for_spend_redeemer_by_output_reference
/// ------------------------------------------------------------
test for_spend_redeemer_by_output_reference__empty_returns_none() {
  expect None =
    search.for_spend_redeemer_by_output_reference([], mk_output_reference(0))
}

test for_spend_redeemer_by_output_reference__no_match_returns_none() {
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Mint(genesis_pid), builtin.i_data(0)),
      // different purpose
      Pair(Spend(mk_output_reference(1)), builtin.i_data(1)),
    ]

  // spend, but different output ref
  expect None =
    search.for_spend_redeemer_by_output_reference(
      redeemers,
      mk_output_reference(0),
    )
}

test for_spend_redeemer_by_output_reference__returns_some_on_match() {
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Mint(genesis_pid), builtin.i_data(0)),
      Pair(Spend(mk_output_reference(0)), builtin.i_data(42)),
      Pair(Spend(mk_output_reference(1)), builtin.i_data(99)),
    ]

  expect Some(d) =
    search.for_spend_redeemer_by_output_reference(
      redeemers,
      mk_output_reference(0),
    )
  d == builtin.i_data(42)
}

test for_spend_redeemer_by_output_reference__returns_first_when_duplicates_exist() {
  let redeemers: Pairs<ScriptPurpose, Redeemer> =
    [
      Pair(Spend(mk_output_reference(0)), builtin.i_data(1)),
      Pair(Spend(mk_output_reference(0)), builtin.i_data(2)),
      Pair(Spend(mk_output_reference(0)), builtin.i_data(3)),
    ]

  // should return the *first* match
  expect Some(d) =
    search.for_spend_redeemer_by_output_reference(
      redeemers,
      mk_output_reference(0),
    )
  d == builtin.i_data(1)
}
