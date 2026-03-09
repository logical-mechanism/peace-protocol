import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ModalProvider, useModal } from '../ModalContext';

function renderModalHook() {
  return renderHook(() => useModal(), { wrapper: ModalProvider });
}

describe('ModalContext', () => {
  it('starts with no open modals', () => {
    const { result } = renderModalHook();
    expect(result.current.hasOpenModal).toBe(false);
  });

  it('openModal adds to stack', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('confirm'); });
    expect(result.current.hasOpenModal).toBe(true);
    expect(result.current.isTopModal('confirm')).toBe(true);
    expect(result.current.getZIndex('confirm')).toBe(50);
  });

  it('stacks multiple modals with increasing z-index', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('create-listing'); });
    act(() => { result.current.openModal('confirm-delete'); });
    expect(result.current.getZIndex('create-listing')).toBe(50);
    expect(result.current.getZIndex('confirm-delete')).toBe(52);
    expect(result.current.isTopModal('create-listing')).toBe(false);
    expect(result.current.isTopModal('confirm-delete')).toBe(true);
  });

  it('closeModal removes from stack', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('a'); });
    act(() => { result.current.openModal('b'); });
    act(() => { result.current.closeModal('b'); });
    expect(result.current.isTopModal('a')).toBe(true);
    expect(result.current.hasOpenModal).toBe(true);
    act(() => { result.current.closeModal('a'); });
    expect(result.current.hasOpenModal).toBe(false);
  });

  it('opening duplicate modal moves it to top', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('a'); });
    act(() => { result.current.openModal('b'); });
    expect(result.current.isTopModal('b')).toBe(true);
    act(() => { result.current.openModal('a'); });
    expect(result.current.isTopModal('a')).toBe(true);
    expect(result.current.isTopModal('b')).toBe(false);
  });

  it('getZIndex returns correct z for each stacked modal', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('x'); });
    act(() => { result.current.openModal('y'); });
    act(() => { result.current.openModal('z'); });
    expect(result.current.getZIndex('x')).toBe(50);
    expect(result.current.getZIndex('y')).toBe(52);
    expect(result.current.getZIndex('z')).toBe(54);
  });

  it('closing a non-existent modal is a no-op', () => {
    const { result } = renderModalHook();
    act(() => { result.current.openModal('a'); });
    act(() => { result.current.closeModal('nonexistent'); });
    expect(result.current.hasOpenModal).toBe(true);
    expect(result.current.isTopModal('a')).toBe(true);
  });

  it('useModal throws outside provider', () => {
    expect(() => {
      renderHook(() => useModal());
    }).toThrow('useModal must be used within ModalProvider');
  });
});
