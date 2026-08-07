import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, IndianRupee, Loader2, Package, X } from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import {
  fetchCatalogProductDetail,
  formatCurrency,
  setCatalogProductHidden,
} from '../../lib/catalog';
import { catalogGridStockQty } from '../../lib/catalogProductAudit/display';
import {
  isBrokenStockLedger,
  loadCatalogProductStockLedger,
} from '../../lib/catalogProductAudit/loadStockLedger';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import type { CatalogStockMovement } from '../../types/catalog-product-audit';
import { StockBadge, StockQuantity } from './StockBadge';

type Props = {
  product: CatalogProduct;
  onClose: () => void;
  /** Called after the product is hidden from the catalogue. */
  onHidden: (productId: string) => void;
};

function isPurchaseBill(row: CatalogStockMovement): boolean {
  return row.type === 'bill';
}

function billQty(row: CatalogStockMovement): number {
  return Math.abs(
    Number(row.quantity) || Math.abs(Number(row.displayQtyDelta ?? row.qtyDelta) || 0),
  );
}

function formatBillDate(row: CatalogStockMovement): string {
  const iso = row.createdAt || (row.date ? `${row.date}T12:00:00` : '');
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return row.date || '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatVendorName(name: string | null): string {
  const trimmed = String(name ?? '').trim();
  return trimmed || 'Unknown vendor';
}

