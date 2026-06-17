import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, FileText, RefreshCw, Search } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  fetchDealerInvoices,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceStatusLabel,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceListParams } from '../../types/invoices';
import { INVOICE_STATUS_OPTIONS } from '../../types/invoices';

const MOBILE_SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sortField: NonNullable<InvoiceListParams['sortField']>;
  sortDir: 'asc' | 'desc';
}> = [
  { value: 'date:desc', label: 'Newest first', sortField: 'date', sortDir: 'desc' },
  { value: 'date:asc', label: 'Oldest first', sortField: 'date', sortDir: 'asc' },
  { value: 'dueDate:asc', label: 'Due soon', sortField: 'dueDate', sortDir: 'asc' },
  { value: 'dueDate:desc', label: 'Due later', sortField: 'dueDate', sortDir: 'desc' },
  { value: 'total:desc', label: 'Highest amount', sortField: 'total', sortDir: 'desc' },
  { value: 'balance:desc', label: 'Highest balance', sortField: 'balance', sortDir: 'desc' },
  { value: 'invoiceNumber:asc', label: 'Invoice #', sortField: 'invoiceNumber', sortDir: 'asc' },
];

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

function InvoiceMobileCard({ invoice, onOpen }: { invoice: DealerInvoice; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="invoices-card invoices-card--link panel glass"
      onClick={() => onOpen(invoice.id)}
    >
      <div className="invoices-card__main">
        <div className="invoices-card__head">
          <strong className="invoices-card__number">{invoice.invoiceNumber || '—'}</strong>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <div className="invoices-card__meta">
          <span className="invoices-card__date">{formatInvoiceDate(invoice.date)}</span>
          {invoice.referenceNumber && (
            <span className="invoices-card__so">{invoice.referenceNumber}</span>
          )}
        </div>
        <span className="invoices-card__total">{formatCurrency(invoice.total)}</span>
      </div>
      <span className="invoices-card__chevron" aria-hidden>
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user ? homePathForRole(user.role) : '/dealer';
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

  const mobileSortValue = `${sortField}:${sortDir}`;

  const openInvoice = (id: string) => navigate(`${basePath}/invoices/${id}`);

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

  const handleMobileSort = (value: string) => {
    const option = MOBILE_SORT_OPTIONS.find(o => o.value === value);
    if (!option) return;
    setSortField(option.sortField);
    setSortDir(option.sortDir);
  };

  const SortMark = ({ field }: { field: NonNullable<InvoiceListParams['sortField']> }) => (
    <span className="invoices-sort-mark">{sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const showInitialLoader = loading && invoices.length === 0;
  const showList = !showInitialLoader && invoices.length > 0;

  return (
    <div className="page-content fade-in invoices-page">
      {error && (
        <div className="products-inline-error panel glass invoices-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <header className="invoices-toolbar invoices-toolbar--sticky">
        <div className="invoices-toolbar__search-row">
          <div className="catalog-search invoices-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              placeholder="Search invoices…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label="Search invoices"
            />
          </div>
          <button
            type="button"
            className="invoices-toolbar__refresh"
            disabled={loading}
            aria-label="Refresh invoices"
            onClick={() => void loadInvoices()}
          >
            <RefreshCw size={17} className={loading ? 'spin-icon' : undefined} />
          </button>
        </div>

        <div className="invoices-toolbar__filters">
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

          <select
            className="catalog-select invoices-toolbar__sort-mobile"
            value={mobileSortValue}
            onChange={e => handleMobileSort(e.target.value)}
            aria-label="Sort invoices"
          >
            {MOBILE_SORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="invoices-toolbar__count" aria-live="polite">
            {total > 0 ? `${total.toLocaleString('en-IN')} invoices` : 'No invoices'}
          </span>
        </div>
      </header>

      <div className="invoices-page__body">
        {showInitialLoader ? (
          <FetchingLoader label="Loading invoices…" />
        ) : invoices.length === 0 ? (
          <div className="invoices-empty panel glass">
            <FileText size={36} aria-hidden />
            <h2>No invoices found</h2>
            <p className="text-muted text-sm">
              {debouncedSearch || (statusFilter && statusFilter !== 'all')
                ? 'Try adjusting your search or status filter.'
                : 'Invoices issued to your dealer account in Zoho will appear here.'}
            </p>
          </div>
        ) : (
          <>
            <div
              className={`invoices-list ${loading ? 'invoices-list--loading' : ''}`}
              aria-busy={loading}
            >
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
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openInvoice(invoice.id)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="invoices-cards invoices-cards--mobile">
                {invoices.map(invoice => (
                  <InvoiceMobileCard key={invoice.id} invoice={invoice} onOpen={openInvoice} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showList && totalPages > 1 && (
        <footer className="invoices-pagination invoices-pagination--sticky panel glass">
          <span className="invoices-pagination__info text-muted text-sm">
            {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString('en-IN')}
          </span>
          <div className="invoices-pagination__btns">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Prev
            </button>
            <span className="invoices-pagination__page text-sm">
              {page}/{totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      )}
    </div>
  );
};
