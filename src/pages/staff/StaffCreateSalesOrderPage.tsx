import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Package, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { MultiSalesOrderSuccess } from '../../components/salesOrders/MultiSalesOrderSuccess';
import { ThemeSelect } from '../../components/ThemeSelect';
import { QuantityStepper } from '../../components/QuantityStepper';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/useCart';
import { formatCurrency } from '../../lib/catalog';
import { combinedCartRate } from '../../lib/gatcCart';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../lib/dealer-cache';
import {
  dealerOrderErrorMessage,
  type SegmentSalesOrderResult,
} from '../../lib/dealerOrders';
import {
  dealerMatchesLogisticsQuery,
  zohoDealerContactPerson,
  zohoDealerToSnapshot,
} from '../../lib/logisticsDealers';
import {
  catalogProductAllowedForUser,
  classifyOrderLineSegment,
  segmentLabel,
  summarizeSegments,
} from '../../lib/salesOrderSegments';
import { hasStaffPermission, isFullSuperAdmin } from '../../lib/staffAccess';
import { createStaffSalesOrder } from '../../lib/salesOrderWorkflow';
import {
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import {
  listZohoSalespersons,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import type { ZohoDealer } from '../../types/dealers';
import type { User } from '../../types';
import type { CartItem } from '../../types/cart';

type SelectedDealer = {
  id: string;
  label: string;
  contactPerson: string | null;
  mobile: string | null;
};

function userHasLinkedSalesperson(user: User | null | undefined): boolean {
  if (!user) return false;
  if (String(user.zohoSalespersonId ?? '').trim()) return true;
  if (Array.isArray(user.zohoSalespersonIds)
    && user.zohoSalespersonIds.some(id => String(id ?? '').trim())) {
    return true;
  }
  if (Array.isArray(user.zohoSalespersonLinks)
    && user.zohoSalespersonLinks.some(link => String(link?.id ?? '').trim())) {
    return true;
  }
  return false;
}

function toSelectedDealer(dealer: ZohoDealer): SelectedDealer {
  const snapshot = zohoDealerToSnapshot(dealer);
  const label = snapshot.name;
  const contactPerson = zohoDealerContactPerson(dealer);
  return {
    id: dealer.id,
    label,
    contactPerson: contactPerson !== '—' && contactPerson !== label ? contactPerson : null,
    mobile: snapshot.mobile !== '—' ? snapshot.mobile : null,
  };
}

export const StaffCreateSalesOrderPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    items: cartItems,
    setQuantity,
    removeItem,
    clearCart,
    remarks: cartRemarks,
    setRemarks: setCartRemarks,
  } = useCart();
  const canManage = hasStaffPermission(user, 'orders.manage');
  const listPath = pathname.startsWith('/super-admin')
    ? '/super-admin/sales-orders'
    : '/staff/sales-orders';
  const catalogPath = pathname.startsWith('/super-admin')
    ? '/super-admin/catalog'
    : '/staff/catalog';

  const [dealerQuery, setDealerQuery] = useState('');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<SelectedDealer | null>(null);

  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [salespersonId, setSalespersonId] = useState('');
  const [salespersons, setSalespersons] = useState<ZohoSalespersonOption[]>([]);
  const [salespersonsLoading, setSalespersonsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  /** Optional base-rate overrides keyed by cart line id. */
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});

  const allowedItems = useMemo(
    () => cartItems.filter(item => catalogProductAllowedForUser(user, item)),
    [cartItems, user],
  );

  const lines = useMemo(() => (
    allowedItems.map(item => {
      const override = rateOverrides[item.cartLineId];
      const catalogRate = override != null ? override : item.baseRate;
      return {
        ...item,
        catalogRate,
        rate: combinedCartRate(catalogRate, item.gatcFeePerUnit),
      };
    })
  ), [allowedItems, rateOverrides]);

  const hasProductLines = useMemo(
    () => lines.some(line => classifyOrderLineSegment(line) === 'product'),
    [lines],
  );
  const segmentPreview = useMemo(() => summarizeSegments(lines), [lines]);
  const needsSalespersonPicker = isFullSuperAdmin(user)
    && !userHasLinkedSalesperson(user)
    && hasProductLines;

  useCatalogPageHeader({
    title: 'New sales order',
    showBack: true,
    onBack: () => navigate(listPath),
    mobileCompactHeader: true,
  }, true);

  useEffect(() => {
    if (!canManage) {
      navigate(listPath, { replace: true });
    }
  }, [canManage, navigate, listPath]);

  useEffect(() => {
    if (!needsSalespersonPicker) return;
    let cancelled = false;
    setSalespersonsLoading(true);
    void listZohoSalespersons()
      .then(rows => {
        if (!cancelled) setSalespersons(rows.filter(row => row.active));
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load salespersons.');
          setSalespersons([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSalespersonsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsSalespersonPicker]);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedDealers();
    if (cached?.length) {
      setDealers(cached);
      setDealersLoading(false);
    } else {
      setDealersLoading(true);
    }

    const unsubscribe = subscribeDealerCache((list, complete) => {
      if (cancelled) return;
      setDealers(list);
      if (complete || list.length > 0) setDealersLoading(false);
    });

    void ensureDealersCached()
      .then(list => {
        if (!cancelled) {
          setDealers(list);
          setDealersLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled && !peekCachedDealers()?.length) {
          setDealers([]);
          setDealersLoading(false);
          setError(err instanceof Error ? err.message : 'Could not load dealers.');
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const filteredDealers = useMemo(() => {
    const q = dealerQuery.trim();
    if (q.length < 2) return [];
    return dealers
      .filter(dealer => dealerMatchesLogisticsQuery(dealer, q))
      .slice(0, 40);
  }, [dealers, dealerQuery]);

  const loadAddresses = useCallback(async (customerId: string) => {
    setAddressesLoading(true);
    setAddressError('');
    setShipping(null);
    try {
      const next = await listCustomerShippingAddresses(customerId);
      setAddresses(next);
    } catch (err) {
      setAddresses([]);
      setAddressError(err instanceof Error ? err.message : 'Could not load addresses.');
    } finally {
      setAddressesLoading(false);
    }
  }, []);

  const selectDealer = (dealer: ZohoDealer) => {
    setSelectedDealer(toSelectedDealer(dealer));
    setDealerQuery('');
    setError('');
    void loadAddresses(dealer.id);
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.rate * line.quantity, 0),
    [lines],
  );

  const canSubmit = Boolean(
    lines.length
    && selectedDealer
    && shipping
    && (!needsSalespersonPicker || salespersonId.trim()),
  );

  const setLineBaseRate = (cartLineId: string, baseRate: number) => {
    const nextBase = Number.isFinite(baseRate) && baseRate >= 0
      ? Math.round(baseRate * 100) / 100
      : 0;
    setRateOverrides(prev => ({ ...prev, [cartLineId]: nextBase }));
  };

  const save = async (stage: 'review' | 'ready_for_payment') => {
    if (!selectedDealer) {
      setError('Select a dealer.');
      return;
    }
    if (!lines.length) {
      setError('Add items from the catalog (cart icon on allowed products).');
      return;
    }
    if (!shipping) {
      setError('Select a shipping address.');
      return;
    }
    if (needsSalespersonPicker && !salespersonId.trim()) {
      setError('Select a salesperson for the product sales order.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createStaffSalesOrder({
        zohoCustomerId: selectedDealer.id,
        lines: lines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          rate: line.catalogRate,
          gatcStampingPriceId: line.gatcStampingPriceId ?? null,
        })),
        shipping,
        stage,
        remarks: cartRemarks.trim(),
        ...(needsSalespersonPicker
          ? { salespersonId: salespersonId.trim() }
          : {}),
      });
      clearCart();
      setRateOverrides({});
      const salesOrders = Array.isArray(result.salesOrders) && result.salesOrders.length > 0
        ? result.salesOrders
        : (result.zohoSalesOrderId
          ? [{
              segment: 'product' as const,
              segmentLabel: 'Product',
              orderNumber: result.orderNumber,
              zohoSalesOrderId: result.zohoSalesOrderId,
              zohoSalesOrderNumber: result.zohoSalesOrderNumber,
              status: 'draft',
              subtotal: result.subtotal,
              itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
              salespersonId: null,
              salespersonName: null,
            }]
          : []);
      if (salesOrders.length > 1) {
        setCreatedOrders(salesOrders);
        return;
      }
      const soId = salesOrders[0]?.zohoSalesOrderId || result.zohoSalesOrderId;
      if (soId) navigate(`${listPath}/${soId}`);
      else navigate(listPath);
    } catch (err) {
      setError(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (createdOrders && createdOrders.length > 0) {
    return (
      <div className="page-content fade-in staff-create-so-page">
        <button
          type="button"
          className="btn btn-ghost btn-sm staff-create-so-page__back"
          onClick={() => navigate(listPath)}
        >
          <ArrowLeft size={16} aria-hidden />
          Sales orders
        </button>
        <MultiSalesOrderSuccess
          salesOrders={createdOrders}
          detailBasePath={listPath}
          listPath={listPath}
        />
      </div>
    );
  }

  return (
    <div className="page-content fade-in staff-create-so-page">
      <button
        type="button"
        className="btn btn-ghost btn-sm staff-create-so-page__back"
        onClick={() => navigate(listPath)}
      >
        <ArrowLeft size={16} aria-hidden />
        Sales orders
      </button>

      {error ? (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="panel glass staff-create-so-page__section">
        <div className="staff-create-so-page__section-head">
          <h2>Cart</h2>
          <Link to={catalogPath} className="btn btn-secondary btn-sm">
            <ShoppingCart size={14} aria-hidden />
            Browse catalog
          </Link>
        </div>
        <p className="text-muted text-sm staff-create-so-page__segment-hint">
          Tap the cart icon on catalog tiles to add items (same animation as dealers).
          {user?.spareIncharge && !isFullSuperAdmin(user)
            ? ' Spare Incharge: spare parts only.'
            : !isFullSuperAdmin(user)
              ? ' Staff: product and software only — spares need Spare Incharge or super admin.'
              : ''}
        </p>

        {lines.length === 0 ? (
          <div className="staff-create-so-page__cart-empty">
            <Package size={36} aria-hidden />
            <p>Cart is empty</p>
            <Link to={catalogPath} className="btn btn-primary btn-sm">
              Open catalog
            </Link>
          </div>
        ) : (
          <ul className="staff-create-so-page__cart-list">
            {lines.map(item => (
              <StaffCartLine
                key={item.cartLineId}
                item={item}
                disabled={saving}
                onQuantity={qty => setQuantity(item.cartLineId, qty)}
                onRate={rate => setLineBaseRate(item.cartLineId, rate)}
                onRemove={() => {
                  removeItem(item.cartLineId);
                  setRateOverrides(prev => {
                    const next = { ...prev };
                    delete next[item.cartLineId];
                    return next;
                  });
                }}
              />
            ))}
          </ul>
        )}

        {segmentPreview.length > 1 ? (
          <p className="text-muted text-sm staff-create-so-page__segment-hint">
            This will create {segmentPreview.length} draft sales orders:
            {' '}
            {segmentPreview.map(segmentLabel).join(', ')}.
          </p>
        ) : null}
      </section>

      <section className="panel glass staff-create-so-page__section">
        <h2>Dealer</h2>
        {selectedDealer ? (
          <div className="staff-create-so-page__dealer-selected">
            <div>
              <strong>{selectedDealer.label}</strong>
              {selectedDealer.contactPerson ? (
                <p className="text-muted text-sm">{selectedDealer.contactPerson}</p>
              ) : null}
              {selectedDealer.mobile ? (
                <p className="text-muted text-sm">{selectedDealer.mobile}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={() => {
                setSelectedDealer(null);
                setAddresses([]);
                setShipping(null);
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="staff-create-so-page__dealer-search">
            <div className="catalog-search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                placeholder="Search dealer by name, code or mobile…"
                value={dealerQuery}
                onChange={e => setDealerQuery(e.target.value)}
                aria-label="Search dealers"
              />
            </div>
            {dealersLoading && dealers.length === 0 ? (
              <p className="text-muted text-sm">Loading dealers…</p>
            ) : filteredDealers.length > 0 ? (
              <ul className="staff-create-so-page__dealer-list" role="listbox">
                {filteredDealers.map(dealer => {
                  const snapshot = zohoDealerToSnapshot(dealer);
                  return (
                    <li key={dealer.id}>
                      <button
                        type="button"
                        className="staff-create-so-page__dealer-option"
                        onClick={() => selectDealer(dealer)}
                      >
                        <strong>{snapshot.name}</strong>
                        <span className="text-muted text-sm">
                          {[
                            snapshot.contactPerson !== '—' ? snapshot.contactPerson : null,
                            snapshot.mobile !== '—' ? snapshot.mobile : null,
                            dealer.id,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : dealerQuery.trim().length >= 2 ? (
              <p className="text-muted text-sm">
                {dealersLoading
                  ? 'Still loading dealers…'
                  : `No dealers match “${dealerQuery.trim()}”.`}
              </p>
            ) : (
              <p className="text-muted text-sm">
                Type at least 2 characters to search
                {dealersLoading ? ' (loading dealer list…)' : ` (${dealers.length} dealers loaded)`}.
              </p>
            )}
          </div>
        )}
      </section>

      {selectedDealer ? (
        <section className="panel glass staff-create-so-page__section">
          <ShippingAddressPicker
            addresses={addresses}
            loading={addressesLoading}
            error={addressError}
            disabled={saving}
            value={shipping}
            onChange={setShipping}
            onRefresh={() => void loadAddresses(selectedDealer.id)}
          />
        </section>
      ) : null}

      <section className="panel glass staff-create-so-page__section">
        <label htmlFor="staff-so-remarks">
          Remarks
          <textarea
            id="staff-so-remarks"
            className="input-field"
            rows={3}
            value={cartRemarks}
            disabled={saving}
            onChange={e => setCartRemarks(e.target.value)}
            placeholder="Optional notes for this sales order"
          />
        </label>

        {needsSalespersonPicker ? (
          <label className="staff-create-so-page__salesperson">
            <span>Salesperson</span>
            <ThemeSelect
              id="staff-so-salesperson"
              value={salespersonId}
              disabled={saving || salespersonsLoading}
              placeholder={
                salespersonsLoading ? 'Loading salespersons…' : 'Select salesperson…'
              }
              options={salespersons.map(row => ({
                value: row.id,
                label: row.name,
                hint: row.email || undefined,
              }))}
              onChange={setSalespersonId}
              aria-label="Salesperson"
            />
            <span className="text-muted text-sm">
              Required for the product sales order — your admin account has no linked Zoho salesperson.
            </span>
          </label>
        ) : null}

        <div className="staff-create-so-page__totals">
          <span className="text-muted">Estimated subtotal</span>
          <strong>{formatCurrency(subtotal)}</strong>
        </div>
        <div className="staff-create-so-page__actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving || !canSubmit}
            onClick={() => void save('review')}
          >
            {saving ? 'Saving…' : 'Save as draft'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !canSubmit}
            onClick={() => void save('ready_for_payment')}
          >
            {saving ? 'Saving…' : 'Ready for payment'}
          </button>
        </div>
      </section>
    </div>
  );
};

function StaffCartLine({
  item,
  disabled,
  onQuantity,
  onRate,
  onRemove,
}: {
  item: CartItem & { catalogRate: number; rate: number };
  disabled?: boolean;
  onQuantity: (qty: number) => void;
  onRate: (rate: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="staff-create-so-page__cart-item">
      <div className="staff-create-so-page__cart-media">
        {item.imageUrl ? (
          <CategoryThumbnail src={item.imageUrl} knockout={false} />
        ) : (
          <Package size={24} aria-hidden />
        )}
      </div>
      <DocumentLineItemSpec
        className="staff-create-so-page__cart-info"
        name={item.name}
        sku={item.sku}
        description={item.description}
      >
        <label className="staff-create-so-page__rate">
          <span className="text-muted text-sm">Base rate</span>
          <input
            type="number"
            className="input-field"
            min={0}
            step={0.01}
            value={item.catalogRate}
            disabled={disabled}
            onChange={e => onRate(Number(e.target.value))}
          />
        </label>
        {item.gatcFeePerUnit > 0 ? (
          <span className="text-muted text-sm">
            + {item.gatcFeePerUnit.toLocaleString('en-IN')} stamping
            {item.gatcStampingRange ? ` (${item.gatcStampingRange})` : ''}
          </span>
        ) : null}
        <strong>{formatCurrency(item.rate * item.quantity)}</strong>
      </DocumentLineItemSpec>
      <div className="staff-create-so-page__cart-actions">
        <QuantityStepper
          value={item.quantity}
          onChange={onQuantity}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove from cart"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}
