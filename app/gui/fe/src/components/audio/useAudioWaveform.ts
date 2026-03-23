import { useState, useRef, useEffect, useCallback } from 'react';
import { decodeAudioWaveform, decodeAudioWaveformFast, decodeAudioMetadata } from '../../services/libraryService';
import { normalizeWaveform, upsampleWaveform } from './audioPlayerUtils';
import { CANVAS_W, CANVAS_H, WAVEFORM_CENTER_RATIO, WAVEFORM_MAX_BAR_RATIO, WAVEFORM_REFLECTION_ALPHA } from './audioConstants';
import type { AudioMetadata } from './audioTypes';

export function useAudioWaveform(tokenName: string, category: string) {
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [vizFailed, setVizFailed] = useState(false);
  const [waveformDuration, setWaveformDuration] = useState(0);

  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformDataRef = useRef<Float32Array | null>(null);
  const rawWaveformRef = useRef<Float32Array | null>(null);
  const canvasWidthRef = useRef(CANVAS_W);
  const lastDrawnPixelRef = useRef(-1);
  const dprRef = useRef(window.devicePixelRatio || 1);
  const drawWaveformRef = useRef<((progress: number) => void) | null>(null);
  const lastProgressRef = useRef(0);
  const gradientColorsRef = useRef({
    waveformPlayed: 'rgba(34, 211, 238, 0.6)', waveformUnplayed: 'rgba(34, 211, 238, 0.15)',
    indicator: 'rgba(250, 250, 250, 0.9)', indicatorGlow: 'rgba(250, 250, 250, 0.3)',
  });

  /** Re-upsample raw waveform to match current canvas width. */
  const resampleToWidth = useCallback((width: number) => {
    const raw = rawWaveformRef.current;
    if (!raw || raw.length === 0) return;
    waveformDataRef.current = raw.length === width ? raw : upsampleWaveform(raw, width);
    lastDrawnPixelRef.current = -1;
    drawWaveformRef.current?.(lastProgressRef.current);
  }, []);

  // Cache CSS gradient colors + scale canvas for HiDPI + responsive resize
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const readColors = () => {
      const styles = getComputedStyle(canvas);
      gradientColorsRef.current = {
        waveformPlayed: styles.getPropertyValue('--waveform-played').trim() || 'rgba(34, 211, 238, 0.6)',
        waveformUnplayed: styles.getPropertyValue('--waveform-unplayed').trim() || 'rgba(34, 211, 238, 0.15)',
        indicator: styles.getPropertyValue('--waveform-indicator').trim() || 'rgba(250, 250, 250, 0.9)',
        indicatorGlow: styles.getPropertyValue('--waveform-indicator-glow').trim() || 'rgba(250, 250, 250, 0.3)',
      };
    };

    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : CANVAS_W;
      if (w <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      canvasWidthRef.current = w;
      canvas.width = w * dpr;
      canvas.height = CANVAS_H * dpr;
      resampleToWidth(w);
    };

    readColors();
    resizeCanvas();

    // Theme change → repaint with new colors
    const themeObserver = new MutationObserver(() => {
      readColors();
      drawWaveformRef.current?.(lastProgressRef.current);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Container resize → re-scale canvas + re-upsample waveform
    const parent = canvas.parentElement;
    let resizeObserver: ResizeObserver | undefined;
    if (parent) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(parent);
    }

    return () => {
      themeObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [resampleToWidth]);

  // Reset state when inputs change (render-time pattern)
  const [prevKey, setPrevKey] = useState({ tokenName, category });
  if (prevKey.tokenName !== tokenName || prevKey.category !== category) {
    setPrevKey({ tokenName, category });
    setVizFailed(false);
    setMetadata(null);
  }

  // Decode waveform data from Rust
  useEffect(() => {
    let cancelled = false;
    waveformDataRef.current = null;
    rawWaveformRef.current = null;
    lastDrawnPixelRef.current = -1;

    async function loadVisualizationData() {
      // Fast low-res waveform (<1s)
      try {
        const fast = await decodeAudioWaveformFast(tokenName, category);
        if (cancelled) return;
        const normalized = normalizeWaveform(new Float32Array(fast.waveform));
        rawWaveformRef.current = normalized;
        waveformDataRef.current = upsampleWaveform(normalized, canvasWidthRef.current);
        setVizFailed(false);
        drawWaveformRef.current?.(0);
      } catch {
        // Fast decode failed — continue to full decode
      }

      // Full waveform + metadata in parallel (metadata no longer blocks canvas)
      const waveformPromise = decodeAudioWaveform(tokenName, category);
      const metadataPromise = decodeAudioMetadata(tokenName, category);

      // Handle waveform
      try {
        const result = await waveformPromise;
        if (cancelled) return;
        const waveform = normalizeWaveform(new Float32Array(result.waveform));
        rawWaveformRef.current = waveform;
        waveformDataRef.current = waveform.length === canvasWidthRef.current
          ? waveform
          : upsampleWaveform(waveform, canvasWidthRef.current);
        setVizFailed(false);
        if (result.durationSecs > 0) setWaveformDuration(result.durationSecs);
        drawWaveformRef.current?.(0);
      } catch {
        if (!cancelled) setVizFailed(true);
      }

      // Handle metadata (independent of waveform)
      try {
        const meta = await metadataPromise;
        if (cancelled) return;
        if (meta.title || meta.artist || meta.album || meta.sampleRate || meta.bitrate) {
          setMetadata({
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            trackNumber: meta.trackNumber,
            year: meta.year,
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            bitrate: meta.bitrate,
            picture: meta.picture
              ? { data: new Uint8Array(meta.picture.data), format: meta.picture.format }
              : null,
          });
        }
      } catch {
        // Metadata extraction failed — player still works, just no tags
      }
    }

    loadVisualizationData();

    return () => {
      cancelled = true;
      waveformDataRef.current = null;
      rawWaveformRef.current = null;
      lastDrawnPixelRef.current = -1;
    };
  }, [tokenName, category]);

  // Waveform drawing callback — mirrored bars with gradient transition
  const drawWaveform = useCallback((progressRatio: number) => {
    lastProgressRef.current = progressRatio;
    const canvas = waveformCanvasRef.current;
    const waveform = waveformDataRef.current;
    if (!canvas || !waveform || waveform.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvasWidthRef.current;
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, CANVAS_H);

    const totalBarW = cw / waveform.length;
    const barW = totalBarW * 0.7;
    const gap = totalBarW * 0.3;
    const mid = CANVAS_H * WAVEFORM_CENTER_RATIO;
    const maxBarH = mid * WAVEFORM_MAX_BAR_RATIO;
    const reflectionAlpha = WAVEFORM_REFLECTION_ALPHA;
    const { waveformPlayed, waveformUnplayed, indicator, indicatorGlow } = gradientColorsRef.current;

    for (let i = 0; i < waveform.length; i++) {
      const h = Math.max(1, waveform[i] * maxBarH);
      const x = i * totalBarW + gap * 0.5;
      const isPlayed = (i / waveform.length) <= progressRatio;
      const color = isPlayed ? waveformPlayed : waveformUnplayed;

      // Main bar (above center)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, mid - h, barW, h, [barW * 0.4, barW * 0.4, 0, 0]);
      ctx.fill();

      // Below-center bar (no rounding on top)
      ctx.beginPath();
      ctx.roundRect(x, mid, barW, h, [0, 0, barW * 0.4, barW * 0.4]);
      ctx.fill();

      // Reflection (faded mirror below main)
      ctx.globalAlpha = reflectionAlpha;
      ctx.beginPath();
      ctx.roundRect(x, mid + h, barW, h * 0.5, [0, 0, barW * 0.3, barW * 0.3]);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Playhead indicator — thin line with radial glow
    if (progressRatio > 0) {
      const indicatorX = Math.round(progressRatio * cw);

      // Radial glow
      const glow = ctx.createRadialGradient(indicatorX, mid, 0, indicatorX, mid, 16);
      glow.addColorStop(0, indicatorGlow);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(indicatorX - 16, mid - 16, 32, 32);

      // Thin line
      ctx.fillStyle = indicator;
      ctx.fillRect(indicatorX - 0.5, 0, 1.5, CANVAS_H);
    }
  }, []);

  // Keep ref in sync for the effect
  useEffect(() => {
    drawWaveformRef.current = drawWaveform;
  });

  /** Update waveform progress — skips redraw if pixel position unchanged. */
  const updateProgress = useCallback((currentTime: number, duration: number) => {
    if (!waveformDataRef.current || duration <= 0) return;
    const progress = currentTime / duration;
    const px = Math.round(progress * canvasWidthRef.current);
    if (px !== lastDrawnPixelRef.current) {
      lastDrawnPixelRef.current = px;
      drawWaveform(progress);
    }
  }, [drawWaveform]);

  /** Force a waveform redraw (e.g., after seek). */
  const forceRedraw = useCallback(() => {
    lastDrawnPixelRef.current = -1;
  }, []);

  return {
    waveformCanvasRef,
    metadata,
    vizFailed,
    waveformDuration,
    drawWaveform,
    updateProgress,
    forceRedraw,
    hasWaveformData: useCallback(() => waveformDataRef.current !== null, []),
  };
}
