//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin
use aiken/crypto.{ScriptHash}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets.{AssetName}
use cardano/transaction.{Input, Output, TransactionId}

/// Constructs the token name from the transaction id and index. The token name
/// will be max length, 32 bytes.
///
/// ```aiken
/// util.construct_token_name(id, idx)
/// ```
pub fn construct_token_name(id: TransactionId, idx: Int) -> AssetName {
  id |> bytearray.push(idx) |> bytearray.slice(0, 31)
}

/// Generates a token name from a list of inputs. The head of the list determines
/// the token name. If inputs is empty then this function will fail.
///
/// ```aiken
/// util.generate_token_name(inputs)
/// ```
pub fn generate_token_name(inputs: List<Input>) -> AssetName {
  let input: Input = builtin.head_list(inputs)
  let id: TransactionId = input.output_reference.transaction_id
  let idx: Int = input.output_reference.output_index
  construct_token_name(id, idx)
}

/// Pins the address-perimeter shape of a continuing protocol Output. The
/// payment_credential MUST be the script hash, the stake_credential MUST be
/// None (preventing the H-01 stake-credential hijack), and the
/// reference_script MUST be None.
///
/// ```aiken
/// util.is_protocol_output(o, h)
/// ```
pub fn is_protocol_output(o: Output, h: ScriptHash) -> Bool {
  let Address { payment_credential, stake_credential } = o.address
  and {
    payment_credential == Script(h),
    stake_credential == None,
    o.reference_script == None,
  }
}

/// Pins the address-perimeter shape of a protocol Input being filtered. Same
/// shape as `is_protocol_output` (payment_credential = Script(h),
/// stake_credential = None, reference_script = None) so a hostile builder
/// cannot smuggle an adversarial stake_credential or attached reference
/// script through the singleton-input filters in `UseBid`.
///
/// ```aiken
/// util.is_protocol_input(i, h)
/// ```
pub fn is_protocol_input(i: Input, h: ScriptHash) -> Bool {
  is_protocol_output(i.output, h)
}
