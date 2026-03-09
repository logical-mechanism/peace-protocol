import { describe, it, expect } from 'vitest';
import { halfLevelToPlutusJson, fullLevelToPlutusJson, emptyFullLevelToPlutusJson } from '../level';

describe('level', () => {
  const mockG1 = 'aa'.repeat(48); // 96 hex chars
  const mockG2 = 'bb'.repeat(96); // 192 hex chars

  describe('halfLevelToPlutusJson', () => {
    it('returns constructor 0 with 3 fields in order [r1, r2_g1, r4]', () => {
      const half = { r1: mockG1, r2_g1: mockG1, r4: mockG2 };
      const json = halfLevelToPlutusJson(half) as {
        constructor: number;
        fields: { bytes: string }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(3);
      expect(json.fields[0].bytes).toBe(mockG1);
      expect(json.fields[1].bytes).toBe(mockG1);
      expect(json.fields[2].bytes).toBe(mockG2);
    });
  });

  describe('fullLevelToPlutusJson', () => {
    it('returns constructor 0 with 1 field which is constructor 0 with 4 fields', () => {
      const full = { r1: mockG1, r2_g1: mockG1, r2_g2: mockG2, r4: mockG2 };
      const json = fullLevelToPlutusJson(full) as {
        constructor: number;
        fields: {
          constructor: number;
          fields: { bytes: string }[];
        }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(1);
      expect(json.fields[0].constructor).toBe(0);
      expect(json.fields[0].fields).toHaveLength(4);
      expect(json.fields[0].fields[0].bytes).toBe(mockG1);
      expect(json.fields[0].fields[1].bytes).toBe(mockG1);
      expect(json.fields[0].fields[2].bytes).toBe(mockG2);
      expect(json.fields[0].fields[3].bytes).toBe(mockG2);
    });
  });

  describe('emptyFullLevelToPlutusJson', () => {
    it('returns constructor 1 with empty fields', () => {
      const json = emptyFullLevelToPlutusJson() as {
        constructor: number;
        fields: unknown[];
      };
      expect(json.constructor).toBe(1);
      expect(json.fields).toEqual([]);
    });
  });
});
