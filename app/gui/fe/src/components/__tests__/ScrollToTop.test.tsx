import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import ScrollToTop from '../ScrollToTop';
import { ModalProvider } from '../../contexts/ModalContext';

function renderScrollToTop(props: { threshold?: number } = {}) {
  return render(
    React.createElement(ModalProvider, null,
      React.createElement(ScrollToTop, props),
    ),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
});

function simulateScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

describe('ScrollToTop', () => {
  it('is hidden when scroll position is below threshold', () => {
    renderScrollToTop();
    expect(screen.queryByLabelText('Scroll to top')).not.toBeInTheDocument();
  });

  it('appears when scroll exceeds default threshold (300px)', () => {
    renderScrollToTop();
    simulateScroll(301);
    expect(screen.getByLabelText('Scroll to top')).toBeInTheDocument();
  });

  it('respects custom threshold', () => {
    renderScrollToTop({ threshold: 100 });
    simulateScroll(50);
    expect(screen.queryByLabelText('Scroll to top')).not.toBeInTheDocument();
    simulateScroll(101);
    expect(screen.getByLabelText('Scroll to top')).toBeInTheDocument();
  });

  it('hides again when scrolling back up', () => {
    renderScrollToTop();
    simulateScroll(400);
    expect(screen.getByLabelText('Scroll to top')).toBeInTheDocument();
    simulateScroll(100);
    expect(screen.queryByLabelText('Scroll to top')).not.toBeInTheDocument();
  });

  it('calls window.scrollTo on click', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderScrollToTop();
    simulateScroll(500);
    fireEvent.click(screen.getByLabelText('Scroll to top'));
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
