import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, FileText, IndianRupee, Search } from 'lucide-react';
import { SalesRangeSelect } from '../../components/dashboard/SalesRangeSelect';
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
  formatKpiPeriodRange,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { SalesRangePreset } from '../../types/invoices';

const PAGE_SIZE = 500;

function invoiceStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

export const AdminInvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminFirestoreInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminInvoiceSort>('date');
  const [rangePreset, setRangePreset] = useState<SalesRangePreset>('current_month');
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
    const unpaid = filtered.filter(invoice => invoice.balance > 0);
    const salesEntries = buildAdminSalesEntries(filtered);
    const sales = salesEntries.length ? computeSalesForPeriod(salesEntries, rangePreset) : null;
    return {
      invoiceCount: filtered.length,
      totalSales: sales?.totalSales ?? 0,
      periodStart: sales?.periodStart ?? null,
      periodEnd: sales?.periodEnd ?? new Date().toISOString(),
      unpaidCount: unpaid.length,
      outstanding: unpaid.reduce((sum, invoice) => sum + invoice.balance, 0),
    };
  }, [filtered, rangePreset]);

  const dateRange = formatKpiPeriodRange(summary.periodStart, summary.periodEnd);

  return (
    <div className="page-content fade-in">
      <div className="admin-invoices-head mb-6">
        <div>
          <h1>Invoices</h1>
          <p className="text-muted mt-2">
            Browse and search invoices across all dealers.
          </p>
        </div>
      </div>

      <section className="dealer-dash__kpis-layout admin-invoices-kpis mb-6" aria-label="Invoice summary">
        <div className="dealer-dash-kpi dealer-dash-kpi--blue dealer-dash-kpi--featured admin-invoices-kpi--featured">
          <div className="dealer-dash-kpi__featured-main">
            <div className="dealer-dash-kpi__icon dealer-dash-kpi__icon--featured">
              <IndianRupee strokeWidth={2.5} />
            </div>
            <div className="dealer-dash-kpi__body dealer-dash-kpi__body--featured">
              <span className="dealer-dash-kpi__label">Total sales</span>
              <SalesRangeSelect value={rangePreset} onChange={setRangePreset} />
              <span className="admin-invoices-kpi__range text-muted text-sm">{dateRange}</span>
            </div>
          </div>
          <strong className="dealer-dash-kpi__value dealer-dash-kpi__value--featured">
            {loading ? '…' : formatCurrency(summary.totalSales)}
          </strong>
        </div>

        <div className="dealer-dash__kpis-grid admin-invoices-kpis__grid">
          <div className="dealer-dash-kpi dealer-dash-kpi--blue admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><FileText size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Invoices</span>
              <strong className="dealer-dash-kpi__value">
                {loading ? '…' : summary.invoiceCount.toLocaleString()}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">In selected period</span>
            </div>
          </div>
          <div className="dealer-dash-kpi dealer-dash-kpi--orange admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><FileText size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Unpaid</span>
              <strong className="dealer-dash-kpi__value">
                {loading ? '…' : summary.unpaidCount.toLocaleString()}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">In selected period</span>
            </div>
          </div>
          <div className="dealer-dash-kpi dealer-dash-kpi--green admin-invoices-kpi--static">
            <div className="dealer-dash-kpi__icon"><IndianRupee size={22} strokeWidth={2.5} /></div>
            <div className="dealer-dash-kpi__body">
              <span className="dealer-dash-kpi__label">Outstanding</span>
              <strong className="dealer-dash-kpi__value">
                {loading ? '…' : formatCurrency(summary.outstanding)}
              </strong>
              <span className="dealer-dash-kpi__trend dealer-dash-kpi__trend--up">Balance due</span>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="products-inline-error panel glass mb-4" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="panel glass mb-4 admin-invoices-toolbar">
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
                  <th className="invoices-table__num">Total</th>
                  <th>Status</th>
                  <th className="invoices-table__actions"> </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(invoice => {
                  const locationLabel = formatAdminCustomerLocation(
                    customerLocations.get(invoice.customerId),
                  );
                  return (
                  <tr key={`${invoice.customerId}-${invoice.id}`}>
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
                    <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                    <td>
                      <span className={invoiceStatusClass(invoice.status)}>
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                    </td>
                    <td className="invoices-table__actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openInvoice(invoice)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="admin-invoices-mobile-list">
            {filtered.map(invoice => {
              const locationLabel = formatAdminCustomerLocation(
                customerLocations.get(invoice.customerId),
              );
              return (
              <li key={`${invoice.customerId}-${invoice.id}`} className="admin-invoices-mobile-card panel glass">
                <div className="admin-invoices-mobile-card__row">
                  <strong>{invoice.invoiceNumber || invoice.id}</strong>
                  <span>{formatCurrency(invoice.total)}</span>
                </div>
                <div>{invoice.customerName ?? '—'}</div>
                {locationLabel && (
                  <div className="text-muted text-sm">{locationLabel}</div>
                )}
                <div className="admin-invoices-mobile-card__meta text-sm">
                  <span>{formatInvoiceDate(invoice.date)}</span>
                  <span className={invoiceStatusClass(invoice.status)}>
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm admin-invoices-mobile-card__view"
                  onClick={() => openInvoice(invoice)}
                >
                  View invoice
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
