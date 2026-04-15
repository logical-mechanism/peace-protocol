import { useState, useEffect, useRef, memo } from 'react';
import { FILE_CATEGORIES, type CategoryConfig } from '../config/categories';

// ── Types ────────────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  label: string;
  children?: CategoryNode[];
}

interface CategoryFilterProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

// ── Category tree ────────────────────────────────────────────────

function buildCategoryTree(): CategoryNode[] {
  return FILE_CATEGORIES.filter((c) => c.enabled).map((c: CategoryConfig) => ({
    id: c.id,
    label: c.label,
    children: c.subcategories?.map((sub) => ({
      id: `${c.id}:${sub.id}`,
      label: sub.label,
      children: sub.children?.map((child) => ({
        id: `${c.id}:${sub.id}:${child.id}`,
        label: child.label,
      })),
    })),
  }));
}

const CATEGORY_TREE = buildCategoryTree();

// ── Helpers ──────────────────────────────────────────────────────

/** Get all top-level category IDs (for "all selected" detection). */
function getTopLevelIds(nodes: CategoryNode[]): string[] {
  return nodes.map((n) => n.id);
}

const TOP_LEVEL_IDS = getTopLevelIds(CATEGORY_TREE);

function isAllSelected(selected: string[]): boolean {
  return selected.includes('all') || selected.length === TOP_LEVEL_IDS.length;
}

function getLabel(selected: string[]): string {
  if (isAllSelected(selected)) return 'All Categories';
  if (selected.length === 1) {
    const id = selected[0];
    // Check top-level
    const topMatch = FILE_CATEGORIES.find((c) => c.id === id);
    if (topMatch) return topMatch.label;
    // Check sub-category (e.g. "audio:music")
    const parts = id.split(':');
    if (parts.length > 1) {
      const parent = FILE_CATEGORIES.find((c) => c.id === parts[0]);
      const sub = parent?.subcategories?.find((s) => s.id === parts[1]);
      if (parent && sub) return `${parent.label} > ${sub.label}`;
    }
    return '1 Category';
  }
  return `${selected.length} Categories`;
}

// ── Component ────────────────────────────────────────────────────

function CategoryFilter({ selected, onChange }: CategoryFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open]);

  const allChecked = isAllSelected(selected);

  function handleToggleAll() {
    onChange(['all']);
  }

  function handleToggleNode(id: string) {
    if (allChecked) {
      // Switching from "all" to just this one
      onChange([id]);
      return;
    }

    if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id);
      if (next.length === 0) {
        onChange(['all']);
      } else {
        onChange(next);
      }
    } else {
      const next = [...selected, id];
      // Check if all top-level are now selected
      if (TOP_LEVEL_IDS.every((tid) => next.includes(tid))) {
        onChange(['all']);
      } else {
        onChange(next);
      }
    }
  }

  function renderNode(node: CategoryNode, depth: number = 0) {
    const hasChildren = node.children && node.children.length > 0;

    if (!hasChildren) {
      // Leaf node (subcategory like "audio:music")
      const checked = allChecked || selected.includes(node.id);
      return (
        <label
          key={node.id}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={() => handleToggleNode(node.id)}
            className="accent-[var(--accent)]"
          />
          {node.label}
        </label>
      );
    }

    // Parent node with children — selectable top-level + expandable subcategories
    const parentChecked = allChecked || selected.includes(node.id);
    return (
      <div key={node.id}>
        <label
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <input
            type="checkbox"
            checked={parentChecked}
            onChange={() => handleToggleNode(node.id)}
            className="accent-[var(--accent)]"
          />
          {node.label}
        </label>
        {node.children!.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
          !allChecked
            ? 'bg-[var(--accent-muted)] text-[var(--accent)] border-[var(--accent)]'
            : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-primary)]'
        }`}
        aria-label="Filter by category"
        aria-expanded={open}
      >
        <span>{getLabel(selected)}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 py-1 min-w-[180px] bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)]">
          {/* All toggle */}
          <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={handleToggleAll}
              className="accent-[var(--accent)]"
            />
            All
          </label>
          <div className="border-t border-[var(--border-subtle)] my-1" />
          {/* Category tree */}
          {CATEGORY_TREE.map((node) => renderNode(node))}
        </div>
      )}
    </div>
  );
}

export default memo(CategoryFilter);
