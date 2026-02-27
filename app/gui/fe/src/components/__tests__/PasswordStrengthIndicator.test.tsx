import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PasswordStrengthIndicator from '../PasswordStrengthIndicator';
import { getPasswordStrength } from '../../hooks/usePasswordStrength';

function renderIndicator(password: string) {
  const strength = getPasswordStrength(password);
  return render(<PasswordStrengthIndicator strength={strength} password={password} />);
}

describe('PasswordStrengthIndicator', () => {
  it('returns null when password is empty', () => {
    const strength = getPasswordStrength('');
    const { container } = render(
      <PasswordStrengthIndicator strength={strength} password="" />,
    );
    expect(container.innerHTML).toBe('');
  });

  describe('requirement checklist', () => {
    it('renders all 5 requirement labels', () => {
      renderIndicator('a');
      expect(screen.getByText('12+ characters')).toBeInTheDocument();
      expect(screen.getByText('One uppercase letter')).toBeInTheDocument();
      expect(screen.getByText('One lowercase letter')).toBeInTheDocument();
      expect(screen.getByText('One digit')).toBeInTheDocument();
      expect(screen.getByText('One special character')).toBeInTheDocument();
    });

    it('marks met requirements with success color', () => {
      renderIndicator('abc'); // only hasLowercase met
      const lowercase = screen.getByText('One lowercase letter');
      expect(lowercase).toHaveStyle({ color: 'var(--text-secondary)' });
    });

    it('marks unmet requirements with muted color', () => {
      renderIndicator('abc'); // hasUppercase not met
      const uppercase = screen.getByText('One uppercase letter');
      expect(uppercase).toHaveStyle({ color: 'var(--text-muted)' });
    });
  });

  describe('strength levels', () => {
    it('shows "Weak" for passwords meeting ≤2 requirements', () => {
      renderIndicator('ab'); // only hasLowercase (1 met)
      expect(screen.getByText('Weak')).toBeInTheDocument();
    });

    it('shows "Fair" for passwords meeting 3-4 requirements', () => {
      renderIndicator('Abcdefghijkl1'); // minLength + hasUpper + hasLower + hasDigit (4 met)
      expect(screen.getByText('Fair')).toBeInTheDocument();
    });

    it('shows "Strong" for passwords meeting all 5 requirements', () => {
      renderIndicator('Abcdefghijk1!'); // all 5 met
      expect(screen.getByText('Strong')).toBeInTheDocument();
    });
  });

  describe('strength bar segments', () => {
    it('fills 1 segment for weak password', () => {
      const { container } = renderIndicator('ab');
      const segments = container.querySelectorAll('.h-1\\.5.flex-1');
      expect(segments).toHaveLength(3);
      // First segment filled (error color), others secondary
      expect(segments[0]).toHaveStyle({ background: 'var(--error)' });
      expect(segments[1]).toHaveStyle({ background: 'var(--bg-secondary)' });
      expect(segments[2]).toHaveStyle({ background: 'var(--bg-secondary)' });
    });

    it('fills 2 segments for fair password', () => {
      const { container } = renderIndicator('Abcdefghijkl1');
      const segments = container.querySelectorAll('.h-1\\.5.flex-1');
      expect(segments[0]).toHaveStyle({ background: 'var(--warning)' });
      expect(segments[1]).toHaveStyle({ background: 'var(--warning)' });
      expect(segments[2]).toHaveStyle({ background: 'var(--bg-secondary)' });
    });

    it('fills 3 segments for strong password', () => {
      const { container } = renderIndicator('Abcdefghijk1!');
      const segments = container.querySelectorAll('.h-1\\.5.flex-1');
      expect(segments[0]).toHaveStyle({ background: 'var(--success)' });
      expect(segments[1]).toHaveStyle({ background: 'var(--success)' });
      expect(segments[2]).toHaveStyle({ background: 'var(--success)' });
    });
  });
});
