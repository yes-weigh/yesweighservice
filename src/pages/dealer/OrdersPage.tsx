import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { IndianRupee, Package, ShoppingCart, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../../components/QuantityStepper';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { useAuth } from '../../context/AuthContext';
import { CART_REMARKS_MAX_LENGTH } from '../../context/CartProvider';
import { useCart } from '../../context/useCart';
import { fetchCatalog, formatCurrency } from '../../lib/catalog';
import { isSacHsn } from '../../lib/sacCatalog';
import { dealerOrderErrorMessage, submitDealerOrder } from '../../lib/dealerOrders';
import {
  listDealerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';

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
  const {
    items,
    itemCount,
    subtotal,
    remarks,
    setRemarks,
    setQuantity,
    removeItem,
    clearCart,
  } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressesError, setAddressesError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [descByProductId, setDescByProductId] = useState<Record<string, string>>({});

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/catalog`;

  useEffect(() => {
    const missing = items.filter(item => !item.description?.trim()).map(item => item.productId);
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchCatalog()
      .then(res => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const product of res.items) {
          const desc = product.description?.trim();
          if (desc && missing.includes(product.id)) next[product.id] = desc;
        }
        if (Object.keys(next).length) setDescByProductId(prev => ({ ...prev, ...next }));
      })
      .catch(() => { /* keep cart usable without specs */ });
    return () => { cancelled = true; };
  }, [items]);

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
        remarks,
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
        <div className="orders-page__cart-column">
          <ul className="orders-page__items">
            {items.map(item => {
              const lineTotal = item.rate * item.quantity;
              const unavailable = item.stockStatus === 'out_of_stock'
                && !isSacHsn(item.hsn);

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

                  <DocumentLineItemSpec
                    className="orders-page__item-info invoice-detail-item__body"
                    name={item.name}
                    sku={item.sku}
                    description={item.description || descByProductId[item.productId] || null}
                  >
                    <div className="orders-page__item-price">
                      <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                      <span>{item.rate.toLocaleString('en-IN')}</span>
                      <span className="text-muted text-sm">/ {item.unit}</span>
                    </div>
                    {unavailable && (
                      <p className="orders-page__item-warning">Currently out of stock — remove before placing order</p>
                    )}
                  </DocumentLineItemSpec>

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

          <Link to={productsPath} className="btn btn-secondary orders-page__continue">
            Add more products
          </Link>
        </div>

        <aside className="orders-page__summary panel glass">
          <h3>Order summary</h3>
          <div className="orders-page__summary-row">
            <span>Subtotal ({itemCount} items)</span>
            <strong>{formatCurrency(subtotal)}</strong>
          </div>
          <p className="orders-page__summary-note text-muted text-sm">
            Your order is created in Zoho Inventory as Draft. After submit, only staff can change items or address.
          </p>
          <label className="orders-page__remarks">
            <span className="orders-page__remarks-label">Remarks</span>
            <textarea
              className="orders-page__remarks-input"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              disabled={submitting}
              rows={3}
              maxLength={CART_REMARKS_MAX_LENGTH}
              placeholder="Optional notes for this order (shown to staff on the sales order)"
            />
            {remarks.length > 0 && (
              <span className="orders-page__remarks-count text-muted text-sm">
                {remarks.length}/{CART_REMARKS_MAX_LENGTH}
              </span>
            )}
          </label>
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
              || items.some(i => i.stockStatus === 'out_of_stock' && !isSacHsn(i.hsn))
            }
            onClick={() => void handlePlaceOrder()}
          >
            {submitting ? 'Submitting…' : 'Place order'}
          </button>
        </aside>
      </div>
    </div>
  );
};
