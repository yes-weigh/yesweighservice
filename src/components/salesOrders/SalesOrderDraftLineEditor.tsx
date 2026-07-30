import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Search, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../QuantityStepper';
import { CategoryThumbnail } from '../catalog/CategoryThumbnail';
import {
  type GatcStampingChoice,
} from '../catalog/GatcStampingChoiceDialog';
import { GatcStampingInlineControl } from '../catalog/GatcStampingInlineControl';
import { DocumentLineItemSpec } from '../invoices/DocumentLineItemSpec';
import { fetchCatalog, formatCurrency, formatStockQuantity } from '../../lib/catalog';
import { combinedCartRate, newCartLineId, productHasLinkedGatc } from '../../lib/gatcCart';
import { loadGatcStampingPrices } from '../../lib/catalogProductSettings';
import type { CatalogProduct } from '../../types/catalog';

export interface DraftEditLine {
  /** Stable row id — same product can appear with/without stamping. */
  lineId: string;
  productId: string;
  name: string;
  sku: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Combined unit rate = baseRate + gatcFeePerUnit (shown as line total rate). */
  rate: number;
  /** Editable product base rate (staff). Catalog list price when added. */
  catalogRate: number;
  /** Fixed GATC fee from settings (0 if without stamping). */
  gatcFeePerUnit: number;
  gatcStampingPriceId?: string | null;
  gatcStampingRange?: string | null;
  unit: string;
  quantity: number;
  stockStatus: string | null;
  categoryName?: string | null;
  categoryId?: string | null;
}

interface SalesOrderDraftLineEditorProps {
  lines: DraftEditLine[];
  onChange: (lines: DraftEditLine[]) => void;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Flatten into parent surface (no outer panel chrome). */
  embedded?: boolean;
  /** Allow editing base unit rate (staff create / edit). GATC fee stays fixed. */
  allowRateEdit?: boolean;
  saveLabel?: string;
  title?: string;
  hideActions?: boolean;
  /** Limit which catalog products can be added (segment permissions). */
  productFilter?: (product: CatalogProduct) => boolean;
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function sameGatcKey(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a?.trim() || null) === (b?.trim() || null);
}

function toDraftLine(
  product: CatalogProduct,
  quantity = 1,
  choice?: GatcStampingChoice,
): DraftEditLine {
  const catalogRate = Math.round((Number(product.rate) || 0) * 100) / 100;
  const gatcStampingPriceId = choice?.withStamping
    ? (choice.gatcStampingPriceId?.trim() || null)
    : null;
  const gatcFeePerUnit = gatcStampingPriceId
    ? Math.round(Number(choice?.gatcFeePerUnit ?? 0) * 100) / 100
    : 0;
  return {
    lineId: newCartLineId(),
    productId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description?.trim() || null,
    imageUrl: product.imageUrl,
    catalogRate,
    gatcFeePerUnit,
    gatcStampingPriceId,
    gatcStampingRange: gatcStampingPriceId
      ? (choice?.gatcStampingRange?.trim() || null)
      : null,
    rate: combinedCartRate(catalogRate, gatcFeePerUnit),
    unit: product.unit || 'pcs',
    quantity,
    stockStatus: product.stockStatus ?? null,
    categoryName: product.categoryName ?? null,
    categoryId: product.categoryId ?? null,
  };
}

