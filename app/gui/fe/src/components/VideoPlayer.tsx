import { useState, useEffect, useRef, useCallback } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface VideoPlayerProps {
  data: Uint8Array;
  mimeType: string;
  fileExtension: string;
}

/** Try to remux an unsupported container to MP4 via ffmpeg.wasm (lazy-loaded). */
async function remuxToMp4(data: Uint8Array, inputName: string): Promise<Uint8Array> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');

  const ffmpeg = new FFmpeg();

  // Load the single-threaded WASM core from CDN via blob URLs
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  await ffmpeg.writeFile(inputName, data);
  await ffmpeg.exec(['-i', inputName, '-c', 'copy', 'output.mp4']);
  const output = await ffmpeg.readFile('output.mp4');
  await ffmpeg.terminate();

  if (output instanceof Uint8Array) return output;
  // readFile can return a string for text files; shouldn't happen for video
  throw new Error('Unexpected output type from ffmpeg');
}

export default function VideoPlayer({ data, mimeType, fileExtension }: VideoPlayerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remuxing, setRemuxing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Probe whether the browser can play the blob directly; if not, remux.
  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    const videoEl = videoRef.current;

    const revokeUrl = () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    };

    (async () => {
      // First attempt: create blob URL and see if a probe <video> can play it
      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      const url = URL.createObjectURL(blob);
      currentUrl = url;

      const canPlay = await new Promise<boolean>((resolve) => {
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.muted = true;
        const cleanup = () => {
          probe.removeAttribute('src');
          probe.load();
        };
        probe.addEventListener('loadedmetadata', () => { cleanup(); resolve(true); }, { once: true });
        probe.addEventListener('error', () => { cleanup(); resolve(false); }, { once: true });
        probe.src = url;
      });

      if (cancelled) { revokeUrl(); return; }

      if (canPlay) {
        setBlobUrl(url);
        return;
      }

      // The browser can't play this format natively — try remuxing
      revokeUrl();
      setRemuxing(true);

      try {
        const inputName = `input${fileExtension}`;
        const mp4Bytes = await remuxToMp4(new Uint8Array(data), inputName);
        if (cancelled) return;
        const mp4Blob = new Blob([mp4Bytes], { type: 'video/mp4' });
        const mp4Url = URL.createObjectURL(mp4Blob);
        currentUrl = mp4Url;
        setBlobUrl(mp4Url);
      } catch {
        if (cancelled) return;
        setError('This video format could not be converted for in-app playback.');
        setLoading(false);
      } finally {
        if (!cancelled) {
            setRemuxing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      revokeUrl();
    };
  }, [data, mimeType, fileExtension]);

  // Escape key closes fullscreen (not the parent modal)
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    // Use capture phase so we intercept before the modal's escape handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullscreen]);

  const handleLoadedMetadata = useCallback(() => setLoading(false), []);
  const handleError = useCallback(() => {
    setLoading(false);
    setError('The video could not be played.');
  }, []);

  if (error) {
    return (
      <div className="p-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-center space-y-2">
        <svg className="w-8 h-8 mx-auto mb-2 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-[var(--error)]">Failed to play video</p>
        <p className="text-xs text-[var(--text-muted)]">
          This format may not be supported for in-app playback. Use Save As to open it with an external player.
        </p>
      </div>
    );
  }

  if (remuxing) {
    return (
      <div className="py-12 text-center">
        <LoadingSpinner size="lg" className="mx-auto mb-4" />
        <p className="text-sm text-[var(--text-muted)]">Converting for playback...</p>
      </div>
    );
  }

  const btnClass = "px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all duration-150 cursor-pointer";

  const toolbar = (
    <div className="flex items-center justify-end">
      <button
        onClick={() => setIsFullscreen(fs => !fs)}
        className={btnClass}
        title={isFullscreen ? 'Exit fullscreen' : 'Expand'}
      >
        {isFullscreen ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m7 5l5-5m0 0v4m0-4h-4m-7 7l-5 5m0 0v-4m0 4h4m7-5l5 5m0 0v-4m0 4h-4" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5m-7 14l-5 5m0 0h4m-4 0v-4m16 4l-5-5m5 5v-4m0 4h-4" />
          </svg>
        )}
      </button>
    </div>
  );

  const videoElement = blobUrl ? (
    <video
      ref={videoRef}
      src={blobUrl}
      controls
      className={isFullscreen
        ? "max-w-full max-h-full"
        : "max-w-full max-h-[500px]"
      }
      onLoadedMetadata={handleLoadedMetadata}
      onError={handleError}
    />
  ) : null;

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <>
        {/* Inline placeholder so LibraryContentModal layout isn't disrupted */}
        <div className="p-4 text-center text-sm text-[var(--text-muted)]">
          Video is expanded to fullscreen. Press Esc or the collapse button to return.
        </div>

        {/* Fullscreen overlay */}
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg-primary)]">
          {/* Toolbar */}
          <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
            {toolbar}
          </div>

          {/* Video content area */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
            {videoElement}
          </div>
        </div>
      </>
    );
  }

  // Normal inline view
  return (
    <div className="space-y-3">
      {toolbar}
      <div className="flex items-center justify-center overflow-auto max-h-[500px] bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2">
        {loading && blobUrl && (
          <div className="py-12 text-center">
            <LoadingSpinner size="lg" className="mx-auto mb-4" />
            <p className="text-sm text-[var(--text-muted)]">Loading video...</p>
          </div>
        )}
        {videoElement}
      </div>
    </div>
  );
}
