import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CreateListingModal from '../CreateListingModal';
import { ModalProvider } from '../../contexts/ModalContext';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockGetDraft = vi.fn();
const mockSaveDraft = vi.fn();
const mockClearDraft = vi.fn();
vi.mock('../../services/listingFormDraftStorage', () => ({
  getListingFormDraft: () => mockGetDraft(),
  saveListingFormDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearListingFormDraft: () => mockClearDraft(),
}));

vi.mock('../../config/categories', () => ({
  getCategoryConfig: (id: string) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }),
  detectCategoryFromExtension: (filename: string) => {
    if (filename.endsWith('.pdf')) return 'document';
    if (filename.endsWith('.mp3')) return 'audio';
    return 'other';
  },
}));

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// --- Test helpers ---

const mockOnClose = vi.fn();
const mockOnSubmit = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSubmit.mockResolvedValue(undefined);
  mockGetDraft.mockReturnValue(null);
});

function renderModal(overrides: Partial<Parameters<typeof CreateListingModal>[0]> = {}) {
  return render(
    <ModalProvider>
      <CreateListingModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        isIagonConnected={true}
        {...overrides}
      />
    </ModalProvider>,
  );
}

describe('CreateListingModal', () => {
  // --- Rendering ---

  it('renders when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create New Listing')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // --- Mode toggle ---

  it('defaults to text mode', () => {
    renderModal();
    expect(screen.getByLabelText(/Secret Message/)).toBeInTheDocument();
  });

  it('switches to file mode when File button is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByText('File'));
    expect(screen.queryByLabelText(/Secret Message/)).not.toBeInTheDocument();
    // File upload area should appear
    expect(screen.getByText(/Click or drag a file here/)).toBeInTheDocument();
  });

  it('switches back to text mode and clears file state', () => {
    renderModal();
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Text'));
    expect(screen.getByLabelText(/Secret Message/)).toBeInTheDocument();
  });

  // --- Text validation ---

  it('validates empty secret message on submit', async () => {
    renderModal();
    // Fill description so only secretMessage fails
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Test desc', name: 'description' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Secret message is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('validates secret message over 280 characters', async () => {
    renderModal();
    const longMessage = 'x'.repeat(281);
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: longMessage, name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Test desc', name: 'description' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Message must be 280 characters or less')).toBeInTheDocument();
  });

  it('validates empty description', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'My secret', name: 'secretMessage' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Description is required')).toBeInTheDocument();
  });

  it('validates description over 500 characters', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'x'.repeat(501), name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Description must be less than 500 characters')).toBeInTheDocument();
  });

  // --- Price validation ---

  it('validates negative price', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });
    fireEvent.change(screen.getByLabelText(/Suggested Price/), {
      target: { value: '-5', name: 'suggestedPrice' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Price must be a positive number')).toBeInTheDocument();
  });

  it('validates excessively high price', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });
    fireEvent.change(screen.getByLabelText(/Suggested Price/), {
      target: { value: '9999999999', name: 'suggestedPrice' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Price is too high')).toBeInTheDocument();
  });

  it('allows empty price (optional field)', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
  });

  // --- Image link validation ---

  it('validates invalid URL format for image link', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });
    fireEvent.change(screen.getByLabelText(/Image Link/), {
      target: { value: 'not-a-url', name: 'imageLink' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Invalid URL format')).toBeInTheDocument();
  });

  it('validates non-http protocol for image link', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });
    fireEvent.change(screen.getByLabelText(/Image Link/), {
      target: { value: 'ftp://example.com/image.png', name: 'imageLink' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    expect(await screen.findByText('Image link must use http:// or https://')).toBeInTheDocument();
  });

  // --- Error clearing ---

  it('clears field error when user types in that field', async () => {
    renderModal();
    // Trigger validation error
    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));
    expect(await screen.findByText('Secret message is required')).toBeInTheDocument();

    // Type in the field
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'typing', name: 'secretMessage' },
    });

    expect(screen.queryByText('Secret message is required')).not.toBeInTheDocument();
  });

  // --- Submit flow ---

  it('calls onSubmit with form data and closes on success', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'my secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'A test listing', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'text',
          secretMessage: 'my secret',
          description: 'A test listing',
        }),
        expect.any(Function), // onProgress callback
      );
    });

    expect(mockClearDraft).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows submit error on failure without closing', async () => {
    mockOnSubmit.mockRejectedValue(new Error('Transaction build failed'));

    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(screen.getByText('Transaction build failed')).toBeInTheDocument();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('shows generic error message for non-Error throws', async () => {
    mockOnSubmit.mockRejectedValue('string error');

    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(screen.getByText('Failed to create listing. Please try again.')).toBeInTheDocument();
    });
  });

  // --- Iagon not connected ---

  it('shows Iagon Required overlay in file mode when not connected', () => {
    renderModal({ isIagonConnected: false });
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Iagon Required')).toBeInTheDocument();
  });

  it('disables submit in file mode when Iagon not connected', () => {
    renderModal({ isIagonConnected: false });
    fireEvent.click(screen.getByText('File'));
    const submitBtn = screen.getByRole('button', { name: /Create Listing/ });
    expect(submitBtn).toBeDisabled();
  });

  it('navigates to settings when Go to Settings is clicked in file mode', () => {
    renderModal({ isIagonConnected: false });
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Go to Settings'));
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/settings', { state: { section: 'datalayer' } });
  });

  // --- Draft prompt ---

  it('shows draft prompt when saved draft exists on open', () => {
    mockGetDraft.mockReturnValue({
      category: 'text',
      secretMessage: 'saved secret',
      description: 'saved desc',
      suggestedPrice: '10',
      imageLink: '',
      fileName: null,
      savedAt: new Date().toISOString(),
    });

    renderModal();
    expect(screen.getByText(/You have an unsaved draft/)).toBeInTheDocument();
    expect(screen.getByText('Resume Draft')).toBeInTheDocument();
    expect(screen.getByText('Start Fresh')).toBeInTheDocument();
  });

  it('Resume Draft loads saved form data', () => {
    mockGetDraft.mockReturnValue({
      category: 'text',
      secretMessage: 'saved secret',
      description: 'saved desc',
      suggestedPrice: '25',
      imageLink: '',
      fileName: null,
      savedAt: new Date().toISOString(),
    });

    renderModal();
    fireEvent.click(screen.getByText('Resume Draft'));

    expect((screen.getByLabelText(/Secret Message/) as HTMLTextAreaElement).value).toBe('saved secret');
    expect((screen.getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe('saved desc');
  });

  it('Start Fresh clears draft and shows empty form', () => {
    mockGetDraft.mockReturnValue({
      category: 'text',
      secretMessage: 'saved',
      description: 'desc',
      suggestedPrice: '',
      imageLink: '',
      fileName: null,
      savedAt: new Date().toISOString(),
    });

    renderModal();
    fireEvent.click(screen.getByText('Start Fresh'));

    expect(mockClearDraft).toHaveBeenCalled();
    expect((screen.getByLabelText(/Secret Message/) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe('');
  });

  // --- Close button ---

  it('disables close button during submit', async () => {
    let resolveSubmit: () => void;
    mockOnSubmit.mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));

    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Close dialog')).toBeDisabled();
    });

    // Clean up by resolving
    resolveSubmit!();
  });

  // --- Character count ---

  it('shows character count for secret message', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'hello', name: 'secretMessage' },
    });
    expect(screen.getByText('5/280 characters')).toBeInTheDocument();
  });

  it('shows character count for description', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'test description', name: 'description' },
    });
    expect(screen.getByText(/16\/500 characters/)).toBeInTheDocument();
  });

  // --- Progress step labels ---

  it('shows progress step labels during submission', async () => {
    mockOnSubmit.mockImplementation(
      async (_data: unknown, onProgress?: (step: string) => void) => {
        onProgress?.('encrypting');
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    );

    renderModal();
    fireEvent.change(screen.getByLabelText(/Secret Message/), {
      target: { value: 'secret', name: 'secretMessage' },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'desc', name: 'description' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

    await waitFor(() => {
      expect(screen.getByText('Encrypting file...')).toBeInTheDocument();
    });
  });

  // --- Info box ---

  it('shows info note about transaction signing', () => {
    renderModal();
    expect(screen.getByText(/You'll need to sign a transaction with your wallet/)).toBeInTheDocument();
  });

  it('shows text-specific info in text mode', () => {
    renderModal();
    expect(screen.getByText(/Text data is stored on-chain/)).toBeInTheDocument();
  });

  it('shows file-specific info in file mode', () => {
    renderModal();
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Files are encrypted and uploaded to Iagon decentralized storage.')).toBeInTheDocument();
  });

  // --- maxLength attributes ---

  it('secretMessage textarea has maxLength=280', () => {
    renderModal();
    expect(screen.getByLabelText(/Secret Message/)).toHaveAttribute('maxLength', '280');
  });

  it('description textarea has maxLength=500', () => {
    renderModal();
    expect(screen.getByLabelText(/Description/)).toHaveAttribute('maxLength', '500');
  });

  // --- Blur validation ---

  it('shows error on secretMessage blur when empty', () => {
    renderModal();
    fireEvent.blur(screen.getByLabelText(/Secret Message/));
    expect(screen.getByText('Secret message is required')).toBeInTheDocument();
  });

  it('shows error on description blur when empty', () => {
    renderModal();
    fireEvent.blur(screen.getByLabelText(/Description/));
    expect(screen.getByText('Description is required')).toBeInTheDocument();
  });

  it('shows error on imageLink blur with invalid URL', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Image Link/), {
      target: { value: 'not-a-url', name: 'imageLink' },
    });
    fireEvent.blur(screen.getByLabelText(/Image Link/));
    expect(screen.getByText('Invalid URL format')).toBeInTheDocument();
  });

  it('shows error on price blur with invalid value', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Suggested Price/), {
      target: { value: '-5', name: 'suggestedPrice' },
    });
    fireEvent.blur(screen.getByLabelText(/Suggested Price/));
    expect(screen.getByText('Price must be a positive number')).toBeInTheDocument();
  });

  it('clears error on blur when field becomes valid', () => {
    renderModal();
    // Trigger error
    fireEvent.blur(screen.getByLabelText(/Description/));
    expect(screen.getByText('Description is required')).toBeInTheDocument();

    // Fix the field and blur again
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Valid description', name: 'description' },
    });
    fireEvent.blur(screen.getByLabelText(/Description/));
    expect(screen.queryByText('Description is required')).not.toBeInTheDocument();
  });

  // --- Draft saved indicator ---

  it('shows draft saved indicator after auto-save', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      // Type in description to trigger auto-save
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Test description', name: 'description' },
      });

      // Advance past debounce (500ms) — wrapped in act since it triggers state updates
      act(() => { vi.advanceTimersByTime(500); });

      expect(mockSaveDraft).toHaveBeenCalled();
      expect(screen.getByText('Draft saved')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides draft saved indicator after 1.5s', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Test description', name: 'description' },
      });

      act(() => { vi.advanceTimersByTime(500); }); // debounce fires, "Draft saved" appears
      expect(screen.getByText('Draft saved')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(1500); }); // auto-clear fires
      expect(screen.queryByText('Draft saved')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Unsaved changes warning ---

  it('shows confirm when closing dirty form via Cancel', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderModal();
      // Make the form dirty
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Some text', name: 'description' },
      });

      fireEvent.click(screen.getByText('Cancel'));

      expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Are you sure you want to close?');
      expect(mockOnClose).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('closes when confirm is accepted on dirty form', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderModal();
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'Some text', name: 'description' },
      });

      fireEvent.click(screen.getByText('Cancel'));

      expect(confirmSpy).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('closes without confirm when form is clean', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    try {
      renderModal();
      fireEvent.click(screen.getByText('Cancel'));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('does not show confirm after successful submit', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    try {
      renderModal();
      fireEvent.change(screen.getByLabelText(/Secret Message/), {
        target: { value: 'my secret', name: 'secretMessage' },
      });
      fireEvent.change(screen.getByLabelText(/Description/), {
        target: { value: 'A test listing', name: 'description' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });

      // onClose was called directly without confirm
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
