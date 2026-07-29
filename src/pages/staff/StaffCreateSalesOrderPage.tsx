import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Search } from 'lucide-react';
import {
  SalesOrderDraftLineEditor,
  type DraftEditLine,
} from '../../components/salesOrders/SalesOrderDraftLineEditor';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { dealerOrderErrorMessage } from '../../lib/dealerOrders';
import { hasStaffPermission } from '../../lib/staffAccess';
import { createStaffSalesOrder } from '../../lib/salesOrderWorkflow';
import {
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';

type DealerOption = {
  id: string;
  label: string;
  companyName: string | null;
  code: string | null;
};

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export const StaffCreateSalesOrderPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = hasStaffPermission(user, 'orders.manage');
  const listPath = '/staff/sales-orders';

  const [dealerQuery, setDealerQuery] = useState('');
  const debouncedDealerQuery = useDebounce(dealerQuery, 220);
  const [dealerOptions, setDealerOptions] = useState<DealerOption[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<DealerOption | null>(null);

  const [lines, setLines] = useState<DraftEditLine[]>([]);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    const q = debouncedDealerQuery.trim().toLowerCase();
    if (q.length < 2) {
      setDealerOptions([]);
      return;
    }
    let cancelled = false;
    setDealersLoading(true);
    void (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'zohoCustomers'), orderBy('contactName'), limit(80)),
        );
        if (cancelled) return;
        const rows: DealerOption[] = snap.docs
          .map(docSnap => {
            const data = docSnap.data();
            const contactName = String(data.contactName ?? '').trim();
            const companyName = data.companyName ? String(data.companyName).trim() : null;
            const code = data.customerCode
              ? String(data.customerCode).trim()
              : (data.cfDealerCode ? String(data.cfDealerCode).trim() : null);
            const label = contactName || companyName || docSnap.id;
            const hay = `${label} ${companyName ?? ''} ${code ?? ''} ${docSnap.id}`.toLowerCase();
            if (!hay.includes(q)) return null;
            return { id: docSnap.id, label, companyName, code };
          })
          .filter((row): row is DealerOption => Boolean(row))
          .slice(0, 25);
        setDealerOptions(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not search dealers.');
          setDealerOptions([]);
        }
      } finally {
        if (!cancelled) setDealersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedDealerQuery]);

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

  const selectDealer = (dealer: DealerOption) => {
    setSelectedDealer(dealer);
    setDealerQuery('');
    setDealerOptions([]);
    setError('');
    void loadAddresses(dealer.id);
  };

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.rate * line.quantity, 0),
    [lines],
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
    setSaving(true);
    setError('');
    try {
      const result = await createStaffSalesOrder({
        zohoCustomerId: selectedDealer.id,
        lines: lines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          rate: line.rate,
        })),
        shipping,
        stage,
        remarks: remarks.trim(),
      });
      navigate(`${listPath}/${result.zohoSalesOrderId}`);
    } catch (err) {
      setError(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
              {selectedDealer.companyName && selectedDealer.companyName !== selectedDealer.label ? (
                <p className="text-muted text-sm">{selectedDealer.companyName}</p>
              ) : null}
              {selectedDealer.code ? (
                <p className="text-muted text-sm">Code {selectedDealer.code}</p>
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
                placeholder="Search dealer name, company, or code…"
                value={dealerQuery}
                onChange={e => setDealerQuery(e.target.value)}
                aria-label="Search dealers"
              />
            </div>
            {dealersLoading ? (
              <p className="text-muted text-sm">Searching…</p>
            ) : dealerOptions.length > 0 ? (
              <ul className="staff-create-so-page__dealer-list" role="listbox">
                {dealerOptions.map(option => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className="staff-create-so-page__dealer-option"
                      onClick={() => selectDealer(option)}
                    >
                      <strong>{option.label}</strong>
                      <span className="text-muted text-sm">
                        {[option.companyName, option.code].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : debouncedDealerQuery.trim().length >= 2 ? (
              <p className="text-muted text-sm">No matching dealers.</p>
            ) : (
              <p className="text-muted text-sm">Type at least 2 characters to search Zoho dealers.</p>
            )}
          </div>
        )}
      </section>

      {selectedDealer ? (
        <>
          <section className="panel glass staff-create-so-page__section">
            <h2>Shipping address</h2>
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
            onSave={() => {}}
            onCancel={() => setLines([])}
          />

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
            <div className="staff-create-so-page__totals">
              <span className="text-muted">Estimated subtotal</span>
              <strong>{formatCurrency(subtotal)}</strong>
            </div>
            <div className="staff-create-so-page__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || !lines.length || !shipping}
                onClick={() => void save('review')}
              >
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !lines.length || !shipping}
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
