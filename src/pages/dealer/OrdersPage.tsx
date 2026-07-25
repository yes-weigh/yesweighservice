import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { IndianRupee, Package, ShoppingCart, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../../components/QuantityStepper';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/useCart';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage, submitDealerOrder } from '../../lib/dealerOrders';
import {
  listDealerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import { isInternalOpsUser } from '../../lib/staffAccess';
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

  // Staff / super-admin use Zoho sales orders — cart is dealer-only.
  if (isInternalOpsUser(user)) {
    const base = user ? homePathForRole(user.role) : '/staff';
    return <Navigate to={`${base}/sales-orders`} replace />;
  }

  return <DealerCartPage />;
};

const DealerCartPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, itemCount, subtotal, setQuantity, removeItem, clearCart } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressesError, setAddressesError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/catalog`;

  const loadAddresses = useCallback(() => {
    setAddressesLoading(true);
    setAddressesError('');
    void listDealerShippingAddresses()
      .then(rows => {
        setAddresses(rows);
      })
      .catch(err => {
        setAddresses([]);
        setAddressesError(dealerOrderErrorMessage(err));
      })
      .finally(() => setAddressesLoading(false));
  }, []);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    if (!shipping) {
      window.alert('Select or enter a complete shipping address before placing the order.');
      return;
    }
    setSubmitting(true);
    try {
      const order = await submitDealerOrder(
        items.map(item => ({ productId: item.productId, quantity: item.quantity })),
        shipping,
      );
      clearCart();
      const soId = order.zohoSalesOrderId?.trim();
      navigate(
        soId ? `${base}/sales-orders/${soId}` : `${base}/sales-orders`,
        { replace: true },
      );
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
            <p className="text-muted text-sm">Add products, then place a Zoho draft sales order.</p>
          </div>
          <Link to={`${base}/sales-orders`} className="btn btn-secondary btn-sm">
            Sales orders
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
            {itemCount} {itemCount === 1 ? 'item' : 'items'} · creates a Zoho Draft sales order
          </p>
        </div>
        <div className="orders-page__header-actions">
          <Link to={`${base}/sales-orders`} className="btn btn-secondary btn-sm">
            Sales orders
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
                  <QuantityStepper
                    value={item.quantity}
                    onChange={next => setQuantity(item.productId, next)}
                    className="orders-page__qty"
                    buttonClassName="orders-page__qty-btn"
                    inputClassName="orders-page__qty-input"
                  />

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
            Your order is created in Zoho Inventory as Draft. After submit, only staff can change items or address.
          </p>
          <ShippingAddressPicker
            addresses={addresses}
            loading={addressesLoading}
            error={addressesError}
            disabled={submitting}
            value={shipping}
            onChange={setShipping}
            onRefresh={loadAddresses}
          />
          <button
            type="button"
            className="btn btn-primary orders-page__submit"
            disabled={
              submitting
              || !shipping
              || addressesLoading
              || items.some(i => i.stockStatus === 'out_of_stock')
            }
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
