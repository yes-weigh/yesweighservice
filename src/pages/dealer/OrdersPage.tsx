import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { IndianRupee, Package, ShoppingCart, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../../components/QuantityStepper';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import {
  type GatcStampingChoice,
} from '../../components/catalog/GatcStampingChoiceDialog';
import { GatcStampingInlineControl } from '../../components/catalog/GatcStampingInlineControl';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { MultiSalesOrderSuccess } from '../../components/salesOrders/MultiSalesOrderSuccess';
import { useAuth } from '../../context/AuthContext';
import { CART_REMARKS_MAX_LENGTH } from '../../context/CartProvider';
import { useCart } from '../../context/useCart';
import { cartLineBlockedByStock, fetchCatalog, formatCurrency } from '../../lib/catalog';
import { productHasLinkedGatc } from '../../lib/gatcCart';
import {
  dealerOrderErrorMessage,
  submitDealerOrder,
  type SegmentSalesOrderResult,
} from '../../lib/dealerOrders';
import {
  summarizeSegmentSiteBuckets,
} from '../../lib/salesOrderSegments';
import {
  listDealerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';
import type { CatalogProduct } from '../../types/catalog';

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
    addItem,
    updateStamping,
    clearCart,
  } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressesError, setAddressesError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [descByProductId, setDescByProductId] = useState<Record<string, string>>({});
  const [catalogById, setCatalogById] = useState<Record<string, CatalogProduct>>({});

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/catalog`;

  useEffect(() => {
    const missing = items.filter(item => !item.description?.trim()).map(item => item.productId);
    if (missing.length === 0 && items.length === 0) return;
    let cancelled = false;
    void fetchCatalog()
      .then(res => {
        if (cancelled) return;
        const nextDesc: Record<string, string> = {};
        const nextCatalog: Record<string, CatalogProduct> = {};
        for (const product of res.items) {
          nextCatalog[product.id] = product;
          const desc = product.description?.trim();
          if (desc && missing.includes(product.id)) nextDesc[product.id] = desc;
        }
        if (Object.keys(nextDesc).length) setDescByProductId(prev => ({ ...prev, ...nextDesc }));
        setCatalogById(nextCatalog);
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

  const stampableWithoutStamping = useMemo(() => {
    return items.filter(item => {
      if (item.gatcStampingPriceId) return false;
      const catalogProduct = catalogById[item.productId];
      if (catalogProduct) return productHasLinkedGatc(catalogProduct);
      // Fallback when catalog not loaded yet: treat known stampable cart fields as linked.
      return false;
    });
  }, [items, catalogById]);

  const segmentPreview = useMemo(() => {
    const lines = items.map(item => {
      const catalog = catalogById[item.productId];
      return {
        categoryId: item.categoryId ?? catalog?.categoryId ?? null,
        categoryName: item.categoryName ?? catalog?.categoryName ?? null,
        productId: item.productId,
        sku: item.sku ?? catalog?.sku ?? null,
        warehouses: catalog?.warehouses ?? null,
      };
    });
    return summarizeSegmentSiteBuckets(lines);
  }, [items, catalogById]);

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    if (!shipping) {
      window.alert('Select or enter a complete shipping address before placing the order.');
      return;
    }
    setSubmitting(true);
    try {
      const order = await submitDealerOrder(
        items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          gatcStampingPriceId: item.gatcStampingPriceId ?? null,
        })),
        shipping,
        remarks,
      );
      clearCart();
      const salesOrders = Array.isArray(order.salesOrders) && order.salesOrders.length > 0
        ? order.salesOrders
        : (order.zohoSalesOrderId
          ? [{
              segment: 'product' as const,
              segmentLabel: 'Product',
              orderNumber: order.orderNumber,
              zohoSalesOrderId: order.zohoSalesOrderId,
              zohoSalesOrderNumber: order.zohoSalesOrderNumber,
              status: order.status,
              subtotal: order.subtotal,
              itemCount: order.itemCount,
              salespersonId: null,
              salespersonName: null,
            }]
          : []);
      if (salesOrders.length > 1) {
        setCreatedOrders(salesOrders);
        return;
      }
      const soId = salesOrders[0]?.zohoSalesOrderId?.trim() || order.zohoSalesOrderId?.trim();
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

  const applyLineStamping = (cartLineId: string, choice: GatcStampingChoice) => {
    updateStamping(cartLineId, {
      withStamping: choice.withStamping,
      gatcStampingPriceId: choice.gatcStampingPriceId,
      gatcFeePerUnit: choice.gatcFeePerUnit,
      gatcStampingRange: choice.gatcStampingRange,
    });
  };

  if (createdOrders && createdOrders.length > 0) {
    return (
      <div className="page-content fade-in orders-page">
        <div className="dealer-orders-page__header">
          <div>
            <h2 className="orders-page__title">Order placed</h2>
            <p className="text-muted text-sm">Draft sales orders were created in Zoho Inventory.</p>
          </div>
        </div>
        <MultiSalesOrderSuccess
          salesOrders={createdOrders}
          detailBasePath={`${base}/sales-orders`}
          listPath={`${base}/sales-orders`}
        />
      </div>
    );
  }

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
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
            {segmentPreview.length > 1
              ? ` · creates ${segmentPreview.length} Zoho Draft sales orders (${segmentPreview.map(b => b.label).join(', ')})`
              : segmentPreview[0]
                ? ` · creates a Zoho Draft sales order (${segmentPreview[0].label})`
                : ' · creates a Zoho Draft sales order'}
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

      {stampableWithoutStamping.length > 0 && (
        <div className="orders-page__stamp-reminder panel glass" role="status">
          <p>
            {stampableWithoutStamping.length === 1
              ? '1 item can have stamping added.'
              : `${stampableWithoutStamping.length} items can have stamping added.`}
            {' '}
            Use the stamping control on the line, or <strong>+ Add with stamping</strong> for a separate stamped line.
          </p>
        </div>
      )}

      <div className="orders-page__layout">
        <div className="orders-page__cart-column">
          <ul className="orders-page__items">
            {items.map(item => {
              const lineTotal = item.rate * item.quantity;
              const unavailable = cartLineBlockedByStock(item);
              const catalogProduct = catalogById[item.productId];
              const canEditStamp = catalogProduct
                ? productHasLinkedGatc(catalogProduct)
                : Boolean(item.gatcStampingPriceId);
              const hasStamping = Boolean(item.gatcStampingPriceId);
              const usedGatcIds = items
                .filter(other => other.productId === item.productId && other.gatcStampingPriceId)
                .map(other => String(other.gatcStampingPriceId));
              const hasUnstampedSibling = items.some(
                other => other.productId === item.productId && !other.gatcStampingPriceId,
              );

              return (
                <li
                  key={item.cartLineId}
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
                    {item.gatcFeePerUnit > 0 ? (
                      <span className="orders-page__item-price-breakdown text-muted">
                        {item.baseRate.toLocaleString('en-IN')}
                        {' + '}
                        {item.gatcFeePerUnit.toLocaleString('en-IN')} stamping
                        {item.gatcStampingRange ? ` (${item.gatcStampingRange})` : ''}
                      </span>
                    ) : canEditStamp ? null : (
                      <span className="orders-page__item-price-breakdown text-muted">
                        Without stamping
                      </span>
                    )}
                    {canEditStamp && catalogProduct && (
                      <GatcStampingInlineControl
                        product={catalogProduct}
                        valueId={item.gatcStampingPriceId}
                        hasStamping={hasStamping}
                        usedGatcIds={usedGatcIds}
                        hasUnstampedSibling={hasUnstampedSibling}
                        disabled={submitting}
                        onChange={choice => applyLineStamping(item.cartLineId, choice)}
                        onAddSibling={choice => {
                          if (!choice.withStamping) {
                            addItem(catalogProduct, {
                              quantity: 1,
                              insertAfterCartLineId: item.cartLineId,
                            });
                            return;
                          }
                          addItem(catalogProduct, {
                            quantity: 1,
                            insertAfterCartLineId: item.cartLineId,
                            gatcStampingPriceId: choice.gatcStampingPriceId,
                            gatcFeePerUnit: choice.gatcFeePerUnit,
                            gatcStampingRange: choice.gatcStampingRange,
                          });
                        }}
                      />
                    )}
                    {unavailable && (
                      <p className="orders-page__item-warning">Currently out of stock — remove before placing order</p>
                    )}
                  </DocumentLineItemSpec>

                  <div className="orders-page__item-actions">
                    <QuantityStepper
                      value={item.quantity}
                      onChange={next => setQuantity(item.cartLineId, next)}
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
                      onClick={() => removeItem(item.cartLineId)}
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
            {segmentPreview.length > 1
              ? `This cart will create ${segmentPreview.length} draft sales orders: ${segmentPreview.map(segmentLabel).join(', ')}. Each order type uses its own Zoho salesperson.`
              : 'Your order is created in Zoho Inventory as Draft. After submit, only staff can change items or address.'}
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
              || items.some(cartLineBlockedByStock)
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
