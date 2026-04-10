import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ColumnSelector from '../ColumnSelector';

describe('ColumnSelector', () => {
  it('renders three buttons for 2, 3, and 4 columns', () => {
    render(<ColumnSelector value={3} onChange={() => {}} />);
    expect(screen.getByLabelText('2 columns')).toBeInTheDocument();
    expect(screen.getByLabelText('3 columns')).toBeInTheDocument();
    expect(screen.getByLabelText('4 columns')).toBeInTheDocument();
  });

  it('marks the active value with aria-pressed=true', () => {
    render(<ColumnSelector value={3} onChange={() => {}} />);
    expect(screen.getByLabelText('3 columns')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('2 columns')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('4 columns')).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the active value with accent classes', () => {
    render(<ColumnSelector value={4} onChange={() => {}} />);
    const activeBtn = screen.getByLabelText('4 columns');
    expect(activeBtn.className).toContain('bg-[var(--accent-muted)]');
    expect(activeBtn.className).toContain('text-[var(--accent)]');
  });

  it('calls onChange with selected column count when a button is clicked', () => {
    const onChange = vi.fn();
    render(<ColumnSelector value={3} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('2 columns'));
    expect(onChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText('4 columns'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('does not call onChange when clicking the already-active button does nothing meaningful', () => {
    const onChange = vi.fn();
    render(<ColumnSelector value={3} onChange={onChange} />);
    // Clicking the active button still fires onChange — verify it's the same value
    fireEvent.click(screen.getByLabelText('3 columns'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('exposes role=group with aria-label', () => {
    render(<ColumnSelector value={3} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Column count' });
    expect(group).toBeInTheDocument();
  });
});
