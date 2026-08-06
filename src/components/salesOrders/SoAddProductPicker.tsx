import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Search } from 'lucide-react';
import { CategoryThumbnail } from '../catalog/CategoryThumbnail';
import { isFreightProductId, isFreightSku } from '../../constants/freightLines';
import { formatCurrency, formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct } from '../../types/catalog';

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export const SoAddProductPicker: React.FC<{
  products: CatalogProduct[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  selectedProductIds?: ReadonlySet<string>;
  productFilter?: (product: CatalogProduct) => boolean;
  onAdd: (product: CatalogProduct) => void;
}> = ({
  products,
  loading = false,
  error = '',
  disabled = false,
  selectedProductIds,
  productFilter,
  onAdd,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 180);

  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => !isFreightProductId(p.id) && !isFreightSku(p.sku))
      .filter(p => (productFilter ? productFilter(p) : true))
      .filter(p => (
        p.name.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
      ))
      .slice(0, 40);
  }, [products, debouncedQuery, productFilter]);

  const showOptions = open && !loading && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pick = (product: CatalogProduct) => {
    onAdd(product);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="so-draft-editor__picker so-detail__add-picker" ref={rootRef} data-capture-ignore="1">
      <label className="so-draft-editor__picker-label" htmlFor="so-detail-product-search">
        Add item
      </label>
      <div className={`so-draft-editor__search${showOptions ? ' is-open' : ''}`}>
        <Search size={16} aria-hidden className="so-draft-editor__search-icon" />
        <input
          ref={inputRef}
          id="so-detail-product-search"
          type="search"
          className="so-draft-editor__search-input"
          placeholder="Search by name or SKU…"
          value={query}
          disabled={disabled || loading}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showOptions}
          aria-controls="so-detail-product-options"
          onFocus={() => {
            if (query.trim().length > 0) setOpen(true);
          }}
          onChange={e => {
            const next = e.target.value;
            setQuery(next);
            setOpen(next.trim().length > 0);
          }}
          onKeyDown={e => {
            if (!showOptions || matches.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex(i => Math.min(i + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(i => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const next = matches[activeIndex];
              if (next) pick(next);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {loading && (
          <Loader2 size={16} className="spin-icon so-draft-editor__spinner" aria-hidden />
        )}
      </div>

      {showOptions && (
        <ul
          id="so-detail-product-options"
          className="so-draft-editor__options"
          role="listbox"
        >
          {error ? (
            <li className="so-draft-editor__option-empty text-sm">{error}</li>
          ) : matches.length === 0 ? (
            <li className="so-draft-editor__option-empty text-muted text-sm">
              No catalog items match.
            </li>
          ) : (
            matches.map((product, index) => {
              const selected = selectedProductIds?.has(product.id);
              return (
                <li key={product.id} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    className={[
                      'so-draft-editor__option',
                      index === activeIndex ? 'is-active' : '',
                      selected ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(product)}
                  >
                    <span className="so-draft-editor__option-media">
                      {product.imageUrl ? (
                        <CategoryThumbnail src={product.imageUrl} knockout={false} />
                      ) : (
                        <span className="so-draft-editor__option-placeholder" aria-hidden>
                          <Package size={18} />
                        </span>
                      )}
                    </span>
                    <span className="so-draft-editor__option-body">
                      <strong>{product.name}</strong>
                      <span className="text-muted text-sm">
                        {[product.sku, product.categoryName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="so-draft-editor__option-meta">
                      <strong>{formatCurrency(product.rate)}</strong>
                      <span className="text-muted text-sm">
                        {formatStockQuantity(product.stock, product.unit)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};
