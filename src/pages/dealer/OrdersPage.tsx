import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IndianRupee, Minus, Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/useCart';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const OrdersPage: React.FC = () => {
  const { user } = useAuth();
  const { items, itemCount, subtotal, setQuantity, removeItem, clearCart } = useCart();
  const [orderPlaced, setOrderPlaced] = useState(false);

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/catalog`;

  const handlePlaceOrder = () => {
    if (items.length === 0) return;
    setOrderPlaced(true);
    clearCart();
  };

  if (orderPlaced) {
    return (
      <div className="page-content fade-in orders-page">
        <div className="orders-page__success panel glass">
          <ShoppingCart size={48} />
          <h2>Order submitted</h2>
          <p className="text-muted">
            Your cart has been submitted for processing. Our team will confirm availability and
            follow up shortly.
          </p>
          <Link to={productsPath} className="btn btn-primary">
            Continue shopping
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="page-content fade-in orders-page">
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
          <h2 className="orders-page__title">Your order</h2>
          <p className="text-muted text-sm">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={clearCart}>
          Clear cart
        </button>
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
                    <CategoryThumbnail src={item.imageUrl} />
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
                    <p className="orders-page__item-warning">Currently out of stock — may delay fulfilment</p>
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
            Taxes and shipping will be confirmed when your order is processed.
          </p>
          <button type="button" className="btn btn-primary orders-page__submit" onClick={handlePlaceOrder}>
            Place order
          </button>
          <Link to={productsPath} className="btn btn-secondary orders-page__continue">
            Add more products
          </Link>
        </aside>
      </div>
    </div>
  );
};
