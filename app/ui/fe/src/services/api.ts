// API client for Peace Protocol backend

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Types matching backend response structure
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

// Encryption types
export interface Register {
  generator: string;
  public_value: string;
}

export interface Capsule {
  nonce: string;
  aad: string;
  ct: string;
}

export interface HalfEncryptionLevel {
  r1b: string;
  r2_g1b: string;
  r4b: string;
}

export interface FullEncryptionLevel {
  r1b: string;
  r2_g1b: string;
  r2_g2b: string;
  r4b: string;
}

export type EncryptionStatus =
  | { type: 'Open' }
  | { type: 'Pending'; groth_public: number[]; ttl: number };

export interface EncryptionDatum {
  owner_vkh: string;
  owner_g1: Register;
  token: string;
  half_level: HalfEncryptionLevel;
  full_level: FullEncryptionLevel | null;
  capsule: Capsule;
  status: EncryptionStatus;
}

// CIP-20 metadata parsed from transaction (key 674)
export interface Cip20Metadata {
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
}

export interface EncryptionDisplay {
  tokenName: string;
  seller: string;
  sellerPkh: string;
  status: 'active' | 'pending' | 'completed';
  // CIP-20 metadata fields (from tx metadata key 674)
  description?: string;
  suggestedPrice?: number;
  storageLayer?: string;
  createdAt: string;
  utxo: {
    txHash: string;
    outputIndex: number;
  };
  datum: EncryptionDatum;
}

// Bid types
export interface BidDatum {
  owner_vkh: string;
  owner_g1: Register;
  pointer: string;
  token: string;
}

export interface BidDisplay {
  tokenName: string;
  bidder: string;
  bidderPkh: string;
  encryptionToken: string;
  amount: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  createdAt: string;
  utxo: {
    txHash: string;
    outputIndex: number;
  };
  datum: BidDatum;
}

// Protocol types
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

// Generic fetch wrapper
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: { code: 'UNKNOWN', message: response.statusText },
    }));
    throw new Error(errorData.error?.message || 'API request failed');
  }

  return response.json();
}

// Encryption API
export const encryptionsApi = {
  /**
   * Get all encryptions
   */
  async getAll(): Promise<EncryptionDisplay[]> {
    const response = await apiFetch<ApiResponse<EncryptionDisplay[]>>('/api/encryptions');
    return response.data;
  },

  /**
   * Get encryption by token name
   */
  async getByToken(tokenName: string): Promise<EncryptionDisplay> {
    const response = await apiFetch<ApiResponse<EncryptionDisplay>>(`/api/encryptions/${tokenName}`);
    return response.data;
  },

  /**
   * Get encryptions by user payment key hash
   */
  async getByUser(pkh: string): Promise<EncryptionDisplay[]> {
    const response = await apiFetch<ApiResponse<EncryptionDisplay[]>>(`/api/encryptions/user/${pkh}`);
    return response.data;
  },

  /**
   * Get encryptions by status
   */
  async getByStatus(status: 'active' | 'pending' | 'completed'): Promise<EncryptionDisplay[]> {
    const response = await apiFetch<ApiResponse<EncryptionDisplay[]>>(`/api/encryptions/status/${status}`);
    return response.data;
  },
};

// Bids API
export const bidsApi = {
  /**
   * Get all bids
   */
  async getAll(): Promise<BidDisplay[]> {
    const response = await apiFetch<ApiResponse<BidDisplay[]>>('/api/bids');
    return response.data;
  },

  /**
   * Get bid by token name
   */
  async getByToken(tokenName: string): Promise<BidDisplay> {
    const response = await apiFetch<ApiResponse<BidDisplay>>(`/api/bids/${tokenName}`);
    return response.data;
  },

  /**
   * Get bids by user payment key hash
   */
  async getByUser(pkh: string): Promise<BidDisplay[]> {
    const response = await apiFetch<ApiResponse<BidDisplay[]>>(`/api/bids/user/${pkh}`);
    return response.data;
  },

  /**
   * Get bids for a specific encryption
   */
  async getByEncryption(encryptionToken: string): Promise<BidDisplay[]> {
    const response = await apiFetch<ApiResponse<BidDisplay[]>>(`/api/bids/encryption/${encryptionToken}`);
    return response.data;
  },

  /**
   * Get bids by status
   */
  async getByStatus(status: 'pending' | 'accepted' | 'rejected' | 'cancelled'): Promise<BidDisplay[]> {
    const response = await apiFetch<ApiResponse<BidDisplay[]>>(`/api/bids/status/${status}`);
    return response.data;
  },
};

// Protocol API
export const protocolApi = {
  /**
   * Get protocol configuration
   */
  async getConfig(): Promise<ProtocolConfig> {
    const response = await apiFetch<ApiResponse<ProtocolConfig>>('/api/protocol/config');
    return response.data;
  },

  /**
   * Get reference script UTxOs
   */
  async getReferenceScripts(): Promise<ProtocolConfig['referenceScripts']> {
    const response = await apiFetch<ApiResponse<ProtocolConfig['referenceScripts']>>('/api/protocol/reference');
    return response.data;
  },

  /**
   * Get script addresses and policy IDs
   */
  async getScripts(): Promise<{
    encryption: { address: string; policyId: string };
    bidding: { address: string; policyId: string };
  }> {
    const response = await apiFetch<ApiResponse<{
      encryption: { address: string; policyId: string };
      bidding: { address: string; policyId: string };
    }>>('/api/protocol/scripts');
    return response.data;
  },

  /**
   * Get protocol parameters
   */
  async getParams(): Promise<unknown> {
    const response = await apiFetch<ApiResponse<unknown>>('/api/protocol/params');
    return response.data;
  },
};

// Health check
export async function checkHealth(): Promise<{
  status: string;
  network: string;
  useStubs: boolean;
  timestamp: string;
}> {
  return apiFetch('/health');
}
