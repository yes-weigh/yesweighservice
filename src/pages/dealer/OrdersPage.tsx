import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { IndianRupee, Package, ShoppingCart, Trash2 } from 'lucide-react';
import { QuantityStepper } from '../../components/QuantityStepper';
import { DelhiveryQuoteStrip } from '../../components/logistics/DelhiveryQuoteStrip';
import { OrderFreightPanel } from '../../components/orders/OrderFreightPanel';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { inferStCourierZone } from '../../lib/stCourierZone';
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
import { useDealerPriceLevels } from '../../hooks/useDealerUnitPrice';
import { useDealerOrderStockGate } from '../../hooks/useDealerOrderStockGate';
import { cartLineIsOutOfStock, fetchCatalog, formatCurrency } from '../../lib/catalog';
import {
  DEALER_ORDER_SCHEDULED_MESSAGE,
  DEALER_ORDER_UNAVAILABLE_MESSAGE,
  dealerCanOrderProduct,
  dealerOrderUsesScheduledInbound,
} from '../../lib/dealerOrderStock';
import {
  DIRECTORS_QTY_CLUB_LABEL,
  isDirectorsQtyClubSku,
  priceLevelSkipsOpsReview,
} from '../../lib/priceLevels';
import { productHasLinkedGatc } from '../../lib/gatcCart';
import {
  dealerOrderErrorMessage,
  submitDealerOrder,
  type SegmentSalesOrderResult,
} from '../../lib/dealerOrders';
import { selectedPartnerIsDelhivery } from '../../lib/delhiveryCartFreight';
import {
  summarizeSegmentSiteBuckets,
} from '../../lib/salesOrderSegments';
import {
  listDealerShippingAddresses,
  resolveShippingDestination,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { useBlueDartPincode } from '../../hooks/useBlueDartPincode';
import { useDelhiveryLiveFreightQuote } from '../../hooks/useDelhiveryLiveFreightQuote';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import type { InventorySite } from '../../lib/salesOrderSegments';
import {
  applyCourierSelectionForSite,
  cartLinesForFreightEstimate,
  estimateStCourierCartFreight,
  resolveSubmitCourierBySite,
  type StCourierCartFreightEstimate,
} from '../../lib/stCourierCartFreight';
import {
  fetchPendingFreightDiff,
  formatPendingFreightAdjustLabel,
  type PendingFreightDiffPreview,
} from '../../lib/freightDiffSettlement';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { homePathForRole } from '../../types';
import type { CatalogProduct } from '../../types/catalog';
import type { LogisticsCourierRates } from '../../types/logistics-courier-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../types/logistics-partner-status';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

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
  const { level: dealerPriceLevel } = useDealerPriceLevels();
  const dealerStock = useDealerOrderStockGate();
  const skipsOpsReview = priceLevelSkipsOpsReview(dealerPriceLevel);
  const [submitting, setSubmitting] = useState(false);
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressesError, setAddressesError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [descByProductId, setDescByProductId] = useState<Record<string, string>>({});
  const [catalogById, setCatalogById] = useState<Record<string, CatalogProduct>>({});
  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [partnerStatuses, setPartnerStatuses] = useState<LogisticsPartnerStatuses | null>(null);
  const [courierBySite, setCourierBySite] = useState<Partial<Record<InventorySite, LogisticsPartnerId>>>({});
  const [fromAddresses, setFromAddresses] = useState<Partial<Record<StaffLogisticsSite, string>>>({});
  const [freightBillingMode, setFreightBillingMode] = useState<'btc' | 'fod'>('btc');
  const [freightAdjustAgreed, setFreightAdjustAgreed] = useState(true);
  const [pendingFreightDiff, setPendingFreightDiff] = useState<PendingFreightDiffPreview | null>(null);

  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsPath = `${base}/products`;

  const shippingDestination = useMemo(
    () => resolveShippingDestination(shipping, addresses),
    [shipping, addresses],
  );
  const blueDartPin = useBlueDartPincode(shippingDestination?.zip);
  const inferredFreightZone = useMemo(
    () => inferStCourierZone(shippingDestination),
    [shippingDestination],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadLogisticsCourierRates(), loadLogisticsSettings()])
      .then(([rates, settings]) => {
        if (cancelled) return;
        setCourierRates(rates);
        setDeliveryRules(settings.deliveryRules);
        setPartnerStatuses(settings.partnerStatuses);
        setFromAddresses(settings.fromAddresses || {});
      })
      .catch(() => { /* freight preview optional */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPendingFreightDiff()
      .then(preview => {
        if (!cancelled) setPendingFreightDiff(preview);
      })
      .catch(() => {
        if (!cancelled) setPendingFreightDiff(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    void fetchCatalog()
      .then(res => {
        if (cancelled) return;
        const missing = items.filter(item => !item.description?.trim()).map(item => item.productId);
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

  const freightEstimateBase = useMemo((): StCourierCartFreightEstimate | null => {
    if (!courierRates || !deliveryRules || !partnerStatuses || items.length === 0) return null;
    if (!shippingDestination || !inferredFreightZone) return null;
    return estimateStCourierCartFreight({
      lines: cartLinesForFreightEstimate(items, catalogById),
      destination: shippingDestination,
      rates: courierRates,
      deliveryRules,
      partnerStatuses,
      courierBySite,
      blueDartPin,
      invoiceValueInr: subtotal,
    });
  }, [
    courierRates,
    deliveryRules,
    partnerStatuses,
    items,
    shippingDestination,
    catalogById,
    courierBySite,
    inferredFreightZone,
    blueDartPin,
    subtotal,
  ]);

  const delhiveryLive = useDelhiveryLiveFreightQuote({
    estimate: freightEstimateBase,
    originAddress: fromAddresses.cochin || fromAddresses.head_office || '',
    destinationPin: shippingDestination?.zip,
    invoiceValueInr: subtotal,
    freightBillingMode,
  });

  const freightEstimate = delhiveryLive.estimateWithLive ?? freightEstimateBase;

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

  /** Spare-only cart: partner choice only; freight ₹ set later by staff. */
  const cartIsSpareOnly = useMemo(
    () => segmentPreview.length > 0 && segmentPreview.every(b => b.segment === 'spare'),
    [segmentPreview],
  );

  /** Checkout total: items + estimated freight (+ pending Diff) + GST (catalog tax %, freight default 18%). */
  const checkoutTotals = useMemo(() => {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const defaultGstPct = 18;
    let itemsGst = 0;
    for (const item of items) {
      const line = round2(item.rate * item.quantity);
      const pct = catalogById[item.productId]?.taxPercentage;
      const taxPct = Number.isFinite(pct) && (pct as number) > 0 ? (pct as number) : defaultGstPct;
      itemsGst += round2(line * (taxPct / 100));
    }
    const baseFreight = (
      cartIsSpareOnly
        ? 0
        : (
          freightEstimate?.usable
            ? round2(Number(freightEstimate.totalInr) || 0)
            : 0
        )
    );
    const adjust = (
      !cartIsSpareOnly
      && pendingFreightDiff?.willApplyOnNextFreightSo
      && baseFreight > 0
        ? round2(Number(pendingFreightDiff.availableInr) || 0)
        : 0
    );
    const freight = round2(Math.max(0, baseFreight + adjust));
    const freightGst = freight > 0 ? round2(freight * (defaultGstPct / 100)) : 0;
    const gst = round2(itemsGst + freightGst);
    const fodZero = !cartIsSpareOnly
      && freightBillingMode === 'fod'
      && selectedPartnerIsDelhivery(freightEstimate);
    return {
      freight,
      freightAdjust: adjust,
      gst,
      total: round2(subtotal + freight + gst),
      hasFreight: Boolean(
        !cartIsSpareOnly
        && freightEstimate?.usable
        && (baseFreight > 0 || Math.abs(adjust) > 0 || fodZero),
      ),
      freightDeferred: cartIsSpareOnly,
    };
  }, [
    items,
    catalogById,
    freightEstimate,
    subtotal,
    pendingFreightDiff,
    freightBillingMode,
    cartIsSpareOnly,
  ]);

  const { inboundByProductId } = dealerStock;
  const unorderableItems = useMemo(() => items.filter(item => {
    const product = catalogById[item.productId];
    const inbound = inboundByProductId[item.productId] ?? 0;
    if (product) return !dealerCanOrderProduct(product, inbound);
    if (inbound > 0) return false;
    return cartLineIsOutOfStock(item);
  }), [items, catalogById, inboundByProductId]);

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    if (unorderableItems.length > 0) {
      window.alert(
        unorderableItems.length === 1
          ? `${unorderableItems[0].name} is out of stock and is not scheduled on a goods receipt.`
          : `${unorderableItems.length} items are out of stock and not scheduled on a goods receipt.`,
      );
      return;
    }
    if (!shipping) {
      window.alert('Select or enter a complete shipping address before placing the order.');
      return;
    }
    if (
      !cartIsSpareOnly
      && selectedPartnerIsDelhivery(freightEstimate)
      && freightBillingMode !== 'fod'
      && !(delhiveryLive.preTaxInr != null && delhiveryLive.preTaxInr > 0)
    ) {
      window.alert(
        delhiveryLive.loading
          ? 'Still estimating Delhivery freight. Try again in a moment.'
          : (delhiveryLive.error || 'Delhivery freight estimate is unavailable for this destination.'),
      );
      return;
    }
    setSubmitting(true);
    try {
      const courierSelection = resolveSubmitCourierBySite(freightEstimate, courierBySite);
      const delhiveryFreight = (
        !cartIsSpareOnly
        && selectedPartnerIsDelhivery(freightEstimate)
      )
        ? (
          freightBillingMode === 'fod'
            ? 0
            : (
              delhiveryLive.preTaxInr != null && delhiveryLive.preTaxInr > 0
                ? Math.ceil(delhiveryLive.preTaxInr)
                : undefined
            )
        )
        : undefined;
      const order = await submitDealerOrder(
        items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          gatcStampingPriceId: item.gatcStampingPriceId ?? null,
        })),
        shipping,
        remarks,
        courierSelection,
        inferredFreightZone ?? undefined,
        undefined,
        delhiveryFreight,
        selectedPartnerIsDelhivery(freightEstimate) && !cartIsSpareOnly
          ? freightBillingMode
          : undefined,
      );
      clearCart();
      setFreightBillingMode('btc');
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
            {skipsOpsReview
              ? (segmentPreview.length > 1
                ? ` · creates ${segmentPreview.length} sales orders (${segmentPreview.map(b => b.label).join(', ')})`
                : segmentPreview[0]
                  ? ` · creates a sales order (${segmentPreview[0].label})`
                  : ' · creates a sales order')
              : (segmentPreview.length > 1
                ? ` · creates ${segmentPreview.length} Zoho Draft sales orders (${segmentPreview.map(b => b.label).join(', ')})`
                : segmentPreview[0]
                  ? ` · creates a Zoho Draft sales order (${segmentPreview[0].label})`
                  : ' · creates a Zoho Draft sales order')}
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
              const catalogProduct = catalogById[item.productId];
              const scheduledQty = dealerStock.scheduledQty(item.productId);
              const canOrderLine = catalogProduct
                ? dealerCanOrderProduct(catalogProduct, scheduledQty)
                : scheduledQty > 0 || !cartLineIsOutOfStock(item);
              const inboundOnly = catalogProduct
                ? dealerOrderUsesScheduledInbound(catalogProduct, scheduledQty)
                : cartLineIsOutOfStock(item) && scheduledQty > 0;
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
                  className={`orders-page__item panel glass ${!canOrderLine ? 'orders-page__item--unavailable' : ''}`}
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
                      {(item.priceLevelMode === 'discount' || item.priceLevelMode === 'fixed')
                        && item.listRate != null
                        && item.listRate > item.baseRate ? (
                        <>
                          <span className="orders-page__item-list-rate">
                            <IndianRupee size={12} strokeWidth={2.5} aria-hidden />
                            {item.listRate.toLocaleString('en-IN')}
                          </span>
                          <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                          <span>{item.rate.toLocaleString('en-IN')}</span>
                        </>
                      ) : (
                        <>
                          <IndianRupee size={14} strokeWidth={2.5} aria-hidden />
                          <span>{item.rate.toLocaleString('en-IN')}</span>
                        </>
                      )}
                      <span className="text-muted text-sm">/ {item.unit}</span>
                      {item.priceLevelSlabs && item.priceLevelSlabs.length > 1 ? (
                        <ul className="orders-page__item-slabs" aria-label="Quantity rates">
                          {item.priceLevelSlabs.map((slab, idx) => {
                            const next = item.priceLevelSlabs![idx + 1];
                            const label = next
                              ? `Qty ${slab.minQty}–${next.minQty - 1}`
                              : `Qty ${slab.minQty}+`;
                            return (
                              <li key={`${slab.minQty}-${slab.rate}`}>
                                <span>{label}</span>
                                <span>₹{slab.rate.toLocaleString('en-IN')}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {isDirectorsQtyClubSku(item.sku)
                        && item.priceLevelSlabs
                        && item.priceLevelSlabs.length > 1 ? (
                        <p className="orders-page__item-club-note">
                          {DIRECTORS_QTY_CLUB_LABEL}
                        </p>
                      ) : null}
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
                    {!canOrderLine && (
                      <p className="orders-page__item-warning orders-page__item-warning--blocked">
                        {DEALER_ORDER_UNAVAILABLE_MESSAGE}
                      </p>
                    )}
                    {inboundOnly && (
                      <p className="orders-page__item-warning">
                        {DEALER_ORDER_SCHEDULED_MESSAGE}
                      </p>
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
            {skipsOpsReview
              ? (segmentPreview.length > 1
                ? `This cart will create ${segmentPreview.length} sales orders: ${segmentPreview.map(b => b.label).join(', ')}. Directors price level skips review — payment will be due as soon as you submit.`
                : 'Directors price level skips review. After submit, payment is due (Awaiting payment). Staff can still change items or address until you pay.')
              : (segmentPreview.length > 1
                ? `This cart will create ${segmentPreview.length} draft sales orders: ${segmentPreview.map(b => b.label).join(', ')}. Each order type and branch uses its own Zoho salesperson.`
                : segmentPreview[0]
                  ? `Your order is created in Zoho Inventory as Draft (${segmentPreview[0].label}). After submit, only staff can change items or address.`
                  : 'Your order is created in Zoho Inventory as Draft. After submit, only staff can change items or address.')}
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
            allowManage
          />
          {freightEstimate?.usable ? (
            <>
              <OrderFreightPanel
                estimate={freightEstimate}
                canEditPackage={false}
                showFreightChargePlan={false}
                clubSites
                hideFreightAmounts={cartIsSpareOnly}
                deferFreightMessage={
                  cartIsSpareOnly
                    ? 'Freight will be updated later by our team after packing (LBH / weight).'
                    : null
                }
                catalogById={catalogById}
                destinationLabel={[
                  shippingDestination?.city,
                  shippingDestination?.state,
                ].filter(Boolean).join(', ') || null}
                footerNote={
                  cartIsSpareOnly
                    ? 'Choose a logistics partner (or Customer Pickup). No freight amount is charged on this order yet.'
                    : 'Estimated freight for this order. Delhivery BTC uses a live API quote; FOD keeps the Delhivery line at ₹0 (consignee pays).'
                }
                freightBillingMode={freightBillingMode}
                onFreightBillingModeChange={setFreightBillingMode}
                onCourierChange={(site, partnerId) => {
                  if (partnerId !== 'delhivery') setFreightBillingMode('btc');
                  setCourierBySite(prev => applyCourierSelectionForSite(
                    prev,
                    site,
                    partnerId,
                    freightEstimate?.sites.map(s => s.site),
                  ));
                }}
              />
              {!cartIsSpareOnly
                && delhiveryLive.showStrip
                && selectedPartnerIsDelhivery(freightEstimate) ? (
                <DelhiveryQuoteStrip
                  originPin={delhiveryLive.originPin || null}
                  destinationPin={delhiveryLive.destinationPin}
                  weightKg={freightEstimate.totalChargeableKg || 5}
                  invAmount={subtotal}
                  freightBillingMode={freightBillingMode}
                  includeEstimate={false}
                  compact
                />
              ) : null}
            </>
          ) : !shipping && !addressesLoading ? (
            <p className="orders-page__freight-note text-muted text-sm">
              Select a shipping address to see freight and courier options.
            </p>
          ) : null}
          <div className="orders-page__checkout-total" aria-label="Order total">
            <div className="orders-page__summary-row">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="orders-page__summary-row">
              <span>Freight</span>
              <span>
                {checkoutTotals.freightDeferred
                  ? 'Updated later'
                  : checkoutTotals.hasFreight
                    ? formatCurrency(checkoutTotals.freight)
                    : '—'}
              </span>
            </div>
            {!checkoutTotals.freightDeferred && checkoutTotals.freightAdjust !== 0 ? (
              <p className="orders-page__freight-note text-muted text-sm" style={{ margin: 0 }}>
                {formatPendingFreightAdjustLabel(checkoutTotals.freightAdjust)}
                {pendingFreightDiff?.sourceInvoiceNumber
                  ? ` (${pendingFreightDiff.sourceInvoiceNumber})`
                  : ''}
              </p>
            ) : null}
            <div className="orders-page__summary-row">
              <span>GST</span>
              <span>{formatCurrency(checkoutTotals.gst)}</span>
            </div>
            <div className="orders-page__summary-row orders-page__summary-row--total">
              <span>Total</span>
              <strong>{formatCurrency(checkoutTotals.total)}</strong>
            </div>
          </div>
          <label className="orders-page__freight-agree">
            <input
              type="checkbox"
              checked={freightAdjustAgreed}
              disabled={submitting}
              onChange={e => setFreightAdjustAgreed(e.target.checked)}
            />
            <span>
              I agree that any difference in actual freight charges may be adjusted in my next order/bill.
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary orders-page__submit"
            disabled={
              submitting
              || !shipping
              || addressesLoading
              || !freightAdjustAgreed
              || unorderableItems.length > 0
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
