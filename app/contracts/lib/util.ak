//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/builtin
use aiken/primitive/bytearray
use cardano/assets.{AssetName}
use cardano/transaction.{Input, TransactionId}

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
