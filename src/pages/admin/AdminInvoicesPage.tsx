import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, FileText, Radio, RefreshCw, Search, Settings2 } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import {
  filterAdminInvoices,
  subscribeAdminInvoices,
  type AdminFirestoreInvoice,
  type AdminInvoiceSort,
} from '../../lib/admin-invoices';
import { fetchOrgInvoiceSyncStatus } from '../../lib/org-invoice-sync';
import { formatCurrency } from '../../lib/catalog';
import { formatInvoiceDate, invoiceStatusLabel } from '../../lib/invoices';

const PAGE_SIZE = 50;

function formatSyncedAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN');
}

function invoiceStatusClass(status: string): string {
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return `invoices-status invoices-status--${key}`;
}

export const AdminInvoicesPage: React.FC = () => {
  const [rows, setRows] = useState<AdminFirestoreInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AdminInvoiceSort>('syncedAt');
  const [live, setLive] = useState(false);
  const [totalInFirestore, setTotalInFirestore] = useState<number | null>(null);
  const [syncComplete, setSyncComplete] = useState<boolean | null>(null);

  useEffect(() => {
    void fetchOrgInvoiceSyncStatus()
      .then(status => {
        setTotalInFirestore(status.pulledCount ?? null);
        setSyncComplete(status.status === 'complete');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const unsubscribe = subscribeAdminInvoices(
      sort,
      PAGE_SIZE,
      next => {
        setRows(next);
        setLoading(false);
        setLive(true);
      },
      message => {
        setError(message);
        setLoading(false);
        setLive(false);
      },
    );
    return () => {
      unsubscribe();
      setLive(false);
    };
  }, [sort]);

  const filtered = useMemo(
    () => filterAdminInvoices(rows, search),
    [rows, search],
  );

  return (
    <div className="page-content fade-in">
      <div className="admin-invoices-head mb-6">
        <div>
          <h1>Invoices</h1>
          <p className="text-muted mt-2">
            All invoices mirrored in Firestore — updates appear here when Zoho webhooks or sync write new data.
          </p>
        </div>
        <div className="admin-invoices-head__actions">
          {live && (
            <span className="admin-invoices-live" title="Listening to Firestore for changes">
              <Radio size={14} aria-hidden />
              Live
            </span>
          )}
          <Link to="/super-admin/invoices/sync" className="btn btn-secondary">
            <Settings2 size={16} />
            Sync &amp; API usage
          </Link>
        </div>
      </div>

      {syncComplete === false && (
        <div className="panel glass mb-4 admin-invoices-notice" role="status">
          <AlertCircle size={18} />
          <span>
            Org backfill is not complete yet — this list still updates live, but some older invoices may be missing.
          </span>
        </div>
      )}

      <div className="stats-grid stats-grid--3 mb-6">
        <div className="stat-card glass">
          <div className="stat-icon"><FileText size={28} /></div>
          <div>
            <h3>In Firestore</h3>
            <div className="stat-value">
              {totalInFirestore == null ? '—' : totalInFirestore.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="stat-card glass">
          <div>
            <h3>Showing (live window)</h3>
            <div className="stat-value">{PAGE_SIZE.toLocaleString()}</div>
            <p className="text-muted text-sm mt-1">Newest by {sort === 'syncedAt' ? 'Firebase update' : 'invoice date'}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div>
            <h3>Matched search</h3>
            <div className="stat-value">{filtered.length.toLocaleString()}</div>
            <p className="text-muted text-sm mt-1">Filters the live window only</p>
          </div>
        </div>
      </div>

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
            className="admin-invoices-sort__select"
            value={sort}
            onChange={e => setSort(e.target.value as AdminInvoiceSort)}
          >
            <option value="syncedAt">Recently updated in Firebase</option>
            <option value="date">Invoice date</option>
          </select>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <FetchingLoader label="Loading invoices from Firestore…" />
      ) : filtered.length === 0 ? (
        <div className="invoices-empty panel glass">
          <FileText size={40} className="text-muted" aria-hidden />
          <p>No invoices match your search in the current live window.</p>
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
                  <th>Status</th>
                  <th className="invoices-table__num">Total</th>
                  <th className="invoices-table__num">Balance</th>
                  <th>Updated in Firebase</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(invoice => (
                  <tr key={`${invoice.customerId}-${invoice.id}`}>
                    <td>
                      <strong>{invoice.invoiceNumber || invoice.id}</strong>
                      {invoice.referenceNumber && (
                        <div className="invoices-table__ref text-muted text-sm">
                          SO {invoice.referenceNumber}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{invoice.customerName ?? '—'}</div>
                      <div className="text-muted text-sm">ID {invoice.customerId}</div>
                    </td>
                    <td>{formatInvoiceDate(invoice.date)}</td>
                    <td>
                      <span className={invoiceStatusClass(invoice.status)}>
                        {invoiceStatusLabel(invoice.status)}
                      </span>
                    </td>
                    <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                    <td className="invoices-table__num">{formatCurrency(invoice.balance)}</td>
                    <td className="text-muted text-sm">{formatSyncedAt(invoice.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="admin-invoices-mobile-list">
            {filtered.map(invoice => (
              <li key={`${invoice.customerId}-${invoice.id}`} className="admin-invoices-mobile-card panel glass">
                <div className="admin-invoices-mobile-card__row">
                  <strong>{invoice.invoiceNumber || invoice.id}</strong>
                  <span>{formatCurrency(invoice.total)}</span>
                </div>
                <div className="text-muted text-sm">{invoice.customerName ?? invoice.customerId}</div>
                <div className="admin-invoices-mobile-card__meta text-sm">
                  <span>{formatInvoiceDate(invoice.date)}</span>
                  <span className={invoiceStatusClass(invoice.status)}>
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                </div>
                <div className="text-muted text-sm">
                  Firebase: {formatSyncedAt(invoice.syncedAt)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted text-sm mt-4 admin-invoices-footnote">
        <RefreshCw size={14} className="admin-invoices-footnote__icon" aria-hidden />
        Showing the {PAGE_SIZE} most recent invoices by{' '}
        {sort === 'syncedAt' ? 'Firebase update time' : 'invoice date'}.
        Use <strong>Recently updated</strong> to spot webhook activity.
        Zoho create/edit workflows must not use <code>?action=delete</code> in the webhook URL.
      </p>
    </div>
  );
};
