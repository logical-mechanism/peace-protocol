import { describe, it, expect, beforeEach } from 'vitest';
import { getAutolockMinutes, setAutolockMinutes } from '../autolock';

describe('autolock', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getAutolockMinutes returns 15 when nothing stored', () => {
    expect(getAutolockMinutes()).toBe(15);
  });

  it('setAutolockMinutes/getAutolockMinutes roundtrip', () => {
    setAutolockMinutes(30);
    expect(getAutolockMinutes()).toBe(30);
  });

  it('setAutolockMinutes(0) returns 0 (not default)', () => {
    setAutolockMinutes(0);
    expect(getAutolockMinutes()).toBe(0);
  });
});
