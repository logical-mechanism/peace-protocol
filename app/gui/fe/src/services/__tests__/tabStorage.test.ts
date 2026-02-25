import { describe, it, expect, beforeEach } from 'vitest';
import { getLastActiveTab, setLastActiveTab, clearLastActiveTab } from '../tabStorage';

describe('tabStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getLastActiveTab returns marketplace when nothing stored', () => {
    expect(getLastActiveTab()).toBe('marketplace');
  });

  it('setLastActiveTab/getLastActiveTab roundtrip', () => {
    setLastActiveTab('my-sales');
    expect(getLastActiveTab()).toBe('my-sales');
  });

  it('persists all valid tab ids', () => {
    const tabs = ['marketplace', 'my-sales', 'my-purchases', 'history', 'library'] as const;
    for (const tab of tabs) {
      setLastActiveTab(tab);
      expect(getLastActiveTab()).toBe(tab);
    }
  });

  it('returns marketplace for invalid stored value', () => {
    localStorage.setItem('veiled_active_tab', 'invalid-tab');
    expect(getLastActiveTab()).toBe('marketplace');
  });

  it('clearLastActiveTab removes the stored value', () => {
    setLastActiveTab('history');
    expect(getLastActiveTab()).toBe('history');
    clearLastActiveTab();
    expect(getLastActiveTab()).toBe('marketplace');
  });
});
