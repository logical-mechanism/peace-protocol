//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName}
use types/level.{FullEncryptionLevel, HalfEncryptionLevel}
use types/register.{Register}
use types/schnorr.{BindingProof, SchnorrProof}

pub type Capsule {
  nonce: ByteArray,
  aad: ByteArray,
  ct: ByteArray,
}

pub type EncryptionDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  token: AssetName,
  half_level: HalfEncryptionLevel,
  full_level: Option<FullEncryptionLevel>,
  capsule: Capsule,
}

pub type EncryptionMintRedeemer {
  EntryEncryptionMint(SchnorrProof, BindingProof)
  LeaveEncryptionBurn(AssetName)
}

pub type EncryptionSpendRedeemer {
  RemoveEncryption
  // R5 witness, R5, bid token, binding proof
  UseEncryption(ByteArray, ByteArray, AssetName, BindingProof)
}
