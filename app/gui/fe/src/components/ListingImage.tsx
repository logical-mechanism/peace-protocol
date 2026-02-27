import { useState, useEffect, useRef } from 'react';
import { DelayedSpinner } from './LoadingSpinner';
import { downloadImage, getCachedImage, banImage, unbanImage } from '../services/imageCache';

type ImageState = 'no-link' | 'default' | 'loading' | 'loaded' | 'banned';

interface ListingImageProps {
  tokenName: string;
  imageLink?: string;
  size: 'sm' | 'md';
  initialCached?: boolean;
  initialBanned?: boolean;
}

export default function ListingImage({
  tokenName,
  imageLink,
  size,
  initialCached = false,
  initialBanned = false,
}: ListingImageProps) {
  const [state, setState] = useState<ImageState>(() => {
    if (!imageLink) return 'no-link';
    if (initialBanned) return 'banned';
    if (initialCached) return 'loading'; // will load from cache
    return 'default';
  });
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Load cached image on mount if initialCached
  useEffect(() => {
    if (!initialCached || initialBanned || !imageLink) return;
    let cancelled = false;

    getCachedImage(tokenName)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setDataUrl(`data:${result.content_type};base64,${result.base64}`);
          setState('loaded');
        } else {
          setState('default');
        }
      })
      .catch(() => {
        if (!cancelled) setState('default');
      });

    return () => {
      cancelled = true;
    };
  }, [tokenName, initialCached, initialBanned, imageLink]);

  const handleClick = async () => {
    if (state !== 'default' || !imageLink) return;

    setState('loading');
    try {
      const result = await downloadImage(tokenName, imageLink);
      setDataUrl(`data:${result.content_type};base64,${result.base64}`);
      setState('loaded');
    } catch (err) {
      console.error(`Failed to download image for ${tokenName}:`, err);
      setState('default');
    }
  };

  const handleBan = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await banImage(tokenName);
      setState('banned');
      setDataUrl(null);
    } catch (err) {
      console.error(`Failed to ban image for ${tokenName}:`, err);
    }
  };

  const handleUnban = async () => {
    try {
      await unbanImage(tokenName);
      setState('default');
    } catch (err) {
      console.error(`Failed to unban image for ${tokenName}:`, err);
    }
  };

  // Auto-download when scrolled into view (replaces click-to-load)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== 'default' || !imageLink) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleClick();
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, imageLink]);

  // Lock icon for no-link state
  if (state === 'no-link') {
    if (size === 'sm') {
      return (
        <div className="w-10 h-10 rounded-full bg-[var(--accent-muted)] flex items-center justify-center flex-shrink-0">
          <svg
            className="w-5 h-5 text-[var(--accent)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
      );
    }
    return (
      <div className="w-full h-40 rounded-[var(--radius-md)] flex items-center justify-center my-4 bg-[var(--bg-secondary)]">
        <div className="w-14 h-14 rounded-full bg-[var(--accent-muted)] flex items-center justify-center">
          <svg
            className="w-7 h-7 text-[var(--accent)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Compact (sm) variant
  if (size === 'sm') {
    return (
      <div ref={containerRef} className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 relative group">
        {state === 'default' && (
          <img
            loading="lazy"
            src="/default.png"
            alt="Loading preview"
            className="w-full h-full object-cover blur-sm cursor-pointer"
            onClick={handleClick}
          />
        )}
        {state === 'loading' && (
          <div className="w-full h-full bg-[var(--bg-secondary)] flex items-center justify-center">
            <DelayedSpinner size="sm" label="Loading image" />
          </div>
        )}
        {state === 'loaded' && dataUrl && (
          <img
            loading="lazy"
            src={dataUrl}
            alt="Listing preview"
            className="w-full h-full object-cover"
          />
        )}
        {state === 'banned' && (
          <img
            loading="lazy"
            src="/banned.png"
            alt="Banned image"
            className="w-full h-full object-cover cursor-pointer"
            onClick={handleUnban}
            title="Click to unban"
          />
        )}
      </div>
    );
  }

  // Grid (md) variant
  return (
    <div ref={containerRef} className="w-full h-40 rounded-[var(--radius-md)] overflow-hidden relative group my-4 bg-[var(--bg-secondary)]">
      {state === 'default' && (
        <img
          loading="lazy"
          src="/default.png"
          alt="Loading preview"
          className="w-full h-full object-cover blur-sm cursor-pointer transition-all duration-[var(--transition-fast)] hover:blur-xs"
          onClick={handleClick}
        />
      )}

      {state === 'loading' && (
        <>
          <img
            loading="lazy"
            src="/default.png"
            alt="Loading..."
            className="w-full h-full object-cover blur-sm"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <DelayedSpinner size="lg" label="Downloading image" />
          </div>
        </>
      )}

      {state === 'loaded' && dataUrl && (
        <>
          <img
            loading="lazy"
            src={dataUrl}
            alt="Listing preview"
            className="w-full h-full object-cover"
          />
          {/* Ban button — visible on hover */}
          <button
            onClick={handleBan}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-[var(--error)] transition-all duration-[var(--transition-fast)] opacity-0 group-hover:opacity-100 cursor-pointer"
            title="Ban this image"
            aria-label="Ban this image"
          >
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </>
      )}

      {state === 'banned' && (
        <img
          loading="lazy"
          src="/banned.png"
          alt="Banned image"
          className="w-full h-full object-cover cursor-pointer"
          onClick={handleUnban}
          title="Click to unban this image"
        />
      )}
    </div>
  );
}
