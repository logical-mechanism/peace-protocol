// API Response types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// Register type (BLS12-381 public key)
export interface Register {
  generator: string;      // 96 hex chars (compressed G1)
  public_value: string;   // 96 hex chars (compressed G1)
}

// Capsule type (encrypted data)
export interface Capsule {
  nonce: string;          // 24 hex chars (12 bytes)
  aad: string;            // 64 hex chars (32 bytes)
  ct: string;             // variable hex (ciphertext + tag)
}

// Encryption level types
export interface HalfEncryptionLevel {
  r1b: string;            // 96 hex chars (compressed G1)
  r2_g1b: string;         // 96 hex chars (compressed G1)
  r4b: string;            // 192 hex chars (compressed G2)
}

export interface FullEncryptionLevel {
  r1b: string;            // 96 hex chars (compressed G1)
  r2_g1b: string;         // 96 hex chars (compressed G1)
  r2_g2b: string;         // 192 hex chars (compressed G2)
  r4b: string;            // 192 hex chars (compressed G2)
}

// Status types
export type EncryptionStatus =
  | { type: 'Open' }
  | { type: 'Pending'; groth_public: number[]; ttl: number };

// On-chain encryption datum
export interface EncryptionDatum {
  owner_vkh: string;              // 28 bytes hex
  owner_g1: Register;
  token: string;                  // 32 bytes hex
  half_level: HalfEncryptionLevel;
  full_level: FullEncryptionLevel | null;
  capsule: Capsule;
  status: EncryptionStatus;
}

// On-chain bid datum
export interface BidDatum {
  owner_vkh: string;              // 28 bytes hex
  owner_g1: Register;
  pointer: string;                // encryption token this bid is for
  token: string;                  // bid token name
}

// CIP-20 metadata structure (from tx metadata key 674)
// See: https://cips.cardano.org/cip/CIP-20
export interface Cip20Metadata {
  msg: string[];  // [description, suggestedPrice, storageLayer]
}

// API display types (enriched for UI)
export interface EncryptionDisplay {
  tokenName: string;
  seller: string;                 // bech32 address
  sellerPkh: string;              // payment key hash
  status: 'active' | 'pending' | 'completed';
  // CIP-20 metadata fields (parsed from tx metadata key 674)
  description?: string;           // Human-readable description of the encrypted data
  suggestedPrice?: number;        // ADA, parsed from metadata
  storageLayer?: string;          // Storage layer info (e.g., "ipfs://...", "arweave://...")
  createdAt: string;              // ISO date
  utxo: {
    txHash: string;
    outputIndex: number;
  };
  datum: EncryptionDatum;
}

export interface BidDisplay {
  tokenName: string;
  bidder: string;                 // bech32 address
  bidderPkh: string;              // payment key hash
  encryptionToken: string;        // pointer to encryption
  amount: number;                 // lovelace
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: string;              // ISO date
  utxo: {
    txHash: string;
    outputIndex: number;
  };
  datum: BidDatum;
}

// Protocol config for frontend
export interface ProtocolConfig {
  network: 'preprod' | 'mainnet';
  contracts: {
    encryptionAddress: string;
    biddingAddress: string;
    encryptionPolicyId: string;
    biddingPolicyId: string;
  };
  referenceScripts: {
    encryption: { txHash: string; outputIndex: number } | null;
    bidding: { txHash: string; outputIndex: number } | null;
    groth: { txHash: string; outputIndex: number } | null;
  };
  genesisToken: {
    policyId: string;
    tokenName: string;
  } | null;
}
