import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ImportListingModal from '../ImportListingModal';
import { ModalProvider } from '../../contexts/ModalContext';

// --- Mocks ---

vi.mock('../../config/categories', () => ({
  detectCategoryFromExtension: (filename: string) => {
    if (filename.endsWith('.pdf')) return 'document';
    if (filename.endsWith('.mp3')) return 'audio';
    if (filename.endsWith('.png')) return 'image';
    if (filename.endsWith('.mp4')) return 'video';
    return 'other';
  },
  getSubcategories: () => [],
  buildCategoryPath: (cat: string, sub?: string) => sub ? `${cat}:${sub}` : cat,
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// --- Test helpers ---

const mockOnClose = vi.fn();
const mockOnSubmit = vi.fn();

const VALID_HEX_64 = 'a'.repeat(64);
const VALID_HEX_24 = 'b'.repeat(24);

/** Get input by its HTML id attribute (avoids InfoTooltip label ambiguity). */
function getInput(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSubmit.mockResolvedValue(undefined);
});

function renderModal(overrides: Partial<Parameters<typeof ImportListingModal>[0]> = {}) {
  return render(
    <ModalProvider>
      <ImportListingModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        {...overrides}
      />
    </ModalProvider>,
  );
}

function fillValidForm() {
  fireEvent.change(getInput('iagonFileId'), { target: { name: 'iagonFileId', value: 'abc123' } });
  fireEvent.change(getInput('aesKeyHex'), { target: { name: 'aesKeyHex', value: VALID_HEX_64 } });
  fireEvent.change(getInput('gcmNonceHex'), { target: { name: 'gcmNonceHex', value: VALID_HEX_24 } });
  fireEvent.change(getInput('sha256DigestHex'), { target: { name: 'sha256DigestHex', value: VALID_HEX_64 } });
  fireEvent.change(getInput('import-description'), { target: { name: 'description', value: 'Test listing' } });
}

describe('ImportListingModal', () => {
  // --- Rendering ---

  it('renders when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Import from Iagon')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders all technical input fields', () => {
    renderModal();
    expect(getInput('iagonFileId')).toBeInTheDocument();
    expect(getInput('aesKeyHex')).toBeInTheDocument();
    expect(getInput('gcmNonceHex')).toBeInTheDocument();
    expect(getInput('sha256DigestHex')).toBeInTheDocument();
    expect(getInput('fileExtension')).toBeInTheDocument();
  });

  it('renders listing detail fields', () => {
    renderModal();
    expect(getInput('import-description')).toBeInTheDocument();
    expect(getInput('import-suggestedPrice')).toBeInTheDocument();
    expect(getInput('import-imageLink')).toBeInTheDocument();
  });

  it('renders Paste All button', () => {
    renderModal();
    expect(screen.getByText('Paste All')).toBeInTheDocument();
  });

  // --- Hex Validation ---

  it('validates AES key must be 64 hex characters', async () => {
    renderModal();
    const input = getInput('aesKeyHex');
    fireEvent.change(input, { target: { name: 'aesKeyHex', value: 'abc' } });
    fireEvent.blur(input);
    expect(await screen.findByText('AES key must be 64 hex characters (32 bytes)')).toBeInTheDocument();
  });

  it('validates AES key must be valid hex', async () => {
    renderModal();
    const input = getInput('aesKeyHex');
    fireEvent.change(input, { target: { name: 'aesKeyHex', value: 'g'.repeat(64) } });
    fireEvent.blur(input);
    expect(await screen.findByText('Must be valid hexadecimal')).toBeInTheDocument();
  });

  it('validates GCM nonce must be 24 hex characters', async () => {
    renderModal();
    const input = getInput('gcmNonceHex');
    fireEvent.change(input, { target: { name: 'gcmNonceHex', value: 'abc' } });
    fireEvent.blur(input);
    expect(await screen.findByText('GCM nonce must be 24 hex characters (12 bytes)')).toBeInTheDocument();
  });

  it('validates SHA-256 digest must be 64 hex characters', async () => {
    renderModal();
    const input = getInput('sha256DigestHex');
    fireEvent.change(input, { target: { name: 'sha256DigestHex', value: 'abc' } });
    fireEvent.blur(input);
    expect(await screen.findByText('SHA-256 digest must be 64 hex characters (32 bytes)')).toBeInTheDocument();
  });

  it('validates file extension must start with dot', async () => {
    renderModal();
    const input = getInput('fileExtension');
    fireEvent.change(input, { target: { name: 'fileExtension', value: 'pdf' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Must start with "." (e.g. ".pdf")')).toBeInTheDocument();
  });

  it('accepts valid hex values without error', async () => {
    renderModal();
    const input = getInput('aesKeyHex');
    fireEvent.change(input, { target: { name: 'aesKeyHex', value: VALID_HEX_64 } });
    fireEvent.blur(input);
    expect(screen.queryByText(/AES key must be/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Must be valid hexadecimal/)).not.toBeInTheDocument();
  });

  // --- Required Fields ---

  it('validates required fields on submit', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Create Listing'));
    expect(await screen.findByText('File ID is required')).toBeInTheDocument();
    expect(screen.getByText('AES key is required')).toBeInTheDocument();
    expect(screen.getByText('GCM nonce is required')).toBeInTheDocument();
    expect(screen.getByText('SHA-256 digest is required')).toBeInTheDocument();
    expect(screen.getByText('Description is required')).toBeInTheDocument();
  });

  it('clears field error on input change', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Create Listing'));
    expect(await screen.findByText('File ID is required')).toBeInTheDocument();
    fireEvent.change(getInput('iagonFileId'), { target: { name: 'iagonFileId', value: 'x' } });
    expect(screen.queryByText('File ID is required')).not.toBeInTheDocument();
  });

  // --- Image Link Validation ---

  it('validates image link must be http(s)', async () => {
    renderModal();
    const input = getInput('import-imageLink');
    fireEvent.change(input, { target: { name: 'imageLink', value: 'ftp://example.com/img.png' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Must use http:// or https://')).toBeInTheDocument();
  });

  it('validates image link format', async () => {
    renderModal();
    const input = getInput('import-imageLink');
    fireEvent.change(input, { target: { name: 'imageLink', value: 'not-a-url' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Invalid URL format')).toBeInTheDocument();
  });

  // --- Category Auto-Detection ---

  it('auto-detects category from file extension', () => {
    renderModal();
    const input = getInput('fileExtension');
    fireEvent.change(input, { target: { name: 'fileExtension', value: '.pdf' } });
    // Category label now comes from i18n (capitalized "Document"); the
    // case-insensitive match keeps the spirit of the original assertion.
    expect(screen.getByText(/document/i)).toBeInTheDocument();
  });

  // --- Paste All ---

  it('pastes JSON with standard key names', async () => {
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn().mockResolvedValue(JSON.stringify({
          fileId: 'my-file-id',
          key: VALID_HEX_64,
          nonce: VALID_HEX_24,
          digest: VALID_HEX_64,
          ext: '.pdf',
        })),
      },
    });

    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText('Paste All'));
    });

    expect(getInput('iagonFileId').value).toBe('my-file-id');
    expect(getInput('aesKeyHex').value).toBe(VALID_HEX_64);
    expect(getInput('gcmNonceHex').value).toBe(VALID_HEX_24);
    expect(getInput('sha256DigestHex').value).toBe(VALID_HEX_64);
    expect(getInput('fileExtension').value).toBe('.pdf');
  });

  it('pastes JSON with alternative key names', async () => {
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn().mockResolvedValue(JSON.stringify({
          iagonFileId: 'alt-id',
          aesKeyHex: VALID_HEX_64,
          gcmNonceHex: VALID_HEX_24,
          sha256DigestHex: VALID_HEX_64,
          fileExtension: '.mp3',
        })),
      },
    });

    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText('Paste All'));
    });

    expect(getInput('iagonFileId').value).toBe('alt-id');
    expect(getInput('aesKeyHex').value).toBe(VALID_HEX_64);
  });

  it('handles invalid JSON in clipboard gracefully', async () => {
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn().mockResolvedValue('not json'),
      },
    });

    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByText('Paste All'));
    });
    expect(getInput('iagonFileId').value).toBe('');
  });

  // --- Submit Flow ---

  it('submits valid form with trimmed values', async () => {
    renderModal();
    fillValidForm();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Listing'));
    });

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    const [data] = mockOnSubmit.mock.calls[0];
    expect(data.iagonFileId).toBe('abc123');
    expect(data.aesKeyHex).toBe(VALID_HEX_64);
    expect(data.gcmNonceHex).toBe(VALID_HEX_24);
    expect(data.sha256DigestHex).toBe(VALID_HEX_64);
    expect(data.description).toBe('Test listing');
    expect(data.category).toBe('other');
  });

  it('closes modal on successful submit', async () => {
    renderModal();
    fillValidForm();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Listing'));
    });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows submit error on failure', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Transaction failed'));
    renderModal();
    fillValidForm();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Listing'));
    });

    expect(await screen.findByText('Transaction failed')).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('shows generic error for non-Error throws', async () => {
    mockOnSubmit.mockRejectedValueOnce('string error');
    renderModal();
    fillValidForm();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Listing'));
    });

    expect(await screen.findByText('Failed to create listing. Please try again.')).toBeInTheDocument();
  });

  it('does not submit when already submitting', async () => {
    mockOnSubmit.mockImplementation(() => new Promise(() => {})); // never resolves
    renderModal();
    fillValidForm();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Listing'));
    });

    // Try submitting again while still in progress
    await act(async () => {
      fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    });

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
  });

  // --- Close Behavior ---

  it('calls onClose when Cancel is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByRole('dialog').querySelector('[aria-hidden="true"]')!);
    expect(mockOnClose).toHaveBeenCalled();
  });

  // --- Form Reset ---

  it('resets form when modal reopens', () => {
    const { rerender } = render(
      <ModalProvider>
        <ImportListingModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      </ModalProvider>,
    );

    fireEvent.change(getInput('iagonFileId'), { target: { name: 'iagonFileId', value: 'test-id' } });
    expect(getInput('iagonFileId').value).toBe('test-id');

    // Close
    rerender(
      <ModalProvider>
        <ImportListingModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      </ModalProvider>,
    );

    // Reopen
    rerender(
      <ModalProvider>
        <ImportListingModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
      </ModalProvider>,
    );

    expect(getInput('iagonFileId').value).toBe('');
  });

  // --- Price Validation ---

  it('validates price must be positive', async () => {
    renderModal();
    const input = getInput('import-suggestedPrice');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { name: 'suggestedPrice', value: '-5' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Price must be a positive number')).toBeInTheDocument();
  });

  it('clamps price to Cardano max supply (45B ADA)', () => {
    renderModal();
    const input = getInput('import-suggestedPrice');
    fireEvent.change(input, { target: { name: 'suggestedPrice', value: '99999999999' } });
    expect(input.value).toBe('45000000000');
  });

  // --- Description Validation ---

  it('validates description length limit', async () => {
    renderModal();
    const input = getInput('import-description');
    fireEvent.change(input, { target: { name: 'description', value: 'x'.repeat(501) } });
    fireEvent.blur(input);
    expect(await screen.findByText('Description must be less than 500 characters')).toBeInTheDocument();
  });

  it('shows character count', () => {
    renderModal();
    expect(screen.getByText('0/500 characters')).toBeInTheDocument();
    fireEvent.change(getInput('import-description'), { target: { name: 'description', value: 'hello' } });
    expect(screen.getByText('5/500 characters')).toBeInTheDocument();
  });
});