export const SalesOrderDraftLineEditor: React.FC<SalesOrderDraftLineEditorProps> = ({
  lines,
  onChange,
  saving = false,
  onSave,
  onCancel,
  embedded = false,
  allowRateEdit = false,
  saveLabel = 'Save to Zoho',
  title = 'Edit items',
  hideActions = false,
  productFilter,
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

  const productById = useMemo(() => {
    const map = new Map<string, CatalogProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const selectedIds = useMemo(() => new Set(lines.map(line => line.productId)), [lines]);

  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => (productFilter ? productFilter(p) : true))
      .filter(p => (
        p.name.toLowerCase().includes(q)
        || (p.sku ?? '').toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
      ))
      .slice(0, 40);
  }, [products, debouncedQuery, productFilter]);

  const showOptions = open && !catalogLoading && query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, open]);

  const setQuantity = (lineId: string, quantity: number) => {
    const nextQty = Math.max(1, Math.floor(quantity) || 1);
    onChange(lines.map(line => (
      line.lineId === lineId ? { ...line, quantity: nextQty } : line
    )));
  };

  /** Staff edits base rate only; GATC fee stays fixed. */
  const setBaseRate = (lineId: string, baseRate: number) => {
    const nextBase = Number.isFinite(baseRate) && baseRate >= 0
      ? Math.round(baseRate * 100) / 100
      : 0;
    onChange(lines.map(line => (
      line.lineId === lineId
        ? {
            ...line,
            catalogRate: nextBase,
            rate: combinedCartRate(nextBase, line.gatcFeePerUnit),
          }
        : line
    )));
  };

  const removeLine = (lineId: string) => {
    onChange(lines.filter(line => line.lineId !== lineId));
  };

  const insertOrMergeProduct = (product: CatalogProduct, choice?: GatcStampingChoice) => {
    const gatcId = choice?.withStamping ? (choice.gatcStampingPriceId?.trim() || null) : null;
    const existing = lines.find(
      line => line.productId === product.id && sameGatcKey(line.gatcStampingPriceId, gatcId),
    );
    if (existing) {
      onChange(lines.map(line => (
        line.lineId === existing.lineId
          ? { ...line, quantity: line.quantity + 1 }
          : line
      )));
    } else {
      onChange([...lines, toDraftLine(product, 1, choice)]);
    }
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  // Stampable items add without stamping; configure on the line (same UX as dealer cart).
  const addProduct = (product: CatalogProduct) => {
    insertOrMergeProduct(product);
  };

  const applyLineStamping = (lineId: string, choice: GatcStampingChoice) => {
    const stampEditLine = lines.find(line => line.lineId === lineId);
    if (!stampEditLine) return;

    const nextGatcId = choice.withStamping ? choice.gatcStampingPriceId : null;
    const nextFee = choice.withStamping ? choice.gatcFeePerUnit : 0;
    const nextRange = choice.withStamping ? choice.gatcStampingRange : null;

    const mergeInto = lines.find(
      line => line.lineId !== stampEditLine.lineId
        && line.productId === stampEditLine.productId
        && sameGatcKey(line.gatcStampingPriceId, nextGatcId),
    );

    if (mergeInto) {
      onChange(
        lines
          .filter(line => line.lineId !== stampEditLine.lineId)
          .map(line => (
            line.lineId === mergeInto.lineId
              ? {
                  ...line,
                  quantity: line.quantity + stampEditLine.quantity,
                  gatcFeePerUnit: nextFee,
                  gatcStampingPriceId: nextGatcId,
                  gatcStampingRange: nextRange,
                  rate: combinedCartRate(line.catalogRate, nextFee),
                }
              : line
          )),
      );
      return;
    }

    onChange(lines.map(line => (
      line.lineId === stampEditLine.lineId
        ? {
            ...line,
            gatcFeePerUnit: nextFee,
            gatcStampingPriceId: nextGatcId,
            gatcStampingRange: nextRange,
            rate: combinedCartRate(line.catalogRate, nextFee),
          }
        : line
    )));
  };

  const stampableWithoutStamping = useMemo(() => (
    lines.filter(line => {
      if (line.gatcStampingPriceId) return false;
      const catalogProduct = productById.get(line.productId);
      return catalogProduct ? productHasLinkedGatc(catalogProduct) : false;
    })
  ), [lines, productById]);

  const estimatedSubtotal = lines.reduce((sum, line) => sum + line.rate * line.quantity, 0);

  return (
    <section className={`so-draft-editor${embedded ? ' so-draft-editor--embedded' : ' panel glass mb-4'}`}>
      <header className="so-draft-editor__header">
        <div>
          <h3 className="so-draft-editor__title">{title}</h3>
          {!embedded && (
            <p className="so-draft-editor__subtitle text-muted text-sm">
              {allowRateEdit
                ? 'Adjust quantities and base rates (stamping fee is fixed), then save.'
                : 'Adjust quantities inline, then save to Zoho Draft.'}
            </p>
          )}
        </div>
        {!hideActions ? (
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
              {saving ? 'Saving…' : saveLabel}
            </button>
          </div>
        ) : null}
      </header>

      {stampableWithoutStamping.length > 0 && (
        <div className="orders-page__stamp-reminder so-draft-editor__stamp-reminder" role="status">
          <p>
            {stampableWithoutStamping.length === 1
              ? '1 item can have stamping added.'
              : `${stampableWithoutStamping.length} items can have stamping added.`}
            {' '}
            Use the stamping control on the line, or <strong>+ Add with stamping</strong> for a separate stamped line.
          </p>
        </div>
      )}

      <ul className="so-draft-editor__lines">
        {lines.length === 0 ? (
          <li className="so-draft-editor__empty text-muted text-sm">
            No items yet. Search the catalog below to add products.
          </li>
        ) : (
          lines.map(line => {
            const catalogProduct = productById.get(line.productId);
            const canStamp = catalogProduct
              ? productHasLinkedGatc(catalogProduct)
              : Boolean(line.gatcStampingPriceId);
            const hasStamping = Boolean(line.gatcStampingPriceId);
            const usedGatcIds = lines
              .filter(other => other.productId === line.productId && other.gatcStampingPriceId)
              .map(other => String(other.gatcStampingPriceId));
            const hasUnstampedSibling = lines.some(
              other => other.productId === line.productId && !other.gatcStampingPriceId,
            );
            const listBase = line.catalogRate;
            const customized = allowRateEdit
              && catalogProduct != null
              && Math.round((Number(catalogProduct.rate) || 0) * 100) !== Math.round(listBase * 100);

            return (
              <li key={line.lineId} className="so-draft-editor__line">
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
                  {allowRateEdit ? (
                    <label className="so-draft-editor__rate">
                      <span className="text-muted text-sm">Base rate</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input-field so-draft-editor__rate-input"
                        value={line.catalogRate}
                        disabled={saving}
                        onChange={e => setBaseRate(line.lineId, Number(e.target.value))}
                        aria-label={`Base rate for ${line.name}`}
                      />
                      {customized ? (
                        <span className="so-draft-editor__rate-was text-muted text-sm">
                          was {formatCurrency(Number(catalogProduct?.rate) || 0)}
                        </span>
                      ) : null}
                      {line.gatcFeePerUnit > 0 ? (
                        <span className="so-draft-editor__rate-was text-muted text-sm">
                          + {formatCurrency(line.gatcFeePerUnit)} stamping
                          {line.gatcStampingRange ? ` (${line.gatcStampingRange})` : ''}
                          {' = '}
                          {formatCurrency(line.rate)}
                        </span>
                      ) : canStamp ? null : (
                        <span className="so-draft-editor__rate-was text-muted text-sm">
                          Without stamping
                        </span>
                      )}
                    </label>
                  ) : (
                    <span className="text-muted text-sm">
                      {formatCurrency(line.rate)}
                      {line.gatcFeePerUnit > 0
                        ? ` · +${formatCurrency(line.gatcFeePerUnit)} stamp`
                        : ''}
                      {line.stockStatus === 'out_of_stock' ? ' · Out of stock' : ''}
                    </span>
                  )}
                  {canStamp && catalogProduct && (
                    <GatcStampingInlineControl
                      product={catalogProduct}
                      valueId={line.gatcStampingPriceId}
                      hasStamping={hasStamping}
                      usedGatcIds={usedGatcIds}
                      hasUnstampedSibling={hasUnstampedSibling}
                      disabled={saving}
                      onChange={choice => applyLineStamping(line.lineId, choice)}
                      onAddSibling={choice => insertOrMergeProduct(catalogProduct, choice)}
                    />
                  )}
                </DocumentLineItemSpec>
                <QuantityStepper
                  value={line.quantity}
                  onChange={next => setQuantity(line.lineId, next)}
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
                  onClick={() => removeLine(line.lineId)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })
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

/** Hydrate draft lines from an existing SO when opening the editor. */
export async function draftLinesFromSalesOrderItems(
  items: Array<{
    itemId?: string | null;
    productId?: string | null;
    name?: string | null;
    sku?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    rate?: number;
    quantity?: number;
    unit?: string | null;
    stockStatus?: string | null;
  }>,
): Promise<DraftEditLine[]> {
  const catalog = await fetchCatalog().catch(() => null);
  const gatcEntries = await loadGatcStampingPrices().catch(() => []);
  const byId = new Map((catalog?.items ?? []).map(p => [p.id, p]));

  return items.map(item => {
    const productId = String(item.productId || item.itemId || '').trim();
    const product = byId.get(productId);
    const catalogRate = product
      ? Math.round(Number(product.rate) * 100) / 100
      : Math.round(Number(item.rate ?? 0) * 100) / 100;
    // Existing SO lines already have combined rate; we cannot recover fee without meta.
    // Treat full rate as base with no stamping unless product has GATC and rate matches base+fee.
    let gatcFeePerUnit = 0;
    let gatcStampingPriceId: string | null = null;
    let gatcStampingRange: string | null = null;
    let baseRate = Math.round(Number(item.rate ?? catalogRate) * 100) / 100;

    if (product && productHasLinkedGatc(product)) {
      const linked = new Set(
        (product.gatcStampingPriceIds ?? []).map(id => String(id).trim()).filter(Boolean),
      );
      const combined = Math.round(Number(item.rate ?? 0) * 100) / 100;
      const match = gatcEntries.find(entry => (
        linked.has(entry.id)
        && Math.round((catalogRate + entry.price) * 100) / 100 === combined
      ));
      if (match) {
        gatcStampingPriceId = match.id;
        gatcFeePerUnit = match.price;
        gatcStampingRange = match.stampingRange;
        baseRate = catalogRate;
      } else if (Math.round(combined * 100) === Math.round(catalogRate * 100)) {
        baseRate = catalogRate;
      } else {
        // Custom base (or unknown stamping) — keep rate as base, fee 0 until user picks.
        baseRate = combined;
      }
    }

    return {
      lineId: newCartLineId(),
      productId,
      name: String(item.name || product?.name || 'Item'),
      sku: item.sku ?? product?.sku ?? null,
      description: item.description?.trim() || product?.description?.trim() || null,
      imageUrl: item.imageUrl ?? product?.imageUrl ?? null,
      catalogRate: baseRate,
      gatcFeePerUnit,
      gatcStampingPriceId,
      gatcStampingRange,
      rate: combinedCartRate(baseRate, gatcFeePerUnit),
      unit: item.unit || product?.unit || 'pcs',
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      stockStatus: item.stockStatus ?? product?.stockStatus ?? null,
    };
  });
}
