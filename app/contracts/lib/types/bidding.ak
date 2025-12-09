use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName}
use types/register.{Register}
use types/schnorr.{SchnorrProof}

pub type BidDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  pointer: AssetName,
  token: AssetName,
}

pub type BidMintRedeemer {
  EntryBidMint(SchnorrProof)
  LeaveBidBurn(AssetName)
}

pub type BidSpendRedeemer {
  RemoveBid
  UseBid
}
