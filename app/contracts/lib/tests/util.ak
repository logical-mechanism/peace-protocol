//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/primitive/bytearray
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, TransactionId}
use util

/// ------------------------------------------------------------
/// Shared helpers (keep in this test file for reuse)
/// ------------------------------------------------------------
const dummy_pid: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

fn mk_addr() -> Address {
  address.from_script(dummy_pid)
}

fn mk_output() -> Output {
  Output {
    address: mk_addr(),
    value: assets.from_lovelace(2),
    datum: NoDatum,
    reference_script: None,
  }
}

fn mk_input(id: TransactionId, idx: Int) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: id, output_index: idx },
    output: mk_output(),
  }
}

/// A 32-byte "transaction id" we can reason about: 00..1f
const id_seq_00_1f: TransactionId =
  #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

/// A different 32-byte id: ff..ff
const id_ff: TransactionId =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

/// ------------------------------------------------------------
/// Tests: construct_token_name
/// ------------------------------------------------------------
test construct_token_name__prepends_index_and_truncates_to_32_bytes() {
  let got = util.construct_token_name(id_seq_00_1f, 5)

  // push puts the byte in front; slice(0,31) keeps 32 bytes total.
  let expected: AssetName =
    #"05000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e"

  got == expected && bytearray.length(got) == 32
}

test construct_token_name__index_zero_still_32_bytes() {
  let got = util.construct_token_name(id_seq_00_1f, 0)

  let expected: AssetName =
    #"00000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e"

  got == expected && bytearray.length(got) == 32
}

// In PlutusV3, bytearray.push fails if the byte is > 255. :contentReference[oaicite:0]{index=0}
test construct_token_name__fails_when_idx_out_of_byte_range() fail {
  expect _tkn = util.construct_token_name(id_seq_00_1f, 256)
}

/// ------------------------------------------------------------
/// Tests: generate_token_name
/// ------------------------------------------------------------
test generate_token_name__uses_head_input_only() {
  let i0 = mk_input(id_seq_00_1f, 7)
  let i1 = mk_input(id_ff, 9)

  let got = util.generate_token_name([i0, i1])

  let expected = util.construct_token_name(id_seq_00_1f, 7)

  got == expected
}

test generate_token_name__fails_on_empty_inputs() fail {
  expect _tkn = util.generate_token_name([])
}

// max valid index (255) should still produce 32 bytes
test construct_token_name__max_index_255() {
  let got = util.construct_token_name(id_seq_00_1f, 255)

  let expected: AssetName =
    #"ff000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e"

  got == expected && bytearray.length(got) == 32
}

// different tx ids produce different token names (uniqueness)
test construct_token_name__different_ids_different_names() {
  let tkn1 = util.construct_token_name(id_seq_00_1f, 0)
  let tkn2 = util.construct_token_name(id_ff, 0)

  tkn1 != tkn2
}

// same tx id but different index produces different names
test construct_token_name__different_idx_different_names() {
  let tkn1 = util.construct_token_name(id_seq_00_1f, 0)
  let tkn2 = util.construct_token_name(id_seq_00_1f, 1)

  tkn1 != tkn2
}

// generate_token_name with a single input should work
test generate_token_name__single_input() {
  let i0 = mk_input(id_ff, 3)

  let got = util.generate_token_name([i0])

  let expected = util.construct_token_name(id_ff, 3)

  got == expected
}

// negative index should fail (bytearray.push rejects negative)
test construct_token_name__fails_when_idx_negative() fail {
  expect _tkn = util.construct_token_name(id_seq_00_1f, -1)
}
