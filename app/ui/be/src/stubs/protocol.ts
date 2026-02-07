import type { ProtocolConfig } from '../types/index.js';

export const STUB_PROTOCOL_CONFIG: ProtocolConfig = {
  network: 'preprod',
  contracts: {
    // These would be real addresses after deployment
    encryptionAddress: 'addr_test1wz5v5upckm7znfgljtdy7j28dp0fjncm50cqpt93lz9hysgzzl4d6',
    biddingAddress: 'addr_test1wrfg5r47dgqkm7znfgljtdy7j28dp0fjncm50cqpt93lz9hykq4x3',
    referenceAddress: 'addr_test1wrh72ullu9qu064yvs5gtdhdkcdl9tkeekkmy227zgvw5pc99mgsw',
    encryptionPolicyId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    biddingPolicyId: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
  },
  referenceScripts: {
    // Reference script UTxOs - would be real after deployment
    encryption: {
      txHash: 'aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd',
      outputIndex: 1,
    },
    bidding: {
      txHash: 'bbccddee22334455667788990011aabbccddee22334455667788990011aabbcc',
      outputIndex: 1,
    },
    groth: {
      txHash: 'ccddeeff33445566778899001122aabbccddeeff33445566778899001122aabb',
      outputIndex: 1,
    },
  },
  genesisToken: {
    policyId: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    tokenName: '67656e65736973', // "genesis" in hex
  },
};
