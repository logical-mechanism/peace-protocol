import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('getLastActiveTab returns marketplace when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(getLastActiveTab()).toBe('marketplace');
    });

    it('setLastActiveTab silently swallows quota exceeded error', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => setLastActiveTab('history')).not.toThrow();
    });

    it('clearLastActiveTab silently swallows errors', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(() => clearLastActiveTab()).not.toThrow();
    });
  });
});
