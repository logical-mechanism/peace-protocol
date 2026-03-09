import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PriceRangeSlider from '../PriceRangeSlider';

const defaultProps = {
  min: 0,
  max: 1000,
  valueMin: '',
  valueMax: '',
  onChangeMin: vi.fn(),
  onChangeMax: vi.fn(),
};

function renderSlider(overrides: Partial<typeof defaultProps> = {}) {
  return render(<PriceRangeSlider {...defaultProps} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PriceRangeSlider', () => {
  describe('rendering', () => {
    it('displays min and max ADA labels', () => {
      renderSlider();
      expect(screen.getByText('0 ADA')).toBeInTheDocument();
      expect(screen.getByText('1000 ADA')).toBeInTheDocument();
    });

    it('displays effective values when valueMin/valueMax are set', () => {
      renderSlider({ valueMin: '200', valueMax: '800' });
      expect(screen.getByText('200 ADA')).toBeInTheDocument();
      expect(screen.getByText('800 ADA')).toBeInTheDocument();
    });

    it('has aria-labels on both range inputs', () => {
      renderSlider();
      expect(screen.getByLabelText('Minimum price')).toBeInTheDocument();
      expect(screen.getByLabelText('Maximum price')).toBeInTheDocument();
    });
  });

  describe('min slider', () => {
    it('calls onChangeMin with string value', () => {
      const onChangeMin = vi.fn();
      renderSlider({ onChangeMin, valueMax: '500' });
      fireEvent.change(screen.getByLabelText('Minimum price'), {
        target: { value: '200' },
      });
      expect(onChangeMin).toHaveBeenCalledWith('200');
    });

    it('clears to empty string when value is at min bound', () => {
      const onChangeMin = vi.fn();
      // Start with a non-zero valueMin so the controlled input changes
      renderSlider({ onChangeMin, valueMin: '50' });
      fireEvent.change(screen.getByLabelText('Minimum price'), {
        target: { value: '0' },
      });
      expect(onChangeMin).toHaveBeenCalledWith('');
    });
  });

  describe('max slider', () => {
    it('calls onChangeMax with string value', () => {
      const onChangeMax = vi.fn();
      renderSlider({ onChangeMax, valueMin: '200' });
      fireEvent.change(screen.getByLabelText('Maximum price'), {
        target: { value: '800' },
      });
      expect(onChangeMax).toHaveBeenCalledWith('800');
    });

    it('clamps max value to not go below effectiveMin', () => {
      const onChangeMax = vi.fn();
      renderSlider({ onChangeMax, valueMin: '300' });
      fireEvent.change(screen.getByLabelText('Maximum price'), {
        target: { value: '100' },
      });
      expect(onChangeMax).toHaveBeenCalledWith('300');
    });

    it('clears to empty string when value is at max bound', () => {
      const onChangeMax = vi.fn();
      // Start with non-max valueMax so the controlled input changes
      renderSlider({ onChangeMax, valueMax: '800' });
      fireEvent.change(screen.getByLabelText('Maximum price'), {
        target: { value: '1000' },
      });
      expect(onChangeMax).toHaveBeenCalledWith('');
    });
  });
});
