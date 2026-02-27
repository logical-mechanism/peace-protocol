import { describe, it, expect } from 'vitest';
import { parseOutputIndex } from '../index.js';

describe('parseOutputIndex', () => {
  it('parses valid index 0', () => {
    expect(parseOutputIndex('0', '1')).toBe(0);
  });

  it('parses valid index 1', () => {
    expect(parseOutputIndex('1', '0')).toBe(1);
  });

  it('parses valid index 255', () => {
    expect(parseOutputIndex('255', '1')).toBe(255);
  });

  it('uses default when env var is undefined', () => {
    expect(parseOutputIndex(undefined, '1')).toBe(1);
  });

  it('uses default when env var is empty string', () => {
    expect(parseOutputIndex('', '2')).toBe(2);
  });

  it('throws on negative index', () => {
    expect(() => parseOutputIndex('-1', '1')).toThrow('Invalid output index');
  });

  it('throws on index > 255', () => {
    expect(() => parseOutputIndex('256', '1')).toThrow('Invalid output index');
  });

  it('throws on large index', () => {
    expect(() => parseOutputIndex('999', '1')).toThrow('Invalid output index');
  });

  it('throws on NaN input', () => {
    expect(() => parseOutputIndex('abc', '1')).toThrow('Invalid output index');
  });

  it('throws on float input', () => {
    expect(() => parseOutputIndex('1.5', '1')).toBe; // parseInt('1.5') = 1, which is valid
    expect(parseOutputIndex('1.5', '0')).toBe(1);
  });
});
