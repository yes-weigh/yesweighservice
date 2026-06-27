import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Search } from 'lucide-react';
import type { CatalogProduct } from '../../types/catalog';
import { ProductImageFrame } from '../catalog/ProductImageFrame';

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface CatalogProductLinkPickerProps {
  products: CatalogProduct[];
  value: CatalogProduct | null;
  onChange: (product: CatalogProduct | null) => void;
  disabled?: boolean;
  loading?: boolean;
}

export const CatalogProductLinkPicker: React.FC<CatalogProductLinkPickerProps> = ({
  products,
  value,
  onChange,
  disabled,
  loading,
}) => {
  const [query, setQuery] = useState(() =>
    value ? [value.sku, value.name].filter(Boolean).join(' · ') : '',
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (value) {
      setQuery([value.sku, value.name].filter(Boolean).join(' · '));
    }
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 12);
    return products
      .filter(
        p =>
          p.name.toLowerCase().includes(q)
          || (p.sku ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [products, debouncedQuery]);

  const pickProduct = (product: CatalogProduct) => {
    onChange(product);
    setQuery([product.sku, product.name].filter(Boolean).join(' · '));
    setOpen(false);
  };

  return (
    <div className="catalog-product-link-picker" ref={rootRef}>
      <label className="catalog-product-link-picker__label" htmlFor="catalog-product-link-search">
        SKU / item name
      </label>
      <div className={`catalog-product-link-picker__field${open ? ' is-open' : ''}`}>
        <Search size={16} aria-hidden className="catalog-product-link-picker__icon" />
        <input
          id="catalog-product-link-search"
          type="search"
          className="catalog-input catalog-product-link-picker__input"
          placeholder="Search Zoho catalog by SKU or name…"
          value={query}
          disabled={disabled || loading}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="catalog-product-link-options"
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            if (value && e.target.value !== [value.sku, value.name].filter(Boolean).join(' · ')) {
              onChange(null);
            }
          }}
        />
        {loading && (
          <Loader2 size={16} className="spin-icon catalog-product-link-picker__spinner" aria-hidden />
        )}
      </div>

      {open && !disabled && (
        <ul id="catalog-product-link-options" className="catalog-product-link-picker__options panel glass" role="listbox">
          {matches.length === 0 ? (
            <li className="catalog-product-link-picker__empty text-muted text-sm">No catalog items match.</li>
          ) : (
            matches.map(product => (
              <li key={product.id} role="option">
                <button
                  type="button"
                  className={`catalog-product-link-picker__option${value?.id === product.id ? ' is-selected' : ''}`}
                  onClick={() => pickProduct(product)}
                >
                  <span className="catalog-product-link-picker__option-media">
                    {product.imageUrl ? (
                      <ProductImageFrame src={product.imageUrl} alt="" variant="row" />
                    ) : (
                      <span className="catalog-product-link-picker__option-placeholder" aria-hidden>
                        <Package size={18} />
                      </span>
                    )}
                  </span>
                  <span className="catalog-product-link-picker__option-body">
                    <strong>{product.name}</strong>
                    <span className="text-muted text-sm">
                      {[product.sku, product.categoryName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {value && (
        <div className="catalog-product-link-picker__selected panel glass">
          <span className="catalog-product-link-picker__selected-media">
            {value.imageUrl ? (
              <ProductImageFrame src={value.imageUrl} alt="" variant="row" />
            ) : (
              <span className="catalog-product-link-picker__option-placeholder" aria-hidden>
                <Package size={20} />
              </span>
            )}
          </span>
          <span className="catalog-product-link-picker__selected-body">
            <strong>{value.name}</strong>
            {value.sku && <span className="text-muted text-sm">SKU {value.sku}</span>}
          </span>
        </div>
      )}
    </div>
  );
};
