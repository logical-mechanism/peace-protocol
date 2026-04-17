import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { getSubcategories, getCategoryConfig, type FileCategory, type SubCategory } from '../config/categories';
import Select, { type SelectOption } from './Select';

interface SubCategorySelectorProps {
  category: FileCategory;
  selected: string;
  onChange: (subcategory: string) => void;
  disabled?: boolean;
}

const ChildChevron = (
  <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

function toOptions(items: SubCategory[]): SelectOption[] {
  return items.map((s) => ({
    value: s.id,
    label: s.label,
    trailing: s.children && s.children.length > 0 ? ChildChevron : undefined,
  }));
}

function SubCategorySelector({ category, selected, onChange, disabled }: SubCategorySelectorProps) {
  const { t } = useTranslation('dashboard');
  const subcategories = getSubcategories(category);

  if (subcategories.length === 0) return null;

  const selectedParts = selected ? selected.split(':') : [];
  const level1Id = selectedParts[0] || '';
  const level2Id = selectedParts[1] || '';

  const level1Item = subcategories.find((s) => s.id === level1Id);
  const level2Items = level1Item?.children ?? [];

  const categoryConfig = getCategoryConfig(category);

  const handleLevel1Select = (id: string) => {
    onChange(id);
  };

  const handleLevel2Select = (id: string) => {
    onChange(`${level1Id}:${id}`);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const handleClearLevel2 = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(level1Id);
  };

  const breadcrumbParts: string[] = [];
  if (categoryConfig) breadcrumbParts.push(categoryConfig.label);
  if (level1Item) breadcrumbParts.push(level1Item.label);
  if (level2Id) {
    const level2Item = level2Items.find((c) => c.id === level2Id);
    breadcrumbParts.push(level2Item?.label ?? level2Id);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
        {t('filters.subcategory.label')} <span className="text-xs font-normal text-[var(--text-muted)]">{t('filters.subcategory.optional')}</span>
      </label>

      {level1Id && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {breadcrumbParts.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <svg className="w-3 h-3 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                {label}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={level2Id ? handleClearLevel2 : handleClear}
            disabled={disabled}
            className="ml-1 p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer disabled:cursor-not-allowed"
            aria-label={level2Id ? t('filters.subcategory.clearGenre') : t('filters.subcategory.clearSubcategory')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <Select
        value={level1Id}
        options={toOptions(subcategories)}
        onChange={handleLevel1Select}
        placeholder="None"
        disabled={disabled}
        ariaLabel="Sub-category"
      />

      {level1Id && level2Items.length > 0 && (
        <div className="mt-2">
          <Select
            value={level2Id}
            options={toOptions(level2Items)}
            onChange={handleLevel2Select}
            placeholder="None"
            disabled={disabled}
            ariaLabel="Sub-category level 2"
          />
        </div>
      )}
    </div>
  );
}

export default memo(SubCategorySelector);
