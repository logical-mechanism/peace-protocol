import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import InfoTooltip from '../InfoTooltip';

describe('InfoTooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the info icon button', () => {
    render(<InfoTooltip text="Test tooltip" />);
    expect(screen.getByLabelText('More information')).toBeInTheDocument();
  });

  it('does not show tooltip text by default', () => {
    render(<InfoTooltip text="Test tooltip" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on mouse enter', () => {
    render(<InfoTooltip text="Test tooltip" />);
    const wrapper = screen.getByLabelText('More information').parentElement!;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Test tooltip');
  });

  it('hides tooltip on mouse leave after delay', () => {
    vi.useFakeTimers();
    render(<InfoTooltip text="Test tooltip" />);
    const wrapper = screen.getByLabelText('More information').parentElement!;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    // Still visible before timeout
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels hide when mouse re-enters before delay expires', () => {
    vi.useFakeTimers();
    render(<InfoTooltip text="Test tooltip" />);
    const wrapper = screen.getByLabelText('More information').parentElement!;
    fireEvent.mouseEnter(wrapper);
    fireEvent.mouseLeave(wrapper);
    // Re-enter before the 100ms delay
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Should still be visible
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('shows tooltip on focus', () => {
    render(<InfoTooltip text="Test tooltip" />);
    fireEvent.focus(screen.getByLabelText('More information'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('hides tooltip on blur after delay', () => {
    vi.useFakeTimers();
    render(<InfoTooltip text="Test tooltip" />);
    const btn = screen.getByLabelText('More information');
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(btn);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('toggles tooltip on click', () => {
    render(<InfoTooltip text="Test tooltip" />);
    const btn = screen.getByLabelText('More information');
    fireEvent.click(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses bottom positioning when specified', () => {
    render(<InfoTooltip text="Test tooltip" position="bottom" />);
    const wrapper = screen.getByLabelText('More information').parentElement!;
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('top-full');
    expect(tooltip.className).not.toContain('bottom-full');
  });

  it('uses top positioning by default', () => {
    render(<InfoTooltip text="Test tooltip" />);
    const wrapper = screen.getByLabelText('More information').parentElement!;
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('bottom-full');
    expect(tooltip.className).not.toContain('top-full');
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(<InfoTooltip text="Test" className="ml-2" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('ml-2');
  });

  it('renders button with type="button" to prevent form submission', () => {
    render(<InfoTooltip text="Test" />);
    const btn = screen.getByLabelText('More information');
    expect(btn.getAttribute('type')).toBe('button');
  });
});
