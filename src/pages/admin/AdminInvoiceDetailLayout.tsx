import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, FileText } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { BookCourierEntryButton } from '../../components/logistics/BookCourierEntryButton';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminInvoiceDetail,
} from '../../lib/admin-invoices';
import { fetchCatalog } from '../../lib/catalog';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { canCreateLogisticsBooking } from '../../lib/logisticsBookings';
import {
  buildInvoiceBookingDraftPatch,
  canBookCourierForInvoice,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';
import type { DealerInvoiceDetail } from '../../types/invoices';
import { canNavigateBackInApp } from '../../lib/navigation';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDetailLayout: React.FC = () => {
  const { customerId = '', invoiceId = '' } = useParams<{
    customerId: string;
    invoiceId: string;
  }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const invoicesPath = pathname.startsWith('/staff') ? '/staff/invoices' : '/super-admin/invoices';
  const invoiceSummaryPath = `${invoicesPath}/${customerId}/${invoiceId}/invoice`;
  const isPdfView = pathname.endsWith('/invoice/view');

  const [invoice, setInvoice] = useState<DealerInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [courierEntry, setCourierEntry] = useState<LogisticsEntryState | null>(null);

  const handleBack = useCallback(() => {
    if (isPdfView) {
      if (canNavigateBackInApp()) {
        navigate(-1);
      } else {
        navigate(invoiceSummaryPath, { replace: true });
      }
      return;
    }
    navigate(invoicesPath);
  }, [isPdfView, navigate, invoiceSummaryPath, invoicesPath]);

  useCatalogPageHeader({
    title: invoice?.invoiceNumber ?? 'Invoice',
    subtitle: invoice?.date ? formatInvoiceDate(invoice.date) : null,
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!customerId || !invoiceId) return;
    let cancelled = false;

    setLoading(true);
    setError('');

    fetchAdminInvoiceDetail(customerId, invoiceId)
      .then(data => {
        if (cancelled) return;
        setInvoice(data);
        setError('');
      })
      .catch(err => {
        if (!cancelled) {
          setInvoice(null);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, invoiceId]);

  /** Prefill ST partner + cartonized boxes from catalog package info. */
  useEffect(() => {
    if (!invoice || !customerId || !invoiceId || !user) {
      setCourierEntry(null);
      return;
    }
    if (!canCreateLogisticsBooking(user) || !canBookCourierForInvoice(invoice)) {
      setCourierEntry(null);
      return;
    }

    let cancelled = false;
    void fetchCatalog()
      .then(catalog => {
        if (cancelled) return;
        const productsById = new Map(catalog.items.map(item => [item.id, item]));
        setCourierEntry({
          draftPatch: buildInvoiceBookingDraftPatch(
            invoice,
            invoiceId,
            customerId,
            customerId,
            {
              productsById,
              shipFromSite: user.staffLogisticsSite ?? 'cochin',
            },
          ),
          dealerQuery: invoice.customerName ?? undefined,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Still allow booking with partner + dealer even if catalog dims fail.
        setCourierEntry({
          draftPatch: buildInvoiceBookingDraftPatch(
            invoice,
            invoiceId,
            customerId,
            customerId,
            { shipFromSite: user.staffLogisticsSite ?? 'cochin' },
          ),
          dealerQuery: invoice.customerName ?? undefined,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [invoice, customerId, invoiceId, user]);

  if (!customerId || !invoiceId) return null;

  const outletContext: AdminInvoiceDetailOutletContext = {
    invoice,
    loading,
    error,
    customerId,
    invoiceId,
    invoicesPath,
  };

  return (
    <div className={`page-content fade-in invoice-detail-page ${isPdfView ? 'invoice-detail-page--pdf-view' : ''}`}>
      {error && (
        <div className="products-inline-error panel glass invoice-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !invoice ? (
        <FetchingLoader label="Loading invoice…" />
      ) : !invoice ? (
        <div className="invoices-empty panel glass">
          <FileText size={36} aria-hidden />
          <h2>Invoice not found</h2>
          <p className="text-muted text-sm">This invoice may have been removed or is unavailable.</p>
        </div>
      ) : (
        <>
          {!isPdfView && (
            <div className="invoice-detail-top admin-invoice-detail-top">
              <div
                className={[
                  'invoice-detail-top__actions',
                  courierEntry ? 'invoice-detail-top__actions--pair' : 'invoice-detail-top__actions--single',
                ].join(' ')}
                role="tablist"
                aria-label="Invoice sections"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected
                  className="invoice-detail-top__card invoice-detail-top__card--blue is-active"
                  onClick={() => navigate(`${invoicesPath}/${customerId}/${invoiceId}/invoice/view`)}
                >
                  <span className="invoice-detail-top__card-icon">
                    <FileText size={28} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="invoice-detail-top__card-label">Invoice</span>
                </button>
                {courierEntry ? (
                  <BookCourierEntryButton entry={courierEntry} variant="card" />
                ) : null}
              </div>
            </div>
          )}
          <Outlet context={outletContext} />
        </>
      )}
    </div>
  );
};
