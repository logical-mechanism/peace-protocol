//// Copyright (C) 2025 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName}
use types/groth.{GrothPublic}
use types/level.{FullEncryptionLevel, HalfEncryptionLevel}
use types/register.{Register}
use types/schnorr.{BindingProof, SchnorrProof}

// six hours
pub const pending_ttl: Int = 1000 * 60 * 60 * 6

// one hour
pub const snark_validity_window: Int = 1000 * 60 * 60

pub type Capsule {
  nonce: ByteArray,
  aad: ByteArray,
  ct: ByteArray,
}

pub type Status {
  Open
  Pending(GrothPublic, Int)
}

pub type EncryptionDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  token: AssetName,
  half_level: HalfEncryptionLevel,
  full_level: Option<FullEncryptionLevel>,
  capsule: Capsule,
  status: Status,
}

pub type EncryptionMintRedeemer {
  EntryEncryptionMint(SchnorrProof, BindingProof)
  LeaveEncryptionBurn(AssetName)
}

pub type EncryptionSpendRedeemer {
  RemoveEncryption
  // R5 witness, R5, bid token, binding proof
  UseEncryption(ByteArray, ByteArray, AssetName, BindingProof)
  // groth proof and public come from groth_witness withdraw redeemer
  UseSnark
  CancelEncryption
}
