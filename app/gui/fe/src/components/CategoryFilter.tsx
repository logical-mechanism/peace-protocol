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
// Today: flat list from FILE_CATEGORIES. When subcategories arrive,
// build a tree here and the recursive renderer below handles it.

function buildCategoryTree(): CategoryNode[] {
  return FILE_CATEGORIES.filter((c) => c.enabled).map((c: CategoryConfig) => ({
    id: c.id,
    label: c.label,
    // children: [] — add subcategories here later
  }));
}

const CATEGORY_TREE = buildCategoryTree();

// ── Helpers ──────────────────────────────────────────────────────

function getAllLeafIds(nodes: CategoryNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      ids.push(...getAllLeafIds(node.children));
    } else {
      ids.push(node.id);
    }
  }
  return ids;
}

const ALL_LEAF_IDS = getAllLeafIds(CATEGORY_TREE);

function isAllSelected(selected: string[]): boolean {
  return selected.includes('all') || selected.length === ALL_LEAF_IDS.length;
}

function getLabel(selected: string[]): string {
  if (isAllSelected(selected)) return 'All Categories';
  if (selected.length === 1) {
    const match = ALL_LEAF_IDS.includes(selected[0])
      ? FILE_CATEGORIES.find((c) => c.id === selected[0])
      : undefined;
    return match ? match.label : '1 Category';
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

  function handleToggleLeaf(id: string) {
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
      if (next.length === ALL_LEAF_IDS.length) {
        onChange(['all']);
      } else {
        onChange(next);
      }
    }
  }

  function renderNode(node: CategoryNode, depth: number = 0) {
    const hasChildren = node.children && node.children.length > 0;
    const isLeaf = !hasChildren;

    if (isLeaf) {
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
            onChange={() => handleToggleLeaf(node.id)}
            className="accent-[var(--accent)]"
          />
          {node.label}
        </label>
      );
    }

    // Parent node with children — future subcategory support
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)]"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {node.label}
        </div>
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
