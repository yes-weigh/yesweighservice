import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Search } from 'lucide-react';
import { fetchCatalogProductDetail, formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { ProductImageFrame } from '../catalog/ProductImageFrame';
import { matchCatalogByScan, SkuScanButton } from '../catalog/SkuScanButton';
import { CatalogProductLinkPreview } from './CatalogProductLinkPreview';

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
  const [detailProduct, setDetailProduct] = useState<CatalogProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (!value) {
      setDetailProduct(null);
      return undefined;
    }

    let cancelled = false;
    setDetailLoading(true);
    void fetchCatalogProductDetail(value.id)
      .then(detail => {
        if (!cancelled) setDetailProduct(detail);
      })
      .catch(() => {
        if (!cancelled) setDetailProduct(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [value?.id]);

  const previewProduct = useMemo(
    () => (detailProduct && value && detailProduct.id === value.id ? detailProduct : value),
    [detailProduct, value],
  );

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
      <div className={`catalog-product-link-picker__search${open ? ' is-open' : ''}`}>
        <div className="catalog-product-link-picker__field">
          <Search size={16} aria-hidden className="catalog-product-link-picker__icon" />
          <input
            id="catalog-product-link-search"
            type="search"
            className="catalog-product-link-picker__input"
            placeholder="Search by SKU or name…"
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
          <SkuScanButton
            disabled={disabled || loading}
            missMessage="SKU not found in catalog"
            hint="Point at the product or spare label QR code."
            onScan={raw => {
              const match = matchCatalogByScan(raw, products);
              if (!match) return false;
              pickProduct(match);
              return true;
            }}
          />
          {loading && (
            <Loader2 size={16} className="spin-icon catalog-product-link-picker__spinner" aria-hidden />
          )}
        </div>

        {open && !disabled && (
          <ul id="catalog-product-link-options" className="catalog-product-link-picker__options" role="listbox">
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
                  <span
                    className="catalog-product-link-picker__option-stock"
                    title="Zoho stock"
                  >
                    <span className="catalog-product-link-picker__option-stock-label">Zoho</span>
                    <strong>{formatStockQuantity(product.stock, product.unit)}</strong>
                  </span>
                </button>
              </li>
            ))
          )}
          </ul>
        )}
      </div>

      {value && previewProduct && (
        <CatalogProductLinkPreview product={previewProduct} loading={detailLoading} />
      )}
    </div>
  );
};
