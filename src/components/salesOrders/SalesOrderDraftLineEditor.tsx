import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Search, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../QuantityStepper';
import { CategoryThumbnail } from '../catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../invoices/DocumentLineItemSpec';
import { fetchCatalog, formatCurrency, formatStockQuantity } from '../../lib/catalog';
import type { CatalogProduct } from '../../types/catalog';

export interface DraftEditLine {
  productId: string;
  name: string;
  sku: string | null;
  description: string | null;
  imageUrl: string | null;
  rate: number;
  unit: string;
  quantity: number;
  stockStatus: string | null;
}

interface SalesOrderDraftLineEditorProps {
  lines: DraftEditLine[];
  onChange: (lines: DraftEditLine[]) => void;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Flatten into parent surface (no outer panel chrome). */
  embedded?: boolean;
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function toDraftLine(product: CatalogProduct, quantity = 1): DraftEditLine {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description?.trim() || null,
    imageUrl: product.imageUrl,
    rate: Number(product.rate) || 0,
    unit: product.unit || 'pcs',
    quantity,
    stockStatus: product.stockStatus ?? null,
  };
}

export const SalesOrderDraftLineEditor: React.FC<SalesOrderDraftLineEditorProps> = ({
  lines,
  onChange,
  saving = false,
  onSave,
  onCancel,
  embedded = false,
}) => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 180);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchCatalog()
      .then(res => {
        if (!cancelled) {
          setProducts(res.items);
          setCatalogError('');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : 'Could not load catalog.');
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const selectedIds = useMemo(() => new Set(lines.map(line => line.productId)), [lines]);

  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => (
        p.name.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
      ))
      .slice(0, 40);
  }, [products, debouncedQuery]);

  const showOptions = open && !catalogLoading && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, open]);

  const setQuantity = (productId: string, quantity: number) => {
    const nextQty = Math.max(1, Math.floor(quantity) || 1);
    onChange(lines.map(line => (
      line.productId === productId ? { ...line, quantity: nextQty } : line
    )));
  };

  const removeLine = (productId: string) => {
    onChange(lines.filter(line => line.productId !== productId));
  };

  const addProduct = (product: CatalogProduct) => {
    const existing = lines.find(line => line.productId === product.id);
    if (existing) {
      onChange(lines.map(line => (
        line.productId === product.id
          ? { ...line, quantity: line.quantity + 1 }
          : line
      )));
    } else {
      onChange([...lines, toDraftLine(product, 1)]);
    }
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const estimatedSubtotal = lines.reduce((sum, line) => sum + line.rate * line.quantity, 0);

  return (
    <section className={`so-draft-editor${embedded ? ' so-draft-editor--embedded' : ' panel glass mb-4'}`}>
      <header className="so-draft-editor__header">
        <div>
          <h3 className="so-draft-editor__title">Edit items</h3>
          {!embedded && (
            <p className="so-draft-editor__subtitle text-muted text-sm">
              Adjust quantities inline, then save to Zoho Draft.
            </p>
          )}
        </div>
        <div className="so-draft-editor__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving || lines.length === 0}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save to Zoho'}
          </button>
        </div>
      </header>

      <ul className="so-draft-editor__lines">
        {lines.length === 0 ? (
          <li className="so-draft-editor__empty text-muted text-sm">
            No items yet. Search the catalog below to add products.
          </li>
        ) : (
          lines.map(line => (
            <li key={line.productId} className="so-draft-editor__line">
              <div className="so-draft-editor__line-media">
                {line.imageUrl ? (
                  <CategoryThumbnail src={line.imageUrl} knockout={false} />
                ) : (
                  <span className="so-draft-editor__line-placeholder" aria-hidden>
                    <Package size={22} />
                  </span>
                )}
              </div>
              <DocumentLineItemSpec
                className="so-draft-editor__line-info invoice-detail-item__body"
                name={line.name}
                sku={line.sku}
                description={line.description}
              >
                <span className="text-muted text-sm">
                  {formatCurrency(line.rate)}
                  {line.stockStatus === 'out_of_stock' ? ' · Out of stock' : ''}
                </span>
              </DocumentLineItemSpec>
              <QuantityStepper
                value={line.quantity}
                onChange={next => setQuantity(line.productId, next)}
                disabled={saving}
                className="so-draft-editor__qty"
                buttonClassName="so-draft-editor__qty-btn"
                inputClassName="so-draft-editor__qty-input"
                aria-label={`Quantity for ${line.name}`}
              />
              <div className="so-draft-editor__line-total">
                {formatCurrency(line.rate * line.quantity)}
              </div>
              <button
                type="button"
                className="so-draft-editor__remove"
                aria-label={`Remove ${line.name}`}
                disabled={saving}
                onClick={() => removeLine(line.productId)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="so-draft-editor__picker" ref={rootRef}>
        <label className="so-draft-editor__picker-label" htmlFor="so-draft-product-search">
          Add product
        </label>
        <div className={`so-draft-editor__search${showOptions ? ' is-open' : ''}`}>
          <Search size={16} aria-hidden className="so-draft-editor__search-icon" />
          <input
            ref={inputRef}
            id="so-draft-product-search"
            type="search"
            className="so-draft-editor__search-input"
            placeholder="Search by name or SKU…"
            value={query}
            disabled={saving || catalogLoading}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showOptions}
            aria-controls="so-draft-product-options"
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
                const pick = matches[activeIndex];
                if (pick) addProduct(pick);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {catalogLoading && (
            <Loader2 size={16} className="spin-icon so-draft-editor__spinner" aria-hidden />
          )}
        </div>

        {showOptions && (
          <ul
            id="so-draft-product-options"
            className="so-draft-editor__options"
            role="listbox"
          >
            {catalogError ? (
              <li className="so-draft-editor__option-empty text-sm">{catalogError}</li>
            ) : matches.length === 0 ? (
              <li className="so-draft-editor__option-empty text-muted text-sm">
                No catalog items match.
              </li>
            ) : (
              matches.map((product, index) => {
                const selected = selectedIds.has(product.id);
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
                      onClick={() => addProduct(product)}
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

      <footer className="so-draft-editor__footer">
        <span className="text-muted text-sm">
          Est. catalog subtotal (before tax)
        </span>
        <strong>{formatCurrency(estimatedSubtotal)}</strong>
      </footer>
    </section>
  );
};
