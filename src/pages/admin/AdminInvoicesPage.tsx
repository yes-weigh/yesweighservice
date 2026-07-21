import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  IndianRupee,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  buildAdminSalesEntries,
  fetchAdminCustomerLocations,
  filterAdminInvoices,
  filterAdminInvoicesByPeriod,
  formatAdminCustomerLocation,
  subscribeAdminInvoices,
  type AdminFirestoreInvoice,
  type AdminInvoiceSort,
} from '../../lib/admin-invoices';
import { formatCurrency } from '../../lib/catalog';
import {
  computeSalesForPeriod,
  formatInvoiceDate,
  formatInvoiceItemQuantity,
  formatKpiPeriodRange,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { SalesRangePreset } from '../../types/invoices';
import { SALES_RANGE_OPTIONS } from '../../types/invoices';

const PAGE_SIZE = 500;

const SORT_OPTIONS: Array<{ value: AdminInvoiceSort; label: string }> = [
  { value: 'date', label: 'Invoice date' },
  { value: 'syncedAt', label: 'Most recently updated' },
];

function invoiceStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

function AdminDateRangeControl({
  value,
  onChange,
  rangeLabel,
}: {
  value: SalesRangePreset;
  onChange: (value: SalesRangePreset) => void;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`invoices-date-range${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="invoices-date-range__trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Date range"
      >
        <CalendarDays size={16} aria-hidden />
        <span className="invoices-date-range__copy">
          <span className="invoices-date-range__label">Date Range</span>
          <span className="invoices-date-range__value">{rangeLabel}</span>
        </span>
        <ChevronDown size={16} className="invoices-date-range__chevron" aria-hidden />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="invoices-date-range__backdrop"
            aria-label="Close date range"
            onClick={() => setOpen(false)}
          />
          <ul className="invoices-date-range__menu panel glass" role="listbox" aria-label="Date range options">
            {SALES_RANGE_OPTIONS.map(option => {
              const isActive = option.value === value;
              return (
                <li key={String(option.value)} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`invoices-date-range__option${isActive ? ' is-active' : ''}`}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function AdminFilterSheet({
  open,
  sort,
  onClose,
  onSortChange,
}: {
  open: boolean;
  sort: AdminInvoiceSort;
  onClose: () => void;
  onSortChange: (value: AdminInvoiceSort) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="invoices-filter-sheet" role="dialog" aria-modal="true" aria-label="Filter invoices">
      <button type="button" className="invoices-filter-sheet__backdrop" aria-label="Close filters" onClick={onClose} />
      <div className="invoices-filter-sheet__panel panel glass">
        <header className="invoices-filter-sheet__header">
          <h3 className="invoices-filter-sheet__title">Filter</h3>
          <button type="button" className="invoices-filter-sheet__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <section className="invoices-filter-sheet__section">
          <h4 className="invoices-filter-sheet__section-title">Sort by</h4>
          <div className="invoices-filter-sheet__options">
            {SORT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`invoices-filter-sheet__option${sort === option.value ? ' is-active' : ''}`}
                onClick={() => onSortChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <footer className="invoices-filter-sheet__footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export const AdminInvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminFirestoreInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminInvoiceSort>('date');
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>('current_month');
  const [filterOpen, setFilterOpen] = useState(false);
  const [customerLocations, setCustomerLocations] = useState(
    () => new Map<string, { district: string | null; state: string | null }>(),
  );

  useEffect(() => {
    setLoading(true);
    setError('');
    const unsubscribe = subscribeAdminInvoices(
      sort,
      PAGE_SIZE,
      next => {
        setRows(next);
        setLoading(false);
      },
      message => {
        setError(message);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [sort]);

  const periodRows = useMemo(
    () => filterAdminInvoicesByPeriod(rows, rangePreset),
    [rows, rangePreset],
  );

  const filtered = useMemo(
    () => filterAdminInvoices(periodRows, search),
    [periodRows, search],
  );

  useEffect(() => {
    const customerIds = filtered.map(invoice => invoice.customerId);
    if (!customerIds.length) {
      setCustomerLocations(new Map());
      return;
    }

    let cancelled = false;
    void fetchAdminCustomerLocations(customerIds).then(map => {
      if (!cancelled) setCustomerLocations(map);
    });

    return () => {
      cancelled = true;
    };
  }, [filtered]);

  const openInvoice = (invoice: AdminFirestoreInvoice) => {
    navigate(`/super-admin/invoices/${invoice.customerId}/${invoice.id}/invoice`);
  };

  const summary = useMemo(() => {
    const salesEntries = buildAdminSalesEntries(filtered);
    const sales = salesEntries.length ? computeSalesForPeriod(salesEntries, rangePreset) : null;
    return {
      invoiceCount: filtered.length,
      totalSales: sales?.totalSales ?? 0,
      periodStart: sales?.periodStart ?? null,
      periodEnd: sales?.periodEnd ?? new Date().toISOString(),
    };
  }, [filtered, rangePreset]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);

  return (
    <div className="page-content fade-in admin-invoices-page invoices-page">
      <div className="admin-invoices-head admin-invoices-head--desktop">
        <div>
          <h1>Invoices</h1>
          <p className="text-muted mt-2">
            Browse and search invoices across all dealers.
          </p>
        </div>
      </div>

      <section className="invoices-summary" aria-label="Invoice summary">
        <div className="invoices-summary__kpis">
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <FileText size={18} strokeWidth={2.4} />
            </span>
            <span className="invoices-summary__kpi-label">Total Invoices</span>
            <strong className="invoices-summary__kpi-value">
              {loading ? '…' : summary.invoiceCount.toLocaleString('en-IN')}
            </strong>
            <span className="invoices-summary__kpi-sub">Invoices</span>
          </div>
          <div className="invoices-summary__divider" aria-hidden />
          <div className="invoices-summary__kpi">
            <span className="invoices-summary__kpi-icon" aria-hidden>
              <IndianRupee size={18} strokeWidth={2.4} />
            </span>
            <span className="invoices-summary__kpi-label">Total Amount</span>
            <strong className="invoices-summary__kpi-value invoices-summary__kpi-value--amount">
              {loading ? '…' : formatCurrency(summary.totalSales)}
            </strong>
            <span className="invoices-summary__kpi-sub">Amount</span>
          </div>
        </div>

        <div className="invoices-summary__controls">
          <AdminDateRangeControl
            value={rangePreset}
            onChange={setRangePreset}
            rangeLabel={dateRange}
          />
          <button
            type="button"
            className="invoices-summary__filter-btn"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal size={15} aria-hidden />
            Filter
          </button>
        </div>
      </section>

      {error && (
        <div className="products-inline-error panel glass admin-invoices-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="panel glass admin-invoices-toolbar admin-invoices-toolbar--desktop">
        <div className="admin-invoices-search">
          <Search size={18} className="admin-invoices-search__icon" aria-hidden />
          <input
            type="search"
            className="admin-invoices-search__input"
            placeholder="Search invoice #, customer, reference…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search invoices"
          />
        </div>
        <div className="admin-invoices-sort">
          <label htmlFor="admin-invoice-sort" className="text-muted text-sm">Sort by</label>
          <select
            id="admin-invoice-sort"
            className="admin-invoices-sort__select catalog-select"
            value={sort}
            onChange={e => setSort(e.target.value as AdminInvoiceSort)}
          >
            <option value="date">Invoice date</option>
            <option value="syncedAt">Most recently updated</option>
          </select>
        </div>
      </div>

      <div className="admin-invoices-mobile-search">
        <Search size={16} className="admin-invoices-search__icon" aria-hidden />
        <input
          type="search"
          className="admin-invoices-search__input"
          placeholder="Search invoice #, customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search invoices"
        />
      </div>

      {loading && rows.length === 0 ? (
        <FetchingLoader label="Loading invoices…" />
      ) : filtered.length === 0 ? (
        <div className="invoices-empty panel glass">
          <FileText size={40} className="text-muted" aria-hidden />
          <p>No invoices found for this period.</p>
        </div>
      ) : (
        <div className="panel glass invoices-table-panel admin-invoices-table-panel">
          <div className="invoices-table-wrap invoices-table-wrap--desktop">
            <table className="invoices-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th className="invoices-table__num">Qty</th>
                  <th className="invoices-table__num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(invoice => {
                  const locationLabel = formatAdminCustomerLocation(
                    customerLocations.get(invoice.customerId),
                  );
                  return (
                    <tr
                      key={`${invoice.customerId}-${invoice.id}`}
                      className="invoices-table__row--clickable"
                      onClick={() => openInvoice(invoice)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInvoice(invoice);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
                    >
                      <td>
                        <strong>{invoice.invoiceNumber || invoice.id}</strong>
                        {invoice.referenceNumber && (
                          <div className="invoices-table__ref text-muted text-sm">
                            Order {invoice.referenceNumber}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{invoice.customerName ?? '—'}</div>
                        {locationLabel && (
                          <div className="invoices-table__ref text-muted text-sm">{locationLabel}</div>
                        )}
                      </td>
                      <td>{formatInvoiceDate(invoice.date)}</td>
                      <td className="invoices-table__num">{formatInvoiceItemQuantity(invoice.itemQuantity)}</td>
                      <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                      <td>
                        <span className={invoiceStatusClass(invoice.status)}>
                          {invoiceStatusLabel(invoice.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="invoices-mobile-list admin-invoices-mobile-list">
            <div className="invoices-mobile-list__head" aria-hidden>
              <span>Invoice No.</span>
              <span>Date</span>
              <span>Total Amount</span>
            </div>
            {filtered.map(invoice => {
              const locationLabel = formatAdminCustomerLocation(
                customerLocations.get(invoice.customerId),
              );
              return (
                <button
                  key={`${invoice.customerId}-${invoice.id}`}
                  type="button"
                  className="invoices-mobile-row"
                  onClick={() => openInvoice(invoice)}
                  aria-label={`View invoice ${invoice.invoiceNumber || invoice.id}`}
                >
                  <span className="invoices-mobile-row__icon" aria-hidden>
                    <FileText size={16} strokeWidth={2.25} />
                  </span>
                  <span className="invoices-mobile-row__invoice">
                    <strong>{invoice.invoiceNumber || invoice.id}</strong>
                    <span className="invoices-mobile-row__so">
                      {invoice.customerName ?? locationLabel ?? '—'}
                    </span>
                  </span>
                  <span className="invoices-mobile-row__date">{formatInvoiceDate(invoice.date)}</span>
                  <span className="invoices-mobile-row__amount">
                    <strong>{formatCurrency(invoice.total)}</strong>
                    <span className={invoiceStatusClass(invoice.status)}>
                      {invoiceStatusLabel(invoice.status)}
                    </span>
                  </span>
                  <span className="invoices-mobile-row__chevron" aria-hidden>
                    <ChevronRight size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AdminFilterSheet
        open={filterOpen}
        sort={sort}
        onClose={() => setFilterOpen(false)}
        onSortChange={value => {
          setSort(value);
          setFilterOpen(false);
        }}
      />
    </div>
  );
};
