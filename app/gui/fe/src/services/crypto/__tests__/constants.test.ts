import { describe, it, expect } from 'vitest';
import {
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
} from '../constants';
import { hexToBytes } from '../bls12381';

describe('constants', () => {
  const decoder = new TextDecoder();

  describe('domain tag decoding', () => {
    it('KEY_DOMAIN_TAG decodes to expected ASCII', () => {
      expect(decoder.decode(hexToBytes(KEY_DOMAIN_TAG))).toBe('ED25519|To|BLS12381|v1|');
    });

    it('SCH_DOMAIN_TAG decodes to expected ASCII', () => {
      expect(decoder.decode(hexToBytes(SCH_DOMAIN_TAG))).toBe('SCHNORR|PROOF|v1|');
    });

    it('BND_DOMAIN_TAG decodes to expected ASCII', () => {
      expect(decoder.decode(hexToBytes(BND_DOMAIN_TAG))).toBe('BINDING|PROOF|v1|');
    });

    it('H2I_DOMAIN_TAG decodes to expected ASCII', () => {
      expect(decoder.decode(hexToBytes(H2I_DOMAIN_TAG))).toBe('HASH|To|Int|v1|');
    });
  });

  describe('domain tags are non-empty', () => {
    it('all domain tags are non-empty strings', () => {
      const tags = [
        KEY_DOMAIN_TAG,
        F12_DOMAIN_TAG,
        SLT_DOMAIN_TAG,
        KEM_DOMAIN_TAG,
        AAD_DOMAIN_TAG,
        MSG_DOMAIN_TAG,
        SCH_DOMAIN_TAG,
        BND_DOMAIN_TAG,
        H2I_DOMAIN_TAG,
      ];
      for (const tag of tags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
      }
    });
  });

  describe('domain tags are unique', () => {
    it('all 9 domain tags are unique', () => {
      const tags = new Set([
        KEY_DOMAIN_TAG,
        F12_DOMAIN_TAG,
        SLT_DOMAIN_TAG,
        KEM_DOMAIN_TAG,
        AAD_DOMAIN_TAG,
        MSG_DOMAIN_TAG,
        SCH_DOMAIN_TAG,
        BND_DOMAIN_TAG,
        H2I_DOMAIN_TAG,
      ]);
      expect(tags.size).toBe(9);
    });
  });

  describe('Wang public G2 points', () => {
    it('H0, H1, H2, H3 are each 192-char hex (valid G2 compressed points)', () => {
      for (const point of [H0, H1, H2, H3]) {
        expect(point).toHaveLength(192);
        expect(point).toMatch(/^[0-9a-f]+$/);
      }
    });

    it('H0, H1, H2, H3 are all different from each other', () => {
      const points = [H0, H1, H2, H3];
      const unique = new Set(points);
      expect(unique.size).toBe(4);
    });
  });
});
