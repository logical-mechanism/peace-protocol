import { describe, it, expect } from 'vitest';
import { buildKeyDerivationMessage } from '../walletSecret';

describe('buildKeyDerivationMessage', () => {
  it('returns the exact protocol message string', () => {
    expect(buildKeyDerivationMessage('any-address')).toBe('PEACE_PROTOCOL_v1');
  });

  it('ignores the address parameter (returns same value for different addresses)', () => {
    const a = buildKeyDerivationMessage('addr_test1abc');
    const b = buildKeyDerivationMessage('addr_test1xyz');
    const c = buildKeyDerivationMessage('');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('is stable across calls', () => {
    const first = buildKeyDerivationMessage('x');
    const second = buildKeyDerivationMessage('x');
    expect(first).toBe(second);
  });
});
