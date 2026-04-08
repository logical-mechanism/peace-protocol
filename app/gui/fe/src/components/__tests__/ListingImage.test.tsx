import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ListingImage from '../ListingImage';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../LoadingSpinner', () => ({
  DelayedSpinner: ({ label }: { label?: string }) => (
    <div data-testid="spinner">{label ?? 'Loading'}</div>
  ),
}));

const mockDownloadImage = vi.fn();
const mockGetCachedImage = vi.fn();
const mockBanImage = vi.fn();
const mockUnbanImage = vi.fn();

vi.mock('../../services/imageCache', () => ({
  downloadImage: (...args: unknown[]) => mockDownloadImage(...args),
  getCachedImage: (...args: unknown[]) => mockGetCachedImage(...args),
  banImage: (...args: unknown[]) => mockBanImage(...args),
  unbanImage: (...args: unknown[]) => mockUnbanImage(...args),
}));

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
let intersectionCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.clearAllMocks();
  mockObserve.mockReset();
  mockDisconnect.mockReset();

  // @ts-expect-error - mock IntersectionObserver
  globalThis.IntersectionObserver = vi.fn((cb: IntersectionObserverCallback) => {
    intersectionCallback = cb;
    return { observe: mockObserve, disconnect: mockDisconnect, unobserve: vi.fn() };
  });
});

// ── Tests ───────────────────────────────────────────────────────────

describe('ListingImage', () => {
  describe('no-link state', () => {
    it('renders lock icon when no imageLink (sm)', () => {
      const { container } = render(
        <ListingImage tokenName="token1" size="sm" />,
      );
      // Lock icon is an SVG with a path
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders lock icon when no imageLink (md)', () => {
      const { container } = render(
        <ListingImage tokenName="token1" size="md" />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('default state (with imageLink)', () => {
    it('renders blurred default image', () => {
      render(
        <ListingImage tokenName="token1" imageLink="https://example.com/img.png" size="md" />,
      );
      const img = screen.getByAltText('Loading preview');
      expect(img).toHaveAttribute('src', '/default.png');
    });

    it('sets up IntersectionObserver for auto-download', () => {
      render(
        <ListingImage tokenName="token1" imageLink="https://example.com/img.png" size="md" />,
      );
      expect(mockObserve).toHaveBeenCalled();
    });
  });

  describe('loading from cache (deferred)', () => {
    it('does not call getCachedImage on mount — waits for intersection', () => {
      mockGetCachedImage.mockImplementation(() => new Promise(() => {}));
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="sm"
          initialCached
        />,
      );
      // Before intersection, getCachedImage should NOT be called
      expect(mockGetCachedImage).not.toHaveBeenCalled();
      // Should show default state (blurred preview), not spinner
      expect(screen.getByAltText('Loading preview')).toBeInTheDocument();
    });

    it('shows spinner then loaded image after intersection triggers cache fetch', async () => {
      mockGetCachedImage.mockResolvedValue({
        content_type: 'image/png',
        base64: 'abc123',
      });
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
          initialCached
        />,
      );

      // Simulate intersection
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(mockGetCachedImage).toHaveBeenCalledWith('token1');
        expect(screen.getByAltText('Listing preview')).toHaveAttribute(
          'src',
          'data:image/png;base64,abc123',
        );
      });
    });

    it('falls back to default state if cache returns null after intersection', async () => {
      mockGetCachedImage.mockResolvedValue(null);
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
          initialCached
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(screen.getByAltText('Loading preview')).toBeInTheDocument();
      });
    });
  });

  describe('deferred loading: cached vs uncached', () => {
    it('calls getCachedImage (not downloadImage) on intersection when initialCached', async () => {
      mockGetCachedImage.mockResolvedValue({
        content_type: 'image/png',
        base64: 'cached',
      });
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
          initialCached
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(mockGetCachedImage).toHaveBeenCalledWith('token1');
      });
      expect(mockDownloadImage).not.toHaveBeenCalled();
    });

    it('calls downloadImage (not getCachedImage) on intersection when not initialCached', async () => {
      mockDownloadImage.mockResolvedValue({
        content_type: 'image/jpeg',
        base64: 'downloaded',
      });
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(mockDownloadImage).toHaveBeenCalledWith('token1', 'https://example.com/img.png');
      });
      expect(mockGetCachedImage).not.toHaveBeenCalled();
    });
  });

  describe('banned state', () => {
    it('shows banned image when initialBanned', () => {
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
          initialBanned
        />,
      );
      expect(screen.getByAltText('Banned image')).toHaveAttribute('src', '/banned.png');
    });

    it('calls unbanImage on banned image click', async () => {
      mockUnbanImage.mockResolvedValue(undefined);
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
          initialBanned
        />,
      );
      fireEvent.click(screen.getByAltText('Banned image'));
      await waitFor(() => {
        expect(mockUnbanImage).toHaveBeenCalledWith('token1');
      });
    });
  });

  describe('download flow', () => {
    it('downloads image when intersection observer triggers', async () => {
      mockDownloadImage.mockResolvedValue({
        content_type: 'image/jpeg',
        base64: 'downloaded123',
      });
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
        />,
      );

      // Simulate intersection
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(screen.getByAltText('Listing preview')).toHaveAttribute(
          'src',
          'data:image/jpeg;base64,downloaded123',
        );
      });
    });

    it('falls back to default on download error', async () => {
      mockDownloadImage.mockRejectedValue(new Error('Network error'));
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(screen.getByAltText('Loading preview')).toBeInTheDocument();
      });
    });
  });

  describe('ban flow (md loaded state)', () => {
    it('shows ban button on loaded image', async () => {
      mockDownloadImage.mockResolvedValue({
        content_type: 'image/png',
        base64: 'img',
      });
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Ban this image')).toBeInTheDocument();
      });
    });

    it('calls banImage when ban button clicked', async () => {
      mockDownloadImage.mockResolvedValue({
        content_type: 'image/png',
        base64: 'img',
      });
      mockBanImage.mockResolvedValue(undefined);
      render(
        <ListingImage
          tokenName="token1"
          imageLink="https://example.com/img.png"
          size="md"
        />,
      );

      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Ban this image')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText('Ban this image'));

      await waitFor(() => {
        expect(mockBanImage).toHaveBeenCalledWith('token1');
      });
    });
  });
});
