import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface PriceRangeSliderProps {
  min: number;
  max: number;
  valueMin: string;
  valueMax: string;
  onChangeMin: (value: string) => void;
  onChangeMax: (value: string) => void;
}

function PriceRangeSlider({ min, max, valueMin, valueMax, onChangeMin, onChangeMax }: PriceRangeSliderProps) {
  const { t } = useTranslation('dashboard');
  const effectiveMin = valueMin !== '' ? Number(valueMin) : min;
  const effectiveMax = valueMax !== '' ? Number(valueMax) : max;

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(Number(e.target.value), effectiveMax);
    onChangeMin(val <= min ? '' : String(val));
  }, [min, effectiveMax, onChangeMin]);

  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(Number(e.target.value), effectiveMin);
    onChangeMax(val >= max ? '' : String(val));
  }, [max, effectiveMin, onChangeMax]);

  const range = max - min || 1;
  const leftPercent = ((effectiveMin - min) / range) * 100;
  const rightPercent = ((effectiveMax - min) / range) * 100;

  return (
    <div role="group" aria-label={t('filters.priceRange.groupLabel')} className="flex flex-col gap-1 min-w-[180px]">
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{effectiveMin} ADA</span>
        <span>{effectiveMax} ADA</span>
      </div>
      <div className="relative h-5">
        {/* Track background */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 rounded-full bg-[var(--bg-elevated)]" />
        {/* Active range fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-[var(--accent)]"
          style={{ left: `${leftPercent}%`, width: `${rightPercent - leftPercent}%` }}
        />
        {/* Min thumb */}
        <input
          type="range"
          min={min}
          max={max}
          value={effectiveMin}
          onChange={handleMinChange}
          className="absolute w-full top-0 h-5 appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--bg-primary)]"
          aria-label={t('filters.priceRange.minPrice')}
        />
        {/* Max thumb */}
        <input
          type="range"
          min={min}
          max={max}
          value={effectiveMax}
          onChange={handleMaxChange}
          className="absolute w-full top-0 h-5 appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--bg-primary)]"
          aria-label={t('filters.priceRange.maxPrice')}
        />
      </div>
    </div>
  );
}

export default memo(PriceRangeSlider);
