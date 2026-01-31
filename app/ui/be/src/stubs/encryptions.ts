import type { EncryptionDisplay } from '../types/index.js';

// BLS12-381 G1 generator (compressed, 48 bytes = 96 hex chars)
const G1_GENERATOR = '97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb';

// Sample public values (would be generator^secret in real usage)
const SAMPLE_PUBLIC_1 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
const SAMPLE_PUBLIC_2 = 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1';
const SAMPLE_PUBLIC_3 = 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// Sample G2 points (compressed, 96 bytes = 192 hex chars)
const SAMPLE_G2 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

export const STUB_ENCRYPTIONS: EncryptionDisplay[] = [
  {
    tokenName: '00abc123def456789012345678901234567890123456789012345678901234',
    seller: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
    sellerPkh: '945d86e1c34b11c345e32d90a8c27c4a2e34f5678901234567890123',
    status: 'active',
    suggestedPrice: 100,
    createdAt: '2025-01-15T10:00:00Z',
    utxo: {
      txHash: 'aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '945d86e1c34b11c345e32d90a8c27c4a2e34f567',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: SAMPLE_PUBLIC_1,
      },
      token: '00abc123def456789012345678901234567890123456789012345678901234',
      half_level: {
        r1b: SAMPLE_PUBLIC_1,
        r2_g1b: SAMPLE_PUBLIC_2,
        r4b: SAMPLE_G2,
      },
      full_level: null,
      capsule: {
        nonce: 'aabbccddeeff00112233',
        aad: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        ct: 'encrypted_message_content_here_with_gcm_tag_0123456789abcdef',
      },
      status: { type: 'Open' },
    },
  },
  {
    tokenName: '01def456abc789012345678901234567890123456789012345678901234567',
    seller: 'addr_test1qpq6z3s7a9qlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yqdxyrt',
    sellerPkh: '006a1214ff4a07de150060b802930df8501720b829bf8501720b8f50',
    status: 'active',
    suggestedPrice: 250,
    createdAt: '2025-01-16T14:30:00Z',
    utxo: {
      txHash: 'bbccddee22334455667788990011aabbccddee22334455667788990011aabbcc',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '006a1214ff4a07de150060b802930df85017',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: SAMPLE_PUBLIC_2,
      },
      token: '01def456abc789012345678901234567890123456789012345678901234567',
      half_level: {
        r1b: SAMPLE_PUBLIC_2,
        r2_g1b: SAMPLE_PUBLIC_3,
        r4b: SAMPLE_G2,
      },
      full_level: null,
      capsule: {
        nonce: 'bbccddeeff001122',
        aad: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        ct: 'another_encrypted_message_with_different_content_and_tag_here',
      },
      status: { type: 'Open' },
    },
  },
  {
    tokenName: '02ghi789jkl012345678901234567890123456789012345678901234567890',
    seller: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
    sellerPkh: '945d86e1c34b11c345e32d90a8c27c4a2e34f5678901234567890123',
    status: 'pending',
    suggestedPrice: 500,
    createdAt: '2025-01-17T09:15:00Z',
    utxo: {
      txHash: 'ccddeeff33445566778899001122aabbccddeeff33445566778899001122aabb',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '945d86e1c34b11c345e32d90a8c27c4a2e34f567',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: SAMPLE_PUBLIC_1,
      },
      token: '02ghi789jkl012345678901234567890123456789012345678901234567890',
      half_level: {
        r1b: SAMPLE_PUBLIC_3,
        r2_g1b: SAMPLE_PUBLIC_1,
        r4b: SAMPLE_G2,
      },
      full_level: {
        r1b: SAMPLE_PUBLIC_3,
        r2_g1b: SAMPLE_PUBLIC_1,
        r2_g2b: SAMPLE_G2,
        r4b: SAMPLE_G2,
      },
      capsule: {
        nonce: 'ccddeeff00112233',
        aad: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ct: 'high_value_secret_data_encrypted_with_strong_key_and_auth_tag',
      },
      status: {
        type: 'Pending',
        groth_public: Array(36).fill(0).map((_, i) => i * 12345),
        ttl: Date.now() + 20 * 60 * 1000, // 20 minutes from now
      },
    },
  },
  {
    tokenName: '03mno012pqr345678901234567890123456789012345678901234567890123',
    seller: 'addr_test1qrxhyr2flena4ams5pcx26n0yj4ttpmjq2tmuesu4waw8n0qkvxuy9e4kdpz0s7r67jr8pjl9q6ezm2jgg247y9q3zpqxga37s',
    sellerPkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee40297be6619571d71e7',
    status: 'active',
    suggestedPrice: 75,
    createdAt: '2025-01-18T16:45:00Z',
    utxo: {
      txHash: 'ddeeff0044556677889900112233aabbccddeeff0044556677889900112233aa',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee402',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: SAMPLE_PUBLIC_3,
      },
      token: '03mno012pqr345678901234567890123456789012345678901234567890123',
      half_level: {
        r1b: SAMPLE_PUBLIC_1,
        r2_g1b: SAMPLE_PUBLIC_2,
        r4b: SAMPLE_G2,
      },
      full_level: null,
      capsule: {
        nonce: 'ddeeff0011223344',
        aad: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ct: 'budget_friendly_secret_still_encrypted_securely_with_proper_tag',
      },
      status: { type: 'Open' },
    },
  },
  {
    tokenName: '04stu345vwx678901234567890123456789012345678901234567890123456',
    seller: 'addr_test1qpq6z3s7a9qlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yxlhs4qcghs9yqdxyrt',
    sellerPkh: '006a1214ff4a07de150060b802930df8501720b829bf8501720b8f50',
    status: 'active',
    suggestedPrice: 1000,
    createdAt: '2025-01-19T11:20:00Z',
    utxo: {
      txHash: 'eeff001155667788990011223344aabbccddeeff001155667788990011223344',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '006a1214ff4a07de150060b802930df85017',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: SAMPLE_PUBLIC_2,
      },
      token: '04stu345vwx678901234567890123456789012345678901234567890123456',
      half_level: {
        r1b: SAMPLE_PUBLIC_2,
        r2_g1b: SAMPLE_PUBLIC_3,
        r4b: SAMPLE_G2,
      },
      full_level: null,
      capsule: {
        nonce: 'eeff001122334455',
        aad: '9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        ct: 'premium_tier_encrypted_data_with_maximum_security_and_value_tag',
      },
      status: { type: 'Open' },
    },
  },
];
