import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { FetchingLoader } from '../../components/FetchingLoader';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { fetchCatalog, formatCurrency } from '../../lib/catalog';
import {
  approveDealerOrder,
  buildOrderLineDiff,
  cancelDealerOrder,
  dealerOrderErrorMessage,
  fetchDealerOrder,
  rejectDealerOrder,
  summarizeOrderChanges,
  updateDealerOrderLines,
  verifyDealerOrderPayment,
} from '../../lib/dealerOrders';
import { formatInvoiceDate } from '../../lib/invoices';
import { hasStaffPermission } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';
import type { CatalogProduct } from '../../types/catalog';
import type { DealerOrder, DealerOrderLine } from '../../types/dealer-orders';
import { dealerOrderStatusLabel } from '../../types/dealer-orders';

export const StaffOrderDetailPage: React.FC = () => {
  const { orderId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = user ? homePathForRole(user.role) : '/staff';

  const canManage = user?.role === 'super_admin' || hasStaffPermission(user, 'orders.manage');
  const canVerify = user?.role === 'super_admin';

  const [order, setOrder] = useState<DealerOrder | null>(null);
  const [draftLines, setDraftLines] = useState<DealerOrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const next = await fetchDealerOrder(orderId);
      setOrder(next);
      setDraftLines(next.lines.map(line => ({ ...line })));
      setError('');
    } catch (err) {
      setError(dealerOrderErrorMessage(err));
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = order?.status === 'pending_review' && canManage;
  const dirty = useMemo(() => {
    if (!order) return false;
    const key = (lines: DealerOrderLine[]) =>
      lines.map(l => `${l.productId}:${l.quantity}`).sort().join('|');
    return key(draftLines) !== key(order.lines);
  }, [draftLines, order]);

  const draftSubtotal = useMemo(
    () => draftLines.reduce((sum, line) => sum + line.rate * line.quantity, 0),
    [draftLines],
  );

  const changeSummary = useMemo(
    () => (order ? summarizeOrderChanges({ ...order, lines: draftLines }) : null),
    [order, draftLines],
  );

  const setQty = (productId: string, quantity: number) => {
    setDraftLines(prev => {
      if (quantity < 1) return prev.filter(line => line.productId !== productId);
      return prev.map(line => (
        line.productId === productId
          ? { ...line, quantity, lineTotal: Math.round(line.rate * quantity * 100) / 100 }
          : line
      ));
    });
  };

  const addProduct = (product: CatalogProduct) => {
    setDraftLines(prev => {
      const existing = prev.find(line => line.productId === product.id);
      if (existing) {
        return prev.map(line => (
          line.productId === product.id
            ? {
              ...line,
              quantity: line.quantity + 1,
              lineTotal: Math.round(line.rate * (line.quantity + 1) * 100) / 100,
            }
            : line
        ));
      }
      return [
        ...prev,
        {
          productId: product.id,
          itemId: product.id,
          name: product.name,
          sku: product.sku,
          imageUrl: product.imageUrl,
          rate: product.rate,
          unit: product.unit,
          quantity: 1,
          lineTotal: product.rate,
          stockStatus: product.stockStatus,
          categoryName: product.categoryName,
          taxPercentage: product.taxPercentage,
          hsn: product.hsn,
        },
      ];
    });
    setPickerOpen(false);
  };

  const saveLines = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const next = await updateDealerOrderLines(
        order.id,
        draftLines.map(line => ({ productId: line.productId, quantity: line.quantity })),
      );
      setOrder(next);
      setDraftLines(next.lines.map(line => ({ ...line })));
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!order) return;
    setSaving(true);
    try {
      if (dirty) {
        const ok = window.confirm('Save line changes before approving?');
        if (!ok) return;
        const saved = await updateDealerOrderLines(
          order.id,
          draftLines.map(line => ({ productId: line.productId, quantity: line.quantity })),
        );
        setOrder(saved);
        setDraftLines(saved.lines.map(line => ({ ...line })));
      }
      const next = await approveDealerOrder(order.id);
      setOrder(next);
      setDraftLines(next.lines.map(line => ({ ...line })));
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!order || !rejectReason.trim()) return;
    setSaving(true);
    try {
      const next = await rejectDealerOrder(order.id, rejectReason.trim());
      setOrder(next);
      setRejectOpen(false);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!order) return;
    if (!window.confirm('Verify payment and create Zoho sales order + invoice?')) return;
    setSaving(true);
    try {
      const next = await verifyDealerOrderPayment(order.id);
      setOrder(next);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
      void load();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!order) return;
    if (!window.confirm('Cancel this order?')) return;
    setSaving(true);
    try {
      const next = await cancelDealerOrder(order.id);
      setOrder(next);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-content fade-in">
        <FetchingLoader label="Loading order…" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page-content fade-in">
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error || 'Order not found.'}</span>
        </div>
      </div>
    );
  }

  const diff = buildOrderLineDiff({ submittedLines: order.submittedLines, lines: draftLines });

  return (
    <div className="page-content fade-in dealer-order-detail">
      <header className="dealer-order-detail__header">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`${base}/orders`)}>
          <ChevronLeft size={16} /> Queue
        </button>
        <div className="dealer-order-detail__title">
          <h2>{order.orderNumber}</h2>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-muted text-sm">
          {order.dealerName || 'Dealer'} · {formatInvoiceDate(order.createdAt)} ·{' '}
          {formatCurrency(editable ? draftSubtotal : order.subtotal)}
        </p>
      </header>

      {order.zohoSyncError && (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>Zoho: {order.zohoSyncError}</span>
        </div>
      )}

      <section className="dealer-order-detail__timeline panel glass">
        <h3>Status history</h3>
        <ol className="dealer-order-detail__history">
          {(order.statusHistory ?? []).map((event, index) => (
            <li key={`${event.status}-${event.at}-${index}`}>
              <strong>{dealerOrderStatusLabel(event.status)}</strong>
              <span className="text-muted text-sm">
                {formatInvoiceDate(event.at)}
                {event.byName ? ` · ${event.byName}` : ''}
              </span>
              {event.note && <span className="text-sm">{event.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="dealer-order-detail__diff panel glass">
        <div className="dealer-order-detail__section-head">
          <h3>Line items</h3>
          {editable && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
              <Plus size={14} /> Add product
            </button>
          )}
        </div>
        {changeSummary && <p className="dealer-order-detail__diff-summary">{changeSummary.label}</p>}

        <ul className="dealer-order-detail__lines">
          {draftLines.map(line => {
            const diffRow = diff.find(row => row.productId === line.productId);
            return (
              <li
                key={line.productId}
                className={`dealer-order-detail__line dealer-order-detail__line--${diffRow?.kind ?? 'unchanged'}`}
              >
                <div className="dealer-order-detail__line-icon" aria-hidden>
                  {line.imageUrl ? <img src={line.imageUrl} alt="" /> : <Package size={20} />}
                </div>
                <div className="dealer-order-detail__line-body">
                  <strong>{line.name}</strong>
                  {line.sku && <span className="text-muted text-sm">{line.sku}</span>}
                  <span className="text-sm">{formatCurrency(line.rate)} / {line.unit}</span>
                </div>
                {editable ? (
                  <div className="orders-page__qty">
                    <button type="button" className="orders-page__qty-btn" onClick={() => setQty(line.productId, line.quantity - 1)}>
                      <Minus size={16} />
                    </button>
                    <span className="orders-page__qty-value">{line.quantity}</span>
                    <button type="button" className="orders-page__qty-btn" onClick={() => setQty(line.productId, line.quantity + 1)}>
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      className="orders-page__remove"
                      onClick={() => setQty(line.productId, 0)}
                      aria-label="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <strong>{line.quantity}</strong>
                )}
                <strong>{formatCurrency(line.rate * line.quantity)}</strong>
              </li>
            );
          })}
        </ul>

        {order.submittedLines.some(s => !draftLines.find(l => l.productId === s.productId)) && (
          <div className="dealer-order-detail__removed">
            <h4>Removed from order</h4>
            <ul>
              {diff.filter(row => row.kind === 'removed').map(row => (
                <li key={row.productId}>{row.name} · was Qty {row.submittedQty}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {(order.paymentScreenshotUrl || order.status === 'payment_submitted' || order.status === 'completed') && (
        <section className="dealer-order-detail__payment panel glass">
          <h3>Payment</h3>
          <p className="text-muted text-sm">
            Amount: <strong>{formatCurrency(order.paymentAmount ?? order.subtotal)}</strong>
            {order.paymentUtr ? ` · UTR ${order.paymentUtr}` : ''}
          </p>
          {order.paymentScreenshotUrl && (
            <div className="dealer-order-detail__proof">
              <img src={order.paymentScreenshotUrl} alt="Payment screenshot" />
            </div>
          )}
        </section>
      )}

      <div className="dealer-order-detail__actions">
        {editable && (
          <>
            <button type="button" className="btn btn-secondary" disabled={!dirty || saving} onClick={() => void saveLines()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-primary" disabled={saving || draftLines.length === 0} onClick={() => void handleApprove()}>
              <CheckCircle2 size={16} /> Approve
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setRejectOpen(true)}>
              Reject
            </button>
          </>
        )}
        {canVerify && order.status === 'payment_submitted' && (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleVerify()}>
            <CheckCircle2 size={16} />
            {saving ? 'Creating in Zoho…' : 'Verify & create invoice'}
          </button>
        )}
        {canManage && (order.status === 'pending_review' || order.status === 'waiting_for_payment') && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void handleCancel()}>
            Cancel order
          </button>
        )}
      </div>

      {pickerOpen && (
        <ProductPickerDialog
          onClose={() => setPickerOpen(false)}
          onPick={addProduct}
          excludeIds={new Set(draftLines.map(l => l.productId))}
        />
      )}

      {rejectOpen && createPortal(
        <>
          <button type="button" className="catalog-filter-dropdown__backdrop" aria-label="Close" onClick={() => setRejectOpen(false)} />
          <div className="catalog-filter-dropdown panel glass" role="dialog" aria-modal="true" aria-label="Reject order">
            <div className="catalog-spares-multi-filters catalog-spares-multi-filters--dropdown">
              <div className="catalog-spares-multi-filters__header">
                <span className="catalog-spares-multi-filters__title">Reject order</span>
                <button type="button" className="catalog-spares-multi-filters__close" onClick={() => setRejectOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="catalog-spares-multi-filters__body">
                <label className="dealer-order-detail__field">
                  <span>Reason</span>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Tell the dealer why this order was rejected"
                  />
                </label>
              </div>
              <div className="catalog-spares-multi-filters__footer">
                <button
                  type="button"
                  className="catalog-spares-multi-filters__apply"
                  disabled={!rejectReason.trim() || saving}
                  onClick={() => void handleReject()}
                >
                  Reject order
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};

function ProductPickerDialog({
  onClose,
  onPick,
  excludeIds,
}: {
  onClose: () => void;
  onPick: (product: CatalogProduct) => void;
  excludeIds: Set<string>;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setLoading(true);
      void fetchCatalog({ search: q.trim() || undefined })
        .then(res => setResults((res.items ?? []).slice(0, 40)))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [q]);

  return createPortal(
    <>
      <button type="button" className="catalog-filter-dropdown__backdrop" aria-label="Close" onClick={onClose} />
      <div className="catalog-filter-dropdown panel glass dealer-order-picker" role="dialog" aria-modal="true" aria-label="Add product">
        <div className="catalog-spares-multi-filters catalog-spares-multi-filters--dropdown">
          <div className="catalog-spares-multi-filters__header">
            <span className="catalog-spares-multi-filters__title">Add product</span>
            <button type="button" className="catalog-spares-multi-filters__close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="catalog-spares-multi-filters__body">
            <label className="dealer-order-detail__field">
              <span>Search catalog</span>
              <span className="dealer-order-picker__search">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Name or SKU"
                  autoFocus
                />
              </span>
            </label>
            {loading ? (
              <p className="text-muted text-sm">Searching…</p>
            ) : (
              <ul className="dealer-order-picker__list">
                {results.filter(p => !excludeIds.has(p.id)).map(product => (
                  <li key={product.id}>
                    <button type="button" onClick={() => onPick(product)}>
                      <span>
                        <strong>{product.name}</strong>
                        <span className="text-muted text-sm">
                          {product.sku || '—'} · {formatCurrency(product.rate)}
                        </span>
                      </span>
                      <Plus size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
