import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Package,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  buildOrderLineDiff,
  cancelDealerOrder,
  dealerOrderErrorMessage,
  fetchDealerOrder,
  submitDealerOrderPayment,
  summarizeOrderChanges,
  uploadDealerOrderPaymentScreenshot,
} from '../../lib/dealerOrders';
import { homePathForRole } from '../../types';
import type { DealerOrder } from '../../types/dealer-orders';
import { dealerOrderStatusLabel } from '../../types/dealer-orders';

export const DealerOrderDetailPage: React.FC = () => {
  const { orderId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = user ? homePathForRole(user.role) : '/dealer';
  const fileRef = useRef<HTMLInputElement>(null);

  const [order, setOrder] = useState<DealerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [utr, setUtr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const next = await fetchDealerOrder(orderId);
      setOrder(next);
      setUtr(next.paymentUtr ?? '');
      setPreviewUrl(next.paymentScreenshotUrl);
      setStoragePath(next.paymentScreenshotStoragePath);
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

  const diff = useMemo(() => (order ? buildOrderLineDiff(order) : []), [order]);
  const changeSummary = useMemo(() => (order ? summarizeOrderChanges(order) : null), [order]);
  const canPay = order?.status === 'waiting_for_payment' || order?.status === 'payment_submitted';
  const canCancel = order?.status === 'pending_review' || order?.status === 'waiting_for_payment';

  const handleFile = async (file: File | undefined) => {
    if (!file || !order) return;
    setUploading(true);
    try {
      const uploaded = await uploadDealerOrderPaymentScreenshot(order.id, file);
      setPreviewUrl(uploaded.url);
      setStoragePath(uploaded.storagePath);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitPayment = async () => {
    if (!order || !storagePath) {
      window.alert('Capture or upload a payment screenshot first.');
      return;
    }
    setUploading(true);
    try {
      const next = await submitDealerOrderPayment({
        orderId: order.id,
        paymentScreenshotStoragePath: storagePath,
        paymentUtr: utr.trim() || undefined,
      });
      setOrder(next);
      setPreviewUrl(next.paymentScreenshotUrl);
      window.alert('Payment proof submitted. Our team will verify it shortly.');
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = async () => {
    if (!order) return;
    if (!window.confirm('Cancel this order?')) return;
    try {
      const next = await cancelDealerOrder(order.id);
      setOrder(next);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
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
        <button type="button" className="btn btn-secondary" onClick={() => navigate(`${base}/orders/history`)}>
          Back to orders
        </button>
      </div>
    );
  }

  return (
    <div className="page-content fade-in dealer-order-detail">
      <header className="dealer-order-detail__header">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate(`${base}/orders/history`)}
        >
          <ChevronLeft size={16} /> Orders
        </button>
        <div className="dealer-order-detail__title">
          <h2>{order.orderNumber}</h2>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-muted text-sm">
          Submitted {formatInvoiceDate(order.createdAt)} · {order.itemCount} items ·{' '}
          {formatCurrency(order.subtotal)}
        </p>
      </header>

      {order.rejectionReason && (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>Rejected: {order.rejectionReason}</span>
        </div>
      )}

      <section className="dealer-order-detail__timeline panel glass">
        <h3>Status</h3>
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

      {changeSummary && (
        <section className="dealer-order-detail__diff panel glass">
          <h3>Changes vs your submission</h3>
          <p className="dealer-order-detail__diff-summary">{changeSummary.label}</p>
          <ul className="dealer-order-detail__lines">
            {diff.map(row => (
              <li
                key={row.productId}
                className={`dealer-order-detail__line dealer-order-detail__line--${row.kind}`}
              >
                <div className="dealer-order-detail__line-icon" aria-hidden>
                  {row.imageUrl ? <img src={row.imageUrl} alt="" /> : <Package size={20} />}
                </div>
                <div className="dealer-order-detail__line-body">
                  <strong>{row.name}</strong>
                  {row.sku && <span className="text-muted text-sm">{row.sku}</span>}
                  <span className="text-sm">
                    {row.kind === 'added' && <>Added · Qty {row.currentQty}</>}
                    {row.kind === 'removed' && <>Removed · was Qty {row.submittedQty}</>}
                    {row.kind === 'qty_changed' && (
                      <>Qty {row.submittedQty} → {row.currentQty}</>
                    )}
                    {row.kind === 'unchanged' && <>Qty {row.currentQty}</>}
                  </span>
                </div>
                <strong>{formatCurrency(row.lineTotal)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canPay && (
        <section className="dealer-order-detail__payment panel glass">
          <h3>Payment proof</h3>
          <p className="text-muted text-sm">
            Amount due: <strong>{formatCurrency(order.paymentAmount ?? order.subtotal)}</strong>
            {' '}(auto-filled from approved total). Screenshot is required; reference is optional.
          </p>

          {previewUrl ? (
            <div className="dealer-order-detail__proof">
              <img src={previewUrl} alt="Payment screenshot" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Camera size={14} /> Retake
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={16} /> {uploading ? 'Uploading…' : 'Upload payment screenshot'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={event => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          <label className="dealer-order-detail__field">
            <span>UTR / reference (optional)</span>
            <input
              type="text"
              value={utr}
              onChange={e => setUtr(e.target.value)}
              placeholder="Transaction reference"
            />
          </label>

          <button
            type="button"
            className="btn btn-primary"
            disabled={uploading || !storagePath}
            onClick={() => void handleSubmitPayment()}
          >
            <CheckCircle2 size={16} />
            {uploading ? 'Submitting…' : 'Submit payment proof'}
          </button>
        </section>
      )}

      {order.status === 'completed' && (
        <section className="panel glass">
          <h3>Completed</h3>
          <p className="text-muted text-sm">
            {order.zohoSalesOrderNumber && <>Sales order {order.zohoSalesOrderNumber}. </>}
            {order.zohoInvoiceNumber && <>Invoice {order.zohoInvoiceNumber}.</>}
            {!order.zohoInvoiceNumber && 'Invoice will appear under Invoices after sync.'}
          </p>
          <Link to={`${base}/invoices`} className="btn btn-secondary btn-sm">View invoices</Link>
        </section>
      )}

      {canCancel && (
        <div className="dealer-order-detail__actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCancel()}>
            Cancel order
          </button>
        </div>
      )}
    </div>
  );
};
