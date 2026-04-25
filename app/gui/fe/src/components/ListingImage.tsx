import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DelayedSpinner } from './LoadingSpinner';
import { downloadImage, getCachedImage, banImage, unbanImage } from '../services/imageCache';

type ImageState = 'no-link' | 'default' | 'loading' | 'loaded' | 'banned';

interface ListingImageProps {
  tokenName: string;
  imageLink?: string;
  size: 'sm' | 'md';
  initialCached?: boolean;
  initialBanned?: boolean;
  nsfw?: boolean;
  nsfwEnabled?: boolean;
}

export default function ListingImage({
  tokenName,
  imageLink,
  size,
  initialCached = false,
  initialBanned = false,
  nsfw = false,
  nsfwEnabled = false,
}: ListingImageProps) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<ImageState>(() => {
    if (!imageLink) return 'no-link';
    if (initialBanned) return 'banned';
    return 'default';
  });
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [nsfwRevealed, setNsfwRevealed] = useState(false);

  const shouldBlur = nsfw && !nsfwEnabled && !nsfwRevealed;

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

  // Load image when scrolled into view (defers both cached and uncached fetches).
  // NOTE: `state` is intentionally NOT in the dep array — including it caused the
  // effect cleanup to fire on the setState('loading') transition, which set
  // cancelled=true and short-circuited the in-flight getCachedImage promise,
  // leaving cached images stuck on the spinner forever.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!imageLink || initialBanned) return;
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let triggered = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || triggered) return;
        triggered = true;
        observer.disconnect();
        if (initialCached) {
          setState('loading');
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
        } else {
          handleClick();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLink, tokenName, initialCached, initialBanned]);

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
            alt={t('card.loadingPreview')}
            className="w-full h-full object-cover blur-sm cursor-pointer"
            onClick={handleClick}
          />
        )}
        {state === 'loading' && (
          <div className="w-full h-full bg-[var(--bg-secondary)] flex items-center justify-center">
            <DelayedSpinner size="sm" label={t('card.loadingImage')} />
          </div>
        )}
        {state === 'loaded' && dataUrl && (
          <>
            <img
              loading="lazy"
              src={dataUrl}
              alt={t('card.listingPreview')}
              className={`w-full h-full object-cover${shouldBlur ? ' blur-lg cursor-pointer' : ''}`}
              onClick={shouldBlur ? () => setNsfwRevealed(true) : undefined}
            />
            {shouldBlur && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[6px] font-bold text-white bg-[var(--error)] px-1 rounded">{t('card.nsfwBadge')}</span>
              </div>
            )}
          </>
        )}
        {state === 'banned' && (
          <img
            loading="lazy"
            src="/banned.png"
            alt={t('card.bannedImage')}
            className="w-full h-full object-cover cursor-pointer"
            onClick={handleUnban}
            title={t('card.bannedClickToUnbanShort')}
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
          alt={t('card.loadingPreview')}
          className="w-full h-full object-cover blur-sm cursor-pointer transition-all duration-[var(--transition-fast)] hover:blur-xs"
          onClick={handleClick}
        />
      )}

      {state === 'loading' && (
        <>
          <img
            loading="lazy"
            src="/default.png"
            alt={t('card.loadingText')}
            className="w-full h-full object-cover blur-sm"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <DelayedSpinner size="lg" label={t('card.downloadingImage')} />
          </div>
        </>
      )}

      {state === 'loaded' && dataUrl && (
        <>
          <img
            loading="lazy"
            src={dataUrl}
            alt={t('card.listingPreview')}
            className={`w-full h-full object-cover${shouldBlur ? ' blur-xl' : ''}`}
          />
          {shouldBlur && (
            <button
              onClick={() => setNsfwRevealed(true)}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 cursor-pointer"
              aria-label={t('card.nsfwReveal')}
            >
              <span className="px-2 py-0.5 text-xs font-bold text-white bg-[var(--error)] rounded">{t('card.nsfwBadge')}</span>
              <span className="text-[10px] text-white/70 mt-1">{t('card.nsfwRevealHint')}</span>
            </button>
          )}
          {/* Ban button — visible on hover */}
          {!shouldBlur && (
            <button
              onClick={handleBan}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-[var(--error)] transition-all duration-[var(--transition-fast)] opacity-0 group-hover:opacity-100 cursor-pointer"
              title={t('card.banImage')}
              aria-label={t('card.banImage')}
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
          )}
        </>
      )}

      {state === 'banned' && (
        <img
          loading="lazy"
          src="/banned.png"
          alt={t('card.bannedImage')}
          className="w-full h-full object-cover cursor-pointer"
          onClick={handleUnban}
          title={t('card.bannedClickToUnban')}
        />
      )}
    </div>
  );
}
