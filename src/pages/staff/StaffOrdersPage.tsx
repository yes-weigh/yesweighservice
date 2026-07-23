import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ChevronRight, RefreshCw, ShoppingCart } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage, listDealerOrders } from '../../lib/dealerOrders';
import { formatInvoiceDate } from '../../lib/invoices';
import { canAccessNavFeature, hasStaffPermission } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';
import type { DealerOrder, DealerOrderStatus } from '../../types/dealer-orders';
import { DEALER_ORDER_STATUS_LABELS } from '../../types/dealer-orders';

type QueueTab = 'all' | DealerOrderStatus;

const TABS: Array<{ id: QueueTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending_review', label: DEALER_ORDER_STATUS_LABELS.pending_review },
  { id: 'waiting_for_payment', label: DEALER_ORDER_STATUS_LABELS.waiting_for_payment },
  { id: 'payment_submitted', label: DEALER_ORDER_STATUS_LABELS.payment_submitted },
  { id: 'processing', label: DEALER_ORDER_STATUS_LABELS.processing },
  { id: 'completed', label: DEALER_ORDER_STATUS_LABELS.completed },
  { id: 'rejected', label: DEALER_ORDER_STATUS_LABELS.rejected },
];

export const StaffOrdersPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dealerFilter = searchParams.get('dealerId')?.trim() || '';
  const base = user ? homePathForRole(user.role) : '/staff';
  const [orders, setOrders] = useState<DealerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QueueTab>(dealerFilter ? 'all' : 'pending_review');

  const canView = user?.role === 'super_admin'
    || hasStaffPermission(user, 'orders.view')
    || canAccessNavFeature(user, 'orders');

  const load = () => {
    if (!canView) return;
    setLoading(true);
    void listDealerOrders({
      limit: 200,
      ...(dealerFilter ? { dealerId: dealerFilter } : {}),
    })
      .then(rows => {
        setOrders(rows);
        setError('');
      })
      .catch(err => setError(dealerOrderErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, dealerFilter]);

  const filtered = useMemo(
    () => (tab === 'all' ? orders : orders.filter(order => order.status === tab)),
    [orders, tab],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: orders.length };
    for (const order of orders) {
      map[order.status] = (map[order.status] || 0) + 1;
    }
    return map;
  }, [orders]);

  if (!canView) {
    return (
      <div className="page-content fade-in">
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>You do not have access to orders.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in dealer-orders-page">
      <div className="dealer-orders-page__header">
        <div>
          <h2>Orders</h2>
          <p className="text-muted text-sm">
            {dealerFilter
              ? 'Filtered to one dealer.'
              : 'Review, edit, and approve dealer orders.'}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="dealer-orders-tabs" role="tablist" aria-label="Order status">
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`dealer-orders-tabs__btn${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span>{counts[item.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <FetchingLoader label="Loading orders…" />
      ) : filtered.length === 0 ? (
        <div className="orders-page__empty panel glass">
          <ShoppingCart size={48} />
          <h2>No orders in this queue</h2>
          <p className="text-muted">New dealer submissions will appear under Pending review.</p>
        </div>
      ) : (
        <ul className="dealer-orders-list">
          {filtered.map(order => (
            <li key={order.id}>
              <button
                type="button"
                className="dealer-orders-list__row panel glass"
                onClick={() => navigate(`${base}/orders/${order.id}`)}
              >
                <div className="dealer-orders-list__main">
                  <strong>{order.orderNumber}</strong>
                  <span className="text-muted text-sm">
                    {order.dealerName || order.dealerCode || order.zohoCustomerId}
                    {' · '}
                    {formatInvoiceDate(order.createdAt)}
                  </span>
                </div>
                <div className="dealer-orders-list__meta">
                  <OrderStatusBadge status={order.status} />
                  <strong>{formatCurrency(order.subtotal)}</strong>
                  <ChevronRight size={18} aria-hidden />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
