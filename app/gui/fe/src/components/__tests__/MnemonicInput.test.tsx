import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import MnemonicInput, { validateMnemonicWords } from '../MnemonicInput';

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Helpers ─────────────────────────────────────────────────────────

const defaultProps = {
  index: 0,
  value: '',
  onChange: vi.fn(),
  onTab: vi.fn(),
};

function renderInput(overrides: Partial<typeof defaultProps> = {}) {
  return render(<MnemonicInput {...defaultProps} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('MnemonicInput', () => {
  describe('rendering', () => {
    it('renders input element', () => {
      renderInput();
      expect(screen.getByPlaceholderText('...')).toBeInTheDocument();
    });

    it('shows word index (1-based)', () => {
      renderInput({ index: 4 });
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders with value', () => {
      renderInput({ value: 'abandon' });
      expect(screen.getByDisplayValue('abandon')).toBeInTheDocument();
    });

    it('can be disabled', () => {
      render(
        <MnemonicInput {...defaultProps} disabled />,
      );
      expect(screen.getByPlaceholderText('...')).toBeDisabled();
    });
  });

  describe('input sanitization', () => {
    it('strips non-alpha characters on change', () => {
      const onChange = vi.fn();
      renderInput({ onChange });
      fireEvent.change(screen.getByPlaceholderText('...'), {
        target: { value: 'abc123!@#DEF' },
      });
      expect(onChange).toHaveBeenCalledWith(0, 'abcdef');
    });
  });

  describe('autocomplete dropdown', () => {
    it('shows dropdown when typing a partial word', () => {
      const { container } = renderInput({ value: 'aban' });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      // "abandon" is split: <span>aban</span>don — use container query
      const dropdown = container.querySelector('.absolute.z-50');
      expect(dropdown).not.toBeNull();
      expect(dropdown!.textContent).toContain('abandon');
    });

    it('hides dropdown when value is empty', () => {
      renderInput({ value: '' });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      expect(screen.queryByText('abandon')).not.toBeInTheDocument();
    });

    it('hides dropdown when exact match is already entered', () => {
      renderInput({ value: 'abandon' });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      // "abandon" is exact match and only match — no dropdown rendered
      // queryAllByText finds zero because dropdown is hidden (input value is not text content)
      expect(screen.queryAllByText(/^abandon$/)).toHaveLength(0);
    });

    it('filters matches to words starting with the prefix', () => {
      const { container } = renderInput({ value: 'ab' });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      const dropdown = container.querySelector('.absolute.z-50');
      expect(dropdown).not.toBeNull();
      expect(dropdown!.textContent).toContain('ability');
      expect(dropdown!.textContent).toContain('able');
    });
  });

  describe('keyboard navigation', () => {
    it('selects match on Enter key', () => {
      const onChange = vi.fn();
      const onTab = vi.fn();
      renderInput({ value: 'aban', onChange, onTab });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      fireEvent.keyDown(screen.getByPlaceholderText('...'), { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith(0, 'abandon');
      expect(onTab).toHaveBeenCalledWith(0);
    });

    it('navigates down with ArrowDown', () => {
      const onChange = vi.fn();
      const onTab = vi.fn();
      renderInput({ value: 'ab', onChange, onTab });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      fireEvent.keyDown(screen.getByPlaceholderText('...'), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByPlaceholderText('...'), { key: 'Enter' });
      expect(onChange).toHaveBeenCalled();
      const selectedWord = onChange.mock.calls[0][1];
      expect(selectedWord).not.toBe('abandon');
    });

    it('closes dropdown on Escape', () => {
      const { container } = renderInput({ value: 'aban' });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      expect(container.querySelector('.absolute.z-50')).not.toBeNull();
      fireEvent.keyDown(screen.getByPlaceholderText('...'), { key: 'Escape' });
      // Dropdown should be hidden after Escape
      expect(container.querySelector('.absolute.z-50')).toBeNull();
    });

    it('accepts match on Tab key', () => {
      const onChange = vi.fn();
      const onTab = vi.fn();
      renderInput({ value: 'aban', onChange, onTab });
      fireEvent.focus(screen.getByPlaceholderText('...'));
      fireEvent.keyDown(screen.getByPlaceholderText('...'), { key: 'Tab' });
      expect(onChange).toHaveBeenCalledWith(0, 'abandon');
    });
  });

  describe('validation styling', () => {
    it('shows success border for valid BIP-39 word', () => {
      const { container } = renderInput({ value: 'abandon' });
      // The wrapper div has an inline style with border color
      const wrapper = container.querySelector('[style]');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.getAttribute('style')).toContain('var(--success)');
    });

    it('shows error border for invalid word with no matches', () => {
      const { container } = renderInput({ value: 'zzzzz' });
      const wrapper = container.querySelector('[style]');
      expect(wrapper).not.toBeNull();
      expect(wrapper!.getAttribute('style')).toContain('var(--error)');
    });
  });
});

describe('validateMnemonicWords', () => {
  it('returns true for valid 24-word mnemonic', () => {
    const words = Array(24).fill('abandon');
    expect(validateMnemonicWords(words)).toBe(true);
  });

  it('returns false for wrong word count', () => {
    const words = Array(12).fill('abandon');
    expect(validateMnemonicWords(words)).toBe(false);
  });

  it('returns false if any word is not in BIP-39 list', () => {
    const words = Array(24).fill('abandon');
    words[5] = 'notaword';
    expect(validateMnemonicWords(words)).toBe(false);
  });

  it('handles uppercase words', () => {
    const words = Array(24).fill('ABANDON');
    expect(validateMnemonicWords(words)).toBe(true);
  });

  it('returns false for empty array', () => {
    expect(validateMnemonicWords([])).toBe(false);
  });
});
