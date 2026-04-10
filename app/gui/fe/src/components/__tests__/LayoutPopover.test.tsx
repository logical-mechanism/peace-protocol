import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LayoutPopover from '../LayoutPopover';

function renderPopover(overrides: Partial<React.ComponentProps<typeof LayoutPopover>> = {}) {
  const onViewModeChange = vi.fn();
  const onCardSizeChange = vi.fn();
  const onColumnCountChange = vi.fn();
  const utils = render(
    <LayoutPopover
      viewMode="grid"
      cardSize="medium"
      columnCount={3}
      onViewModeChange={onViewModeChange}
      onCardSizeChange={onCardSizeChange}
      onColumnCountChange={onColumnCountChange}
      {...overrides}
    />,
  );
  return { ...utils, onViewModeChange, onCardSizeChange, onColumnCountChange };
}

describe('LayoutPopover', () => {
  it('starts closed — only the trigger button is visible', () => {
    renderPopover();
    expect(screen.getByLabelText('Layout options')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the popover when the trigger is clicked', () => {
    renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByRole('dialog', { name: 'Layout options' })).toBeInTheDocument();
  });

  it('renders all three control rows when open', () => {
    renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByRole('group', { name: 'View mode' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Card size' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Column count' })).toBeInTheDocument();
  });

  it('dispatches view mode change', () => {
    const { onViewModeChange } = renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    fireEvent.click(screen.getByLabelText('List view'));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('dispatches card size change', () => {
    const { onCardSizeChange } = renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    fireEvent.click(screen.getByLabelText('Large cards'));
    expect(onCardSizeChange).toHaveBeenCalledWith('large');
  });

  it('dispatches column count change', () => {
    const { onColumnCountChange } = renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    fireEvent.click(screen.getByLabelText('4 columns'));
    expect(onColumnCountChange).toHaveBeenCalledWith(4);
  });

  it('disables size and columns when in list view', () => {
    const { onCardSizeChange, onColumnCountChange } = renderPopover({ viewMode: 'list' });
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByLabelText('Small cards')).toBeDisabled();
    expect(screen.getByLabelText('2 columns')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Small cards'));
    fireEvent.click(screen.getByLabelText('2 columns'));
    expect(onCardSizeChange).not.toHaveBeenCalled();
    expect(onColumnCountChange).not.toHaveBeenCalled();
  });

  it('marks the active value with aria-pressed=true', () => {
    renderPopover({ viewMode: 'grid', cardSize: 'large', columnCount: 4 });
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByLabelText('Grid view')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Large cards')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('4 columns')).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes on Escape key', () => {
    renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    const { container } = renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(container.ownerDocument.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open when clicking inside the popover', () => {
    renderPopover();
    fireEvent.click(screen.getByLabelText('Layout options'));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('aria-expanded reflects open state', () => {
    renderPopover();
    const trigger = screen.getByLabelText('Layout options');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
