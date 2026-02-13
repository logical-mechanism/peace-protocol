/**
 * Crypto Services
 *
 * Re-exports all cryptographic functionality for easy importing.
 */

// BLS12-381 operations
export {
  CURVE_ORDER,
  rng,
  g1Point,
  g2Point,
  uncompressG1,
  uncompressG2,
  compressG1,
  compressG2,
  scaleG1,
  scaleG2,
  scale,
  invertG1,
  invertG2,
  combineG1,
  combineG2,
  combine,
  toInt,
  fromInt,
  hexToBytes,
  bytesToHex,
  G1_IDENTITY,
  G2_IDENTITY,
  G1_GENERATOR,
  G2_GENERATOR,
} from './bls12381';

// Hashing
export { generate, hashString, hashBytes } from './hashing';

// Constants
export {
  KEY_DOMAIN_TAG,
  F12_DOMAIN_TAG,
  SLT_DOMAIN_TAG,
  KEM_DOMAIN_TAG,
  AAD_DOMAIN_TAG,
  MSG_DOMAIN_TAG,
  SCH_DOMAIN_TAG,
  BND_DOMAIN_TAG,
  H2I_DOMAIN_TAG,
  H0,
  H1,
  H2,
  H3,
} from './constants';

// Register
export {
  createRegister,
  createPublicRegister,
  scaleRegister,
  registerToPlutusJson,
} from './register';
export type { Register } from './register';

// Schnorr proofs
export { schnorrProof, schnorrToPlutusJson, fiatShamirHeuristic } from './schnorr';
export type { SchnorrProof } from './schnorr';

// Binding proofs
export {
  bindingProof,
  bindingToPlutusJson,
  fiatShamirHeuristic as bindingFiatShamir,
} from './binding';
export type { BindingProof } from './binding';

// ECIES encryption
export { encrypt, decrypt, capsuleToPlutusJson } from './ecies';
export type { Capsule } from './ecies';

// Standardized payload (CBOR)
export { buildPayload, parsePayload, buildPayloadHex, parsePayloadHex } from './payload';
export type { PayloadFields } from './payload';

// Encryption levels
export {
  halfLevelToPlutusJson,
  fullLevelToPlutusJson,
  emptyFullLevelToPlutusJson,
} from './level';
export type { HalfLevel, FullLevel } from './level';

// Create encryption
export {
  createEncryptionArtifacts,
  createEncryptionWithWallet,
  deriveUserSecret,
  isRealEncryptionAvailable,
  getStubWarning,
  getSigningExplanation,
} from './createEncryption';
export type { CreateEncryptionResult } from './createEncryption';

// Wallet secret derivation
export {
  deriveSecretFromWallet,
  buildKeyDerivationMessage,
  supportsSignData,
  getSigningExplanation as getWalletSigningExplanation,
} from './walletSecret';

// Create bid
export {
  createBidArtifacts,
  createBidArtifactsFromWallet,
  getBidCryptoExplanation,
  verifyBidArtifacts,
} from './createBid';
export type { BidArtifacts } from './createBid';

// Decryption
export {
  decryptBid,
  canDecrypt,
  fetchEncryptionHistory,
  computeKEM,
  isStubMode,
  getDecryptionExplanation,
} from './decrypt';
export type { DecryptionResult, EncryptionLevel, EncryptionHistory } from './decrypt';
