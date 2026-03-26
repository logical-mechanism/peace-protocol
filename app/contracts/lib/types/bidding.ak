//// Copyright (C) 2025-2026 Logical Mechanism LLC
//// SPDX-License-Identifier: GPL-3.0-only
////

use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName}
use types/register.{Register}
use types/schnorr.{SchnorrProof}

// six hours, matching pending_ttl
pub const minimum_bid_lock: Int = 1000 * 60 * 60 * 6

pub type BidDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  pointer: AssetName,
  token: AssetName,
  locked_until: Int,
  new_price: Int,
}

pub type BidMintRedeemer {
  EntryBidMint(SchnorrProof)
  LeaveBidBurn(AssetName)
}

pub type BidSpendRedeemer {
  RemoveBid
  UseBid
  UpdateBidPrice(Int)
}
