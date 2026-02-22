/**
 * Tests for matchToKoiosUtxo — the data pipeline from Kupo format to KoiosUtxo.
 * Every UTxO in the app flows through this function.
 */
import { describe, it, expect } from 'vitest';
import { matchToKoiosUtxo, type KupoMatch } from '../kupo.js';

/** Minimal valid KupoMatch fixture */
function baseMatch(overrides: Partial<KupoMatch> = {}): KupoMatch {
  return {
    transaction_index: 0,
    transaction_id: 'aa'.repeat(32),
    output_index: 0,
    address: 'addr_test1qz...',
    value: { coins: 5000000 },
    datum_hash: null,
    script_hash: null,
    created_at: { slot_no: 1000, header_hash: 'bb'.repeat(32) },
    spent_at: null,
    ...overrides,
  };
}

describe('matchToKoiosUtxo', () => {
  describe('asset splitting', () => {
    it('splits dot-separated key into policy_id and asset_name', () => {
      const match = baseMatch({
        value: {
          coins: 2000000,
          assets: { 'aabbccdd.00112233': 1 },
        },
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.asset_list).toHaveLength(1);
      expect(result.asset_list[0].policy_id).toBe('aabbccdd');
      expect(result.asset_list[0].asset_name).toBe('00112233');
      expect(result.asset_list[0].quantity).toBe('1');
    });

    it('handles policy-only token (no dot) with empty asset_name', () => {
      const match = baseMatch({
        value: {
          coins: 2000000,
          assets: { 'aabbccddee': 5 },
        },
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.asset_list).toHaveLength(1);
      expect(result.asset_list[0].policy_id).toBe('aabbccddee');
      expect(result.asset_list[0].asset_name).toBe('');
    });

    it('returns empty asset_list when no assets', () => {
      const match = baseMatch({ value: { coins: 3000000 } });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.asset_list).toEqual([]);
    });

    it('handles multiple assets', () => {
      const match = baseMatch({
        value: {
          coins: 2000000,
          assets: { 'abc.def': 10, 'xyz': 3 },
        },
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.asset_list).toHaveLength(2);
    });
  });

  describe('datum handling', () => {
    it('decodes inline datum when datum_type is inline and datum present', () => {
      // CBOR for { int: 42 } is 0x182a
      const match = baseMatch({
        datum_type: 'inline',
        datum: '182a',
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.inline_datum).not.toBeNull();
      expect(result.inline_datum!.bytes).toBe('182a');
      expect(result.inline_datum!.value).toEqual({ int: 42 });
    });

    it('returns null inline_datum for hash-referenced datum', () => {
      const match = baseMatch({
        datum_type: 'hash',
        datum_hash: 'cc'.repeat(32),
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.inline_datum).toBeNull();
      expect(result.datum_hash).toBe('cc'.repeat(32));
    });

    it('returns null inline_datum when datum_type is inline but datum is null', () => {
      const match = baseMatch({
        datum_type: 'inline',
        datum: null,
      });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.inline_datum).toBeNull();
    });

    it('returns null inline_datum when no datum_type', () => {
      const match = baseMatch();
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.inline_datum).toBeNull();
    });
  });

  describe('field mapping', () => {
    it('converts coins number to value string', () => {
      const match = baseMatch({ value: { coins: 12345678 } });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.value).toBe('12345678');
      expect(typeof result.value).toBe('string');
    });

    it('maps script_hash to reference_script when present', () => {
      const match = baseMatch({ script_hash: 'dd'.repeat(28) });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.reference_script).toEqual({ hash: 'dd'.repeat(28) });
    });

    it('maps null script_hash to null reference_script', () => {
      const match = baseMatch({ script_hash: null });
      const result = matchToKoiosUtxo(match, 'preprod');
      expect(result.reference_script).toBeNull();
    });
  });
});
