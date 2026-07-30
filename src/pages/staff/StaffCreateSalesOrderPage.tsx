import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Search } from 'lucide-react';
import {
  SalesOrderDraftLineEditor,
  type DraftEditLine,
} from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { MultiSalesOrderSuccess } from '../../components/salesOrders/MultiSalesOrderSuccess';
import { ThemeSelect } from '../../components/ThemeSelect';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
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
import type { CatalogProduct } from '../../types/catalog';

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
  const canManage = hasStaffPermission(user, 'orders.manage');
  const listPath = pathname.startsWith('/super-admin')
    ? '/super-admin/sales-orders'
    : '/staff/sales-orders';
  const productFilter = useCallback(
    (product: CatalogProduct) => catalogProductAllowedForUser(user, product),
    [user],
  );

  const [dealerQuery, setDealerQuery] = useState('');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<SelectedDealer | null>(null);

  const [lines, setLines] = useState<DraftEditLine[]>([]);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [remarks, setRemarks] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [salespersons, setSalespersons] = useState<ZohoSalespersonOption[]>([]);
  const [salespersonsLoading, setSalespersonsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);

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

  // Same full dealer cache as logistics book-courier.
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
    && shipping
    && (!needsSalespersonPicker || salespersonId.trim()),
  );

  const save = async (stage: 'review' | 'ready_for_payment') => {
    if (!selectedDealer) {
      setError('Select a dealer.');
      return;
    }
    if (!lines.length) {
      setError('Add at least one item.');
      return;
    }
    if (!shipping) {
      setError('Select a shipping address.');
      return;
    }
    if (needsSalespersonPicker && !salespersonId.trim()) {
      setError('Select a salesperson for this order.');
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
        remarks: remarks.trim(),
        ...(needsSalespersonPicker
          ? { salespersonId: salespersonId.trim() }
          : {}),
      });
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
        <>
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

          <SalesOrderDraftLineEditor
            lines={lines}
            onChange={setLines}
            saving={saving}
            allowRateEdit
            hideActions
            title="Items"
            productFilter={productFilter}
            onSave={() => {}}
            onCancel={() => setLines([])}
          />

          {user?.spareIncharge && !isFullSuperAdmin(user) ? (
            <p className="text-muted text-sm staff-create-so-page__segment-hint">
              Spare Incharge can only add spare parts (generic spare parts and uncategorized).
            </p>
          ) : !isFullSuperAdmin(user) ? (
            <p className="text-muted text-sm staff-create-so-page__segment-hint">
              Staff can add product and software items. Spare parts require Spare Incharge or super admin.
            </p>
          ) : null}

          {segmentPreview.length > 1 ? (
            <p className="text-muted text-sm staff-create-so-page__segment-hint">
              This will create {segmentPreview.length} draft sales orders:
              {' '}
              {segmentPreview.map(segmentLabel).join(', ')}.
            </p>
          ) : null}
          <section className="panel glass staff-create-so-page__section">
            <label htmlFor="staff-so-remarks">
              Remarks
              <textarea
                id="staff-so-remarks"
                className="input-field"
                rows={3}
                value={remarks}
                disabled={saving}
                onChange={e => setRemarks(e.target.value)}
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
                {saving ? 'Saving…' : 'Save as awaiting payment'}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};
