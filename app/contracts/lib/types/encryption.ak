use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName}
use types/level.{EncryptionLevel}
use types/register.{Register}
use types/schnorr.{BindingProof, SchnorrProof}

pub type EncryptionDatum {
  owner_vkh: VerificationKeyHash,
  owner_g1: Register,
  token: AssetName,
  levels: List<EncryptionLevel>,
  ciper_text: ByteArray,
}

pub type EncryptionMintRedeemer {
  EntryEncryptionMint(SchnorrProof, BindingProof)
  LeaveEncryptionBurn(AssetName)
}

pub type EncryptionSpendRedeemer {
  RemoveEncryption
  // #<Bls12_381, G1>, #<Bls12_381, G2>, Bid Token, binding proof
  UseEncryption(ByteArray, ByteArray, AssetName, BindingProof)
}
