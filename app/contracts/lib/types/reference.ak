//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{ScriptHash}
use types/groth.{SnarkVerificationKey}

pub type ReferenceDatum {
  reference: ScriptHash,
  encryption: ScriptHash,
  bid: ScriptHash,
  groth: ScriptHash,
  snark_vk: SnarkVerificationKey,
}
