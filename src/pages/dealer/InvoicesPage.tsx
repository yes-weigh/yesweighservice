import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, FileText, RefreshCw, Search } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { formatCurrency } from '../../lib/catalog';
import {
  fetchDealerInvoices,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceListParams } from '../../types/invoices';
import { INVOICE_STATUS_OPTIONS } from '../../types/invoices';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function statusClass(status: string): string {
  const key = status.toLowerCase();
  if (key === 'paid') return 'invoices-status--paid';
  if (key === 'overdue' || key === 'unpaid') return 'invoices-status--due';
  if (key === 'partially_paid') return 'invoices-status--partial';
  if (key === 'void') return 'invoices-status--void';
  return 'invoices-status--default';
}

function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <span className={`invoices-status ${statusClass(status)}`}>
      {invoiceStatusLabel(status)}
    </span>
  );
}

function InvoiceCard({ invoice }: { invoice: DealerInvoice }) {
  return (
    <article className="invoices-card panel glass">
      <div className="invoices-card__head">
        <div>
          <strong>{invoice.invoiceNumber || '—'}</strong>
          {invoice.referenceNumber && (
            <span className="invoices-card__ref text-muted text-sm">Ref: {invoice.referenceNumber}</span>
          )}
        </div>
        <InvoiceStatusBadge status={invoice.status} />
      </div>
      <dl className="invoices-card__meta">
        <div>
          <dt>Date</dt>
          <dd>{formatInvoiceDate(invoice.date)}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{formatInvoiceDate(invoice.dueDate)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{formatCurrency(invoice.total)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd>{formatCurrency(invoice.balance)}</dd>
        </div>
      </dl>
      {invoice.invoiceUrl && (
        <a
          href={invoice.invoiceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="invoices-card__link btn btn-secondary btn-sm"
        >
          <ExternalLink size={14} />
          View invoice
        </a>
      )}
    </article>
  );
}

export const InvoicesPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [statusFilter, setStatusFilter] = useState<InvoiceListParams['status']>('all');
  const [sortField, setSortField] = useState<NonNullable<InvoiceListParams['sortField']>>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const queryParams = useMemo((): InvoiceListParams => ({
    page,
    limit,
    sortField,
    sortDir,
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}),
  }), [page, debouncedSearch, statusFilter, sortField, sortDir]);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchDealerInvoices(queryParams);
      setInvoices(res.data);
      setTotal(res.pagination.total);
    } catch (err) {
      setError(invoiceErrorMessage(err));
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, sortField, sortDir]);

  const handleSort = (field: NonNullable<InvoiceListParams['sortField']>) => {
    if (sortField === field) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'invoiceNumber' ? 'asc' : 'desc');
    }
  };

  const SortMark = ({ field }: { field: NonNullable<InvoiceListParams['sortField']> }) => (
    <span className="invoices-sort-mark">{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="page-content fade-in invoices-page">
      {error && (
        <div className="products-inline-error panel glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="invoices-toolbar panel glass">
        <div className="invoices-toolbar__row">
          <div className="catalog-search invoices-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search invoice no., reference, PO…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label="Search invoices"
            />
          </div>
          <div className="invoices-toolbar__actions">
            <select
              className="catalog-select invoices-status-filter"
              value={statusFilter ?? 'all'}
              onChange={e => setStatusFilter(e.target.value as InvoiceListParams['status'])}
              aria-label="Filter by status"
            >
              {INVOICE_STATUS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading}
              onClick={() => void loadInvoices()}
            >
              <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
              Refresh
            </button>
          </div>
        </div>
        <p className="invoices-toolbar__hint text-muted text-sm">
          Invoices from your YesWeigh Zoho account
          {total > 0 ? ` · ${total} total` : ''}
        </p>
      </div>

      {loading && invoices.length === 0 ? (
        <FetchingLoader label="Loading invoices…" />
      ) : invoices.length === 0 ? (
        <div className="invoices-empty panel glass">
          <FileText size={40} aria-hidden />
          <h2>No invoices found</h2>
          <p className="text-muted">
            {debouncedSearch || (statusFilter && statusFilter !== 'all')
              ? 'Try adjusting your search or status filter.'
              : 'Invoices issued to your dealer account in Zoho will appear here.'}
          </p>
        </div>
      ) : (
        <>
          <div className="invoices-table-panel panel glass invoices-table-wrap--desktop">
            <div className="invoices-table-wrap">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" onClick={() => handleSort('invoiceNumber')}>
                        Invoice <SortMark field="invoiceNumber" />
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => handleSort('date')}>
                        Date <SortMark field="date" />
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => handleSort('dueDate')}>
                        Due <SortMark field="dueDate" />
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => handleSort('status')}>
                        Status <SortMark field="status" />
                      </button>
                    </th>
                    <th className="invoices-table__num">
                      <button type="button" onClick={() => handleSort('total')}>
                        Total <SortMark field="total" />
                      </button>
                    </th>
                    <th className="invoices-table__num">
                      <button type="button" onClick={() => handleSort('balance')}>
                        Balance <SortMark field="balance" />
                      </button>
                    </th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(invoice => (
                    <tr key={invoice.id}>
                      <td>
                        <strong>{invoice.invoiceNumber || '—'}</strong>
                        {invoice.referenceNumber && (
                          <span className="invoices-table__ref text-muted text-sm">
                            {invoice.referenceNumber}
                          </span>
                        )}
                      </td>
                      <td>{formatInvoiceDate(invoice.date)}</td>
                      <td>{formatInvoiceDate(invoice.dueDate)}</td>
                      <td><InvoiceStatusBadge status={invoice.status} /></td>
                      <td className="invoices-table__num">{formatCurrency(invoice.total)}</td>
                      <td className="invoices-table__num">{formatCurrency(invoice.balance)}</td>
                      <td className="invoices-table__actions">
                        {invoice.invoiceUrl ? (
                          <a
                            href={invoice.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary btn-sm"
                          >
                            <ExternalLink size={14} />
                            View
                          </a>
                        ) : (
                          <span className="text-muted text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="invoices-cards invoices-cards--mobile">
            {invoices.map(invoice => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="invoices-pagination panel glass">
          <span className="text-muted text-sm">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="invoices-pagination__btns">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
