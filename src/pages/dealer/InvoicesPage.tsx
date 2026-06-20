import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, FileText, Search } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/catalog';
import { homePathForRole } from '../../types';
import {
  fetchDealerInvoicesWithCache,
  formatInvoiceDate,
  formatInvoiceRelativeTime,
  invoiceErrorMessage,
  invoiceStatusLabel,
  readCachedDealerInvoices,
} from '../../lib/invoices';
import type { DealerInvoice, InvoiceListParams } from '../../types/invoices';

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

function InvoicePagination({
  page,
  totalPages,
  total,
  limit,
  loading,
  onPageChange,
  sticky = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  loading: boolean;
  onPageChange: (updater: (current: number) => number) => void;
  sticky?: boolean;
}) {
  const className = `invoices-pagination panel glass${sticky ? ' invoices-pagination--sticky' : ' invoices-pagination--top'}`;
  const content = (
    <>
      <span className="invoices-pagination__info text-muted text-sm">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString('en-IN')}
      </span>
      <div className="invoices-pagination__btns">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(p => p - 1)}
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
          onClick={() => onPageChange(p => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );

  if (sticky) {
    return <footer className={className}>{content}</footer>;
  }

  return <div className={className} role="navigation" aria-label="Invoice list pagination">{content}</div>;
}

export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [sortField, setSortField] = useState<NonNullable<InvoiceListParams['sortField']>>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const limit = 25;

  const [invoices, setInvoices] = useState<DealerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const openInvoice = (id: string) => navigate(`${basePath}/invoices/${id}/invoice`);

  const queryParams = useMemo((): InvoiceListParams => ({
    page,
    limit,
    sortField,
    sortDir,
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
  }), [page, debouncedSearch, sortField, sortDir]);

  const loadInvoices = useCallback(async () => {
    const uid = user?.uid;
    let usedCache = false;

    if (uid) {
      const cached = readCachedDealerInvoices(uid, queryParams);
      if (cached) {
        setInvoices(cached.data);
        setTotal(cached.pagination.total);
        setLastSyncedAt(cached.lastSyncedAt ?? null);
        setLoading(false);
        usedCache = true;
      } else {
        setLoading(true);
      }
    } else {
      setLoading(true);
    }

    if (!usedCache) setError('');

    try {
      const res = await fetchDealerInvoicesWithCache(uid, queryParams);
      setInvoices(res.data);
      setTotal(res.pagination.total);
      setLastSyncedAt(res.lastSyncedAt ?? null);
      setError('');
    } catch (err) {
      if (!usedCache) {
        setError(invoiceErrorMessage(err));
        setInvoices([]);
        setTotal(0);
        setLastSyncedAt(null);
      } else {
        setError('Could not refresh. Showing saved invoices.');
      }
    } finally {
      setLoading(false);
    }
  }, [queryParams, user?.uid]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortField, sortDir]);

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
              placeholder="Search invoices, serial numbers, SO…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label="Search invoices and serial numbers"
            />
          </div>
        </div>

        <div className="invoices-toolbar__filters">
          <span className="invoices-toolbar__count" aria-live="polite">
            {loading && invoices.length === 0
              ? 'Loading…'
              : total > 0
                ? `${total.toLocaleString('en-IN')} invoices`
                : 'No invoices'}
          </span>
          {lastSyncedAt && (
            <span className="invoices-toolbar__sync text-muted text-sm">
              Updated {formatInvoiceRelativeTime(lastSyncedAt)}
            </span>
          )}
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
              {debouncedSearch
                ? 'Try a different search term.'
                : 'No invoices are available for your account yet.'}
            </p>
          </div>
        ) : (
          <>
            {showList && totalPages > 1 && (
              <InvoicePagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={limit}
                loading={loading}
                onPageChange={setPage}
              />
            )}

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
        <InvoicePagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          loading={loading}
          onPageChange={setPage}
          sticky
        />
      )}
    </div>
  );
};
