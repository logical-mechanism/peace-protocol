//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{ScriptHash, VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{
  Address, Credential, Inline, Pointer, Referenced, Script, VerificationKey,
}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, TransactionId}
use util

/// ------------------------------------------------------------
/// Shared helpers (keep in this test file for reuse)
/// ------------------------------------------------------------
const dummy_pid: PolicyId =
  #"01010101010101010101010101010101010101010101010101010101"

const dummy_stake_vkh: VerificationKeyHash =
  #"02020202020202020202020202020202020202020202020202020202"

const dummy_stake_script: ScriptHash =
  #"03030303030303030303030303030303030303030303030303030303"

const dummy_ref_script_hash: ScriptHash =
  #"04040404040404040404040404040404040404040404040404040404"

fn mk_addr() -> Address {
  address.from_script(dummy_pid)
}

/// I-02 fixture extension: build an Address with the canonical
/// payment_credential (Script(dummy_pid)) but an arbitrary
/// stake_credential. Used to generate the four adversarial variants
/// that the H-01 validator-level tests need to exercise.
pub fn mk_addr_with_stake(stake: Option<Referenced<Credential>>) -> Address {
  Address { payment_credential: Script(dummy_pid), stake_credential: stake }
}

/// Adversarial stake-credential variants for H-01 negative testing.
///   - None                                 — canonical (post-fix accepts).
///   - Some(Inline(VerificationKey(_)))     — H-01 attack #1.
///   - Some(Inline(Script(_)))              — H-01 attack #2.
///   - Some(Pointer(_))                     — H-01 attack #3.
pub fn stake_none() -> Option<Referenced<Credential>> {
  None
}

pub fn stake_inline_vkey() -> Option<Referenced<Credential>> {
  Some(Inline(VerificationKey(dummy_stake_vkh)))
}

pub fn stake_inline_script() -> Option<Referenced<Credential>> {
  Some(Inline(Script(dummy_stake_script)))
}

pub fn stake_pointer() -> Option<Referenced<Credential>> {
  Some(Pointer { slot_number: 1, transaction_index: 2, certificate_index: 3 })
}

fn mk_output() -> Output {
  Output {
    address: mk_addr(),
    value: assets.from_lovelace(2),
    datum: NoDatum,
    reference_script: None,
  }
}

/// I-02 fixture extension: build an Output with an attached
/// reference_script. Closes the second open variant the audit Phase 7c
/// flagged — none of the existing tests could construct an Output with
/// reference_script: Some(_).
pub fn mk_output_with_ref_script(ref: Option<ScriptHash>) -> Output {
  Output {
    address: mk_addr(),
    value: assets.from_lovelace(2),
    datum: NoDatum,
    reference_script: ref,
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
