import type { BidDisplay } from '../types/index.js';

// BLS12-381 G1 generator (compressed, 48 bytes = 96 hex chars)
const G1_GENERATOR = '97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb';

// Sample public values for bidders
const BIDDER_PUBLIC_1 = 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3';
const BIDDER_PUBLIC_2 = 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const BIDDER_PUBLIC_3 = 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5';

export const STUB_BIDS: BidDisplay[] = [
  {
    tokenName: '10bid001abc234567890123456789012345678901234567890123456789012',
    bidder: 'addr_test1qrxhyr2flena4ams5pcx26n0yj4ttpmjq2tmuesu4waw8n0qkvxuy9e4kdpz0s7r67jr8pjl9q6ezm2jgg247y9q3zpqxga37s',
    bidderPkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee40297be6619571d71e7',
    encryptionToken: '00abc123def456789012345678901234567890123456789012345678901234',
    amount: 120_000_000, // 120 ADA in lovelace
    status: 'pending',
    createdAt: '2025-01-16T08:30:00Z',
    utxo: {
      txHash: 'ff00112244556677889900aabbccddeeff00112244556677889900aabbccddee',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee402',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: BIDDER_PUBLIC_1,
      },
      pointer: '00abc123def456789012345678901234567890123456789012345678901234',
      token: '10bid001abc234567890123456789012345678901234567890123456789012',
    },
  },
  {
    tokenName: '11bid002def345678901234567890123456789012345678901234567890123',
    bidder: 'addr_test1qz9nxkj7fezmk9s7w4hm3txqk8cp4rvz3nxfvd8ccvxzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqz53u88',
    bidderPkh: '8599b4bc9c8b76581e75779c4c0b1f00d463089998969a7c60c3647c',
    encryptionToken: '00abc123def456789012345678901234567890123456789012345678901234',
    amount: 95_000_000, // 95 ADA in lovelace
    status: 'pending',
    createdAt: '2025-01-16T12:45:00Z',
    utxo: {
      txHash: '00112233556677889900aabbccddeeff00112233556677889900aabbccddeeff',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '8599b4bc9c8b76581e75779c4c0b1f00d4630899',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: BIDDER_PUBLIC_2,
      },
      pointer: '00abc123def456789012345678901234567890123456789012345678901234',
      token: '11bid002def345678901234567890123456789012345678901234567890123',
    },
  },
  {
    tokenName: '12bid003ghi456789012345678901234567890123456789012345678901234',
    bidder: 'addr_test1qrxhyr2flena4ams5pcx26n0yj4ttpmjq2tmuesu4waw8n0qkvxuy9e4kdpz0s7r67jr8pjl9q6ezm2jgg247y9q3zpqxga37s',
    bidderPkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee40297be6619571d71e7',
    encryptionToken: '01def456abc789012345678901234567890123456789012345678901234567',
    amount: 300_000_000, // 300 ADA in lovelace
    status: 'pending',
    createdAt: '2025-01-17T09:00:00Z',
    utxo: {
      txHash: '11223344667788990011aabbccddeeff11223344667788990011aabbccddeeff',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: 'cd720d49f33ed6f7b8283069a9bcc9556b0ee402',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: BIDDER_PUBLIC_1,
      },
      pointer: '01def456abc789012345678901234567890123456789012345678901234567',
      token: '12bid003ghi456789012345678901234567890123456789012345678901234',
    },
  },
  {
    tokenName: '13bid004jkl567890123456789012345678901234567890123456789012345',
    bidder: 'addr_test1qz9nxkj7fezmk9s7w4hm3txqk8cp4rvz3nxfvd8ccvxzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwqz53u88',
    bidderPkh: '8599b4bc9c8b76581e75779c4c0b1f00d463089998969a7c60c3647c',
    encryptionToken: '02ghi789jkl012345678901234567890123456789012345678901234567890',
    amount: 550_000_000, // 550 ADA in lovelace (accepted bid for pending encryption)
    status: 'accepted',
    createdAt: '2025-01-17T10:30:00Z',
    utxo: {
      txHash: '22334455778899001122aabbccddeeff22334455778899001122aabbccddeeff',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '8599b4bc9c8b76581e75779c4c0b1f00d4630899',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: BIDDER_PUBLIC_2,
      },
      pointer: '02ghi789jkl012345678901234567890123456789012345678901234567890',
      token: '13bid004jkl567890123456789012345678901234567890123456789012345',
    },
  },
  {
    tokenName: '14bid005mno678901234567890123456789012345678901234567890123456',
    bidder: 'addr_test1qptg8lu2nwrgw6pcvf53qqyc6rrkuv2vxcxthp8sdwxzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq3ufq92',
    bidderPkh: '5687fe54d3834e4070c4d220018c68639c628c3606bb89e06b866438',
    encryptionToken: '04stu345vwx678901234567890123456789012345678901234567890123456',
    amount: 1_200_000_000, // 1200 ADA in lovelace
    status: 'pending',
    createdAt: '2025-01-19T14:15:00Z',
    utxo: {
      txHash: '33445566889900112233aabbccddeeff33445566889900112233aabbccddeeff',
      outputIndex: 0,
    },
    datum: {
      owner_vkh: '5687fe54d3834e4070c4d220018c68639c628c36',
      owner_g1: {
        generator: G1_GENERATOR,
        public_value: BIDDER_PUBLIC_3,
      },
      pointer: '04stu345vwx678901234567890123456789012345678901234567890123456',
      token: '14bid005mno678901234567890123456789012345678901234567890123456',
    },
  },
];
