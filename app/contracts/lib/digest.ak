//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto

/// The hash function used in the protocol. Change as needed in production.
///
/// ```aiken
/// digest.hash(msg)
/// ```
pub fn hash(msg: ByteArray) -> ByteArray {
  crypto.blake2b_224(msg)
}
