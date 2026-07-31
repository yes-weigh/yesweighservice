import React, { useEffect, useRef } from 'react';
import type { CatalogCategory } from '../../types/catalog';

export interface CatalogCategoryChipsProps {
  categories: CatalogCategory[];
  activeCategoryId: string;
  onSelect: (categoryId: string) => void;
  /** Include the leading “All” chip (default true). */
  showAll?: boolean;
  ariaLabel?: string;
}

/** Horizontal category chips — same UI as the main catalog browse bar. */
export const CatalogCategoryChips: React.FC<CatalogCategoryChipsProps> = ({
  categories,
  activeCategoryId,
  onSelect,
  showAll = true,
  ariaLabel = 'Browse categories',
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const selector = `[data-category="${CSS.escape(activeCategoryId)}"]`;
    const chip = root.querySelector<HTMLElement>(selector);
    if (!chip) return;
    const left = chip.offsetLeft - (root.clientWidth / 2) + (chip.offsetWidth / 2);
    root.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeCategoryId, categories]);

  if (categories.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="catalog-category-chips"
      role="tablist"
      aria-label={ariaLabel}
    >
      {showAll ? (
        <button
          type="button"
          role="tab"
          data-category=""
          aria-selected={!activeCategoryId}
          className={`catalog-category-chips__chip${!activeCategoryId ? ' is-active' : ''}`}
          onClick={() => onSelect('')}
        >
          All
        </button>
      ) : null}
      {categories.map(category => {
        const active = activeCategoryId === category.id;
        return (
          <button
            key={category.id}
            type="button"
            role="tab"
            data-category={category.id}
            aria-selected={active}
            className={`catalog-category-chips__chip${active ? ' is-active' : ''}`}
            onClick={() => onSelect(category.id)}
          >
            <span className="catalog-category-chips__name">{category.name}</span>
            <span className="catalog-category-chips__count">{category.productCount}</span>
          </button>
        );
      })}
    </div>
  );
};
