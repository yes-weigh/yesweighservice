import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, ShoppingCart } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { formatInvoiceDate } from '../../lib/invoices';
import { dealerOrderErrorMessage, listDealerOrders } from '../../lib/dealerOrders';
import { homePathForRole } from '../../types';
import type { DealerOrder } from '../../types/dealer-orders';

export const DealerOrderHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = user ? homePathForRole(user.role) : '/dealer';
  const [orders, setOrders] = useState<DealerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listDealerOrders({ limit: 100 })
      .then(rows => {
        if (!cancelled) {
          setOrders(rows);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) setError(dealerOrderErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page-content fade-in dealer-orders-page">
      <div className="dealer-orders-page__header">
        <div>
          <h2>My orders</h2>
          <p className="text-muted text-sm">Track submissions, approvals, and payments.</p>
        </div>
        <Link to={`${base}/orders`} className="btn btn-secondary btn-sm">
          <ShoppingCart size={16} aria-hidden /> Cart
        </Link>
      </div>

      {error && (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <FetchingLoader label="Loading orders…" />
      ) : orders.length === 0 ? (
        <div className="orders-page__empty panel glass">
          <ShoppingCart size={48} />
          <h2>No orders yet</h2>
          <p className="text-muted">Place an order from your cart to see it here.</p>
          <Link to={`${base}/orders`} className="btn btn-primary">Go to cart</Link>
        </div>
      ) : (
        <ul className="dealer-orders-list">
          {orders.map(order => (
            <li key={order.id}>
              <button
                type="button"
                className="dealer-orders-list__row panel glass"
                onClick={() => navigate(`${base}/orders/${order.id}`)}
              >
                <div className="dealer-orders-list__main">
                  <strong>{order.orderNumber}</strong>
                  <span className="text-muted text-sm">
                    {formatInvoiceDate(order.createdAt)} · {order.itemCount} items
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
