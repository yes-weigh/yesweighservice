import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IndianRupee, Minus, Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/useCart';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage, submitDealerOrder } from '../../lib/dealerOrders';
import { canAccessNavFeature, hasStaffPermission, isInternalOpsUser } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';
import { StaffOrdersPage } from '../staff/StaffOrdersPage';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const OrdersPage: React.FC = () => {
  const { user } = useAuth();

  // Staff / super-admin see the review queue, not the dealer cart.
  if (isInternalOpsUser(user) && (
    user?.role === 'super_admin'
    || hasStaffPermission(user, 'orders.view')
    || canAccessNavFeature(user, 'orders')
  )) {
    return <StaffOrdersPage />;
  }

  return <DealerCartPage />;
};

const DealerCartPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, itemCount, subtotal, setQuantity, removeItem, clearCart } = useCart();
  const [submitting, setSubmitting] = useState(false);

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/catalog`;

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const order = await submitDealerOrder(
        items.map(item => ({ productId: item.productId, quantity: item.quantity })),
      );
      clearCart();
      navigate(`${base}/orders/${order.id}`, { replace: true });
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="page-content fade-in orders-page">
        <div className="dealer-orders-page__header">
          <div>
            <h2 className="orders-page__title">Your cart</h2>
            <p className="text-muted text-sm">Add products, then place an order for review.</p>
          </div>
          <Link to={`${base}/orders/history`} className="btn btn-secondary btn-sm">
            My orders
          </Link>
        </div>
        <div className="orders-page__empty panel glass">
          <ShoppingCart size={48} />
          <h2>Your cart is empty</h2>
          <p className="text-muted">Browse products and add items to build your order.</p>
          <Link to={productsPath} className="btn btn-primary">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content fade-in orders-page">
      <div className="orders-page__header">
        <div>
          <h2 className="orders-page__title">Your cart</h2>
          <p className="text-muted text-sm">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · submitted orders go for staff review
          </p>
        </div>
        <div className="orders-page__header-actions">
          <Link to={`${base}/orders/history`} className="btn btn-secondary btn-sm">
            My orders
          </Link>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearCart}>
            Clear cart
          </button>
        </div>
      </div>

      <div className="orders-page__layout">
        <ul className="orders-page__items">
          {items.map(item => {
            const lineTotal = item.rate * item.quantity;
            const unavailable = item.stockStatus === 'out_of_stock';

            return (
              <li
                key={item.productId}
                className={`orders-page__item panel glass ${unavailable ? 'orders-page__item--unavailable' : ''}`}
              >
                <div className="orders-page__item-media">
                  {item.imageUrl ? (
                    <CategoryThumbnail src={item.imageUrl} knockout={false} />
                  ) : (
                    <Package size={28} aria-hidden />
                  )}
                </div>

                <div className="orders-page__item-info">
                  {item.sku && <span className="orders-page__item-sku">{item.sku}</span>}
                  <h3>{formatProductTitle(item.name)}</h3>
                  {item.categoryName && (
                    <p className="orders-page__item-category text-muted text-sm">{item.categoryName}</p>
                  )}
                  <div className="orders-page__item-price">
                    <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                    <span>{item.rate.toLocaleString('en-IN')}</span>
                    <span className="text-muted text-sm">/ {item.unit}</span>
                  </div>
                  {unavailable && (
                    <p className="orders-page__item-warning">Currently out of stock — remove before placing order</p>
                  )}
                </div>

                <div className="orders-page__item-actions">
                  <div className="orders-page__qty" aria-label="Quantity">
                    <button
                      type="button"
                      className="orders-page__qty-btn"
                      onClick={() => setQuantity(item.productId, item.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="orders-page__qty-value">{item.quantity}</span>
                    <button
                      type="button"
                      className="orders-page__qty-btn"
                      onClick={() => setQuantity(item.productId, item.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  <div className="orders-page__line-total">
                    <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                    <span>{lineTotal.toLocaleString('en-IN')}</span>
                  </div>

                  <button
                    type="button"
                    className="orders-page__remove"
                    onClick={() => removeItem(item.productId)}
                    aria-label="Remove from cart"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="orders-page__summary panel glass">
          <h3>Order summary</h3>
          <div className="orders-page__summary-row">
            <span>Subtotal ({itemCount} items)</span>
            <strong>{formatCurrency(subtotal)}</strong>
          </div>
          <p className="orders-page__summary-note text-muted text-sm">
            Staff will review quantities and confirm the final amount before payment.
          </p>
          <button
            type="button"
            className="btn btn-primary orders-page__submit"
            disabled={submitting || items.some(i => i.stockStatus === 'out_of_stock')}
            onClick={() => void handlePlaceOrder()}
          >
            {submitting ? 'Submitting…' : 'Place order'}
          </button>
          <Link to={productsPath} className="btn btn-secondary orders-page__continue">
            Add more products
          </Link>
        </aside>
      </div>
    </div>
  );
};
