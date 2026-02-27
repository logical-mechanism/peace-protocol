import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import WalletSetup from '../WalletSetup';

// ── Mocks ───────────────────────────────────────────────────────────

const mockCreateWallet = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../contexts/WalletContext', () => ({
  useWalletContext: () => ({
    createWallet: mockCreateWallet,
  }),
}));

// Mock MeshWallet.brew to return predictable mnemonic words
vi.mock('@meshsdk/core', () => ({
  MeshWallet: {
    brew: vi.fn().mockReturnValue(
      Array.from({ length: 24 }, (_, i) => `word${i + 1}`)
    ),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <WalletSetup />
    </MemoryRouter>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWallet.mockResolvedValue(undefined);
});

describe('WalletSetup — choose mode', () => {
  it('renders the choose mode with two options', () => {
    renderPage();

    expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
    expect(screen.getByText('Import Existing Wallet')).toBeInTheDocument();
  });

  it('shows app title', () => {
    renderPage();
    expect(screen.getByText('Veiled')).toBeInTheDocument();
  });

  it('navigates to create mode on "Create New Wallet" click', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Create New Wallet'));

    // Should show the generate step with mnemonic display
    await waitFor(() => {
      expect(screen.getByText('Backup')).toBeInTheDocument();
    });
  });

  it('navigates to import mode on "Import Existing Wallet" click', () => {
    renderPage();

    fireEvent.click(screen.getByText('Import Existing Wallet'));

    expect(screen.getByText('Recovery Phrase')).toBeInTheDocument();
  });
});

describe('WalletSetup — create mode', () => {
  it('generates mnemonic words on create flow', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Create New Wallet'));

    // Mnemonic words should render (word1 through word24)
    await waitFor(() => {
      expect(screen.getByText('word1')).toBeInTheDocument();
    });
    expect(screen.getByText('word24')).toBeInTheDocument();
  });

  it('has step indicators for create flow', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Create New Wallet'));

    await waitFor(() => {
      expect(screen.getByText('Backup')).toBeInTheDocument();
      expect(screen.getByText('Verify')).toBeInTheDocument();
      expect(screen.getByText('Password')).toBeInTheDocument();
    });
  });

  it('has a back button to return to choose mode', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Create New Wallet'));

    await waitFor(() => {
      expect(screen.getByText('word1')).toBeInTheDocument();
    });

    // Click back
    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
  });
});

describe('WalletSetup — import mode', () => {
  it('shows 24 mnemonic input fields', () => {
    renderPage();
    fireEvent.click(screen.getByText('Import Existing Wallet'));

    // Should have 24 numbered input labels
    const inputs = document.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBe(24);
  });

  it('has step indicators for import flow', () => {
    renderPage();

    fireEvent.click(screen.getByText('Import Existing Wallet'));

    expect(screen.getByText('Recovery Phrase')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
  });

  it('has a back button to return to choose mode', () => {
    renderPage();

    fireEvent.click(screen.getByText('Import Existing Wallet'));

    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByText('Create New Wallet')).toBeInTheDocument();
  });
});
