// tests/search_token_find_test.ak
//
// Shared helpers/constants for token-search tests.
// Add more tests for other search helpers into this file over time.

use cardano/address.{Address, VerificationKey}
use cardano/assets.{AssetName, PolicyId, add, from_lovelace}
use cardano/transaction.{Input, NoDatum, Output, OutputReference}
use search

fn mk_output(value) -> Output {
  Output {
    address: Address {
      payment_credential: VerificationKey(#"01"),
      stake_credential: None,
    },
    value,
    datum: NoDatum,
    reference_script: None,
  }
}

fn mk_input(output: Output) -> Input {
  // If your Aiken/Cardano stdlib version requires different fields for Input,
  // tweak this constructor to match your project's Input type.
  Input {
    output,
    // Common field name in Aiken is `out_ref` (or similar). If your type differs,
    // update it here and all tests below remain unchanged.
    output_reference: OutputReference { transaction_id: #"00", output_index: 0 },
  }
}

const pid: PolicyId =
  #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b"

const pid2: PolicyId =
  #"1c1d1e1f202122232425262728292a2b2c2d2e2f3031323334353637"

const tkn: AssetName = "nft"

const junk: AssetName = "junk"

// -------------------------------
// for_output_by_token
// -------------------------------

test for_output_by_token__empty_list_is_none() {
  expect None = search.for_output_by_token([], pid, tkn)
  True
}

test for_output_by_token__no_match_is_none() {
  // wrong policy id
  let v0 = from_lovelace(2_000_000) |> add(pid2, tkn, 1)

  // right policy/name, but wrong (non-strict) amount
  let v1 = from_lovelace(2_000_000) |> add(pid, tkn, 2)

  // right policy/name/amount, but extra token makes it non-strict
  let v2 =
    from_lovelace(2_000_000)
      |> add(pid, tkn, 1)
      |> add(pid2, junk, 1)

  let outputs = [mk_output(v0), mk_output(v1), mk_output(v2)]

  expect None = search.for_output_by_token(outputs, pid, tkn)
  True
}

test for_output_by_token__finds_first_strict_match() {
  // looks close, but has an extra token -> not strict
  let v0 =
    from_lovelace(2_000_000)
      |> add(pid, tkn, 1)
      |> add(pid2, junk, 1)

  // first strict match
  let v1 = from_lovelace(2_000_000) |> add(pid, tkn, 1)

  // also a strict match, but later in the list (should NOT be returned)
  let v2 = from_lovelace(4_000_000) |> add(pid, tkn, 1)

  let out0 = mk_output(v0)
  let out1 = mk_output(v1)
  let out2 = mk_output(v2)

  let outputs = [out0, out1, out2]

  expect Some(_out1) = search.for_output_by_token(outputs, pid, tkn)
  True
}

// -------------------------------
// for_input_by_token
// -------------------------------

test for_input_by_token__empty_list_is_none() {
  expect None = search.for_input_by_token([], pid, tkn)
  True
}

test for_input_by_token__no_match_is_none() {
  // wrong policy id
  let v0 = from_lovelace(2_000_000) |> add(pid2, tkn, 1)

  // right policy/name, but wrong (non-strict) amount
  let v1 = from_lovelace(2_000_000) |> add(pid, tkn, 2)

  // right policy/name/amount, but extra token makes it non-strict
  let v2 =
    from_lovelace(2_000_000)
      |> add(pid, tkn, 1)
      |> add(pid2, junk, 1)

  let inputs =
    [mk_input(mk_output(v0)), mk_input(mk_output(v1)), mk_input(mk_output(v2))]

  expect None = search.for_input_by_token(inputs, pid, tkn)
  True
}

test for_input_by_token__finds_first_strict_match() {
  // looks close, but has an extra token -> not strict
  let v0 =
    from_lovelace(2_000_000)
      |> add(pid, tkn, 1)
      |> add(pid2, junk, 1)

  // first strict match
  let v1 = from_lovelace(2_000_000) |> add(pid, tkn, 1)

  // also a strict match, but later in the list
  let v2 = from_lovelace(4_000_000) |> add(pid, tkn, 1)

  let in0 = mk_input(mk_output(v0))
  let in1 = mk_input(mk_output(v1))
  let in2 = mk_input(mk_output(v2))

  let inputs = [in0, in1, in2]

  expect Some(_in1) = search.for_input_by_token(inputs, pid, tkn)
  True
}