function formatBillUnitPrice(row: CatalogStockMovement): string {
  const unitPrice = row.itemPrice != null && Number.isFinite(Number(row.itemPrice))
    ? Number(row.itemPrice)
    : null;
  if (unitPrice == null) return '—';
  if (row.currencyCode) return formatCurrency(unitPrice, row.currencyCode);
  if (row.currencySymbol) {
    const amount = unitPrice.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${row.currencySymbol}${amount}`;
  }
  return formatCurrency(unitPrice, 'INR');
}

function sortBillsNewestFirst(rows: CatalogStockMovement[]): CatalogStockMovement[] {
  return [...rows].sort((a, b) => {
    const da = String(a.createdAt || a.date || '');
    const db = String(b.createdAt || b.date || '');
    if (da !== db) return db.localeCompare(da);
    return String(b.documentNumber).localeCompare(String(a.documentNumber));
  });
}

export const SparePricingProductPeek: React.FC<Props> = ({
  product,
  onClose,
  onHidden,
}) => {
  const confirm = useConfirm();
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [history, setHistory] = useState<CatalogStockMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = detail ?? product;

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    void fetchCatalogProductDetail(product.id)
      .then(next => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => {
        /* list row is enough for preview */
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    void loadCatalogProductStockLedger(product.id)
      .then(result => {
        if (cancelled) return;
        if (isBrokenStockLedger(result)) {
          setHistoryError('Could not load purchases from Zoho.');
          setHistory([]);
          return;
        }
        const bills = sortBillsNewestFirst(
          (result.movements ?? []).filter(isPurchaseBill),
        );
        setHistory(bills);
      })
      .catch(err => {
        if (!cancelled) {
          setHistoryError(
            err instanceof Error ? err.message : 'Could not load purchase history.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hiding) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hiding]);

  const handleHide = async () => {
    if (hiding) return;
    const ok = await confirm({
      title: 'Hide from catalogue?',
      message: `“${display.name}” will no longer appear in the dealer/public catalogue or spare pricing. The item stays active in Zoho.`,
      confirmLabel: 'Hide from catalogue',
      destructive: true,
    });
    if (!ok) return;

    setHiding(true);
    setError(null);
    try {
      await setCatalogProductHidden(product.id, true);
      onHidden(product.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hide from catalogue.');
    } finally {
      setHiding(false);
    }
  };

  const stockQty = catalogGridStockQty(display);
  const stockStatus = stockQty <= 0
    ? 'out_of_stock' as const
    : display.stockStatus === 'low_stock'
      ? 'low_stock' as const
      : 'in_stock' as const;
  const unit = display.unit || 'pcs';
  const sku = display.sku?.trim() || '';

  return createPortal(
    <div
      className="catalog-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!hiding) onClose();
      }}
    >
      <div
        className="catalog-modal panel glass spare-pricing-peek"
        role="dialog"
        aria-modal="true"
        aria-label={display.name}
        onClick={event => event.stopPropagation()}
      >
        <div className="spare-pricing-peek__scroll">
          <div className="spare-pricing-peek__hero">
            {display.imageUrl ? (
              <img
                className="spare-pricing-peek__hero-img"
                src={display.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="spare-pricing-peek__hero-placeholder" aria-hidden>
                <Package size={40} />
              </span>
            )}
            <div className="spare-pricing-peek__hero-scrim" aria-hidden />

            <div className="spare-pricing-peek__chips-top">
              <div className="spare-pricing-peek__chips-row">
                {sku ? (
                  <span className="spare-pricing-peek__chip spare-pricing-peek__chip--sku">
                    {sku}
                  </span>
                ) : null}
                {display.categoryName ? (
                  <span className="spare-pricing-peek__chip spare-pricing-peek__chip--muted">
                    {display.categoryName}
                  </span>
                ) : null}
              </div>
              <div className="spare-pricing-peek__chips-row spare-pricing-peek__chips-row--end">
                <StockBadge status={display.stockStatus} variant="tile" overlay />
                {detailLoading ? (
                  <span className="spare-pricing-peek__chip spare-pricing-peek__chip--muted">
                    <Loader2 size={12} className="spin-icon" aria-hidden />
                    …
                  </span>
                ) : null}
              </div>
            </div>

            <div className="spare-pricing-peek__chips-bottom">
              <h2 className="spare-pricing-peek__name">{display.name}</h2>
              <div className="spare-pricing-peek__chips-row">
                <span className="spare-pricing-peek__chip spare-pricing-peek__chip--price">
                  <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                  {display.rate.toLocaleString('en-IN')}
                </span>
                <StockQuantity
                  stock={stockQty}
                  unit={unit}
                  status={stockStatus}
                  compact
                />
              </div>
            </div>
          </div>

          <div className="spare-pricing-peek__body">
            <div className="spare-pricing-peek__history">
              <div className="spare-pricing-peek__history-head">
                <h3>Purchase history</h3>
                {!historyLoading && history.length > 0 ? (
                  <span>{history.length}</span>
                ) : null}
              </div>

              {historyLoading ? (
                <div className="spare-pricing-peek__history-loading">
                  <Loader2 size={16} className="spin-icon" aria-hidden />
                  Loading purchases…
                </div>
              ) : historyError ? (
                <p className="spare-pricing-peek__history-empty" role="alert">
                  {historyError}
                </p>
              ) : history.length === 0 ? (
                <p className="spare-pricing-peek__history-empty">
                  No purchase bills found for this item.
                </p>
              ) : (
                <ul>
                  {history.map(row => {
                    const qty = billQty(row);
                    return (
                      <li key={`${row.documentId}-${row.date}-${row.createdAt ?? ''}`}>
                        <div className="spare-pricing-peek__history-main">
                          <strong>{formatVendorName(row.customerOrVendor)}</strong>
                          <span>
                            {formatBillDate(row)}
                            {row.documentNumber ? ` · ${row.documentNumber}` : ''}
                          </span>
                        </div>
                        <div className="spare-pricing-peek__history-meta">
                          <span>
                            {qty > 0
                              ? `${qty.toLocaleString('en-IN')} ${unit}`
                              : 'Qty —'}
                          </span>
                          <strong className="spare-pricing-peek__history-rate">
                            {formatBillUnitPrice(row)}
                          </strong>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error ? (
              <p className="spare-pricing-peek__error" role="alert">{error}</p>
            ) : null}
          </div>
        </div>

        <div className="spare-pricing-peek__footer">
          <button
            type="button"
            className="btn btn-secondary spare-pricing-peek__close-btn"
            onClick={onClose}
            disabled={hiding}
          >
            <X size={18} aria-hidden />
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary spare-pricing-peek__hide-btn"
            onClick={() => void handleHide()}
            disabled={hiding}
          >
            {hiding
              ? <Loader2 size={16} className="spin-icon" aria-hidden />
              : <EyeOff size={16} aria-hidden />}
            {hiding ? 'Hiding…' : 'Hide from catalogue'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
