import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, FileText, ClipboardList } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminSalesOrderDetail,
  type AdminSalesOrderDetail,
} from '../../lib/admin-sales-orders';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { navigateBack } from '../../lib/navigation';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDetailLayout: React.FC = () => {
  const { salesOrderId = '' } = useParams<{ salesOrderId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const listPath = `${basePath}/sales-orders`;
  const summaryPath = `${listPath}/${salesOrderId}`;
  const isPdfView = pathname.endsWith('/view');

  const [salesOrder, setSalesOrder] = useState<AdminSalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handleBack = useCallback(() => {
    if (isPdfView) {
      navigate(summaryPath);
      return;
    }
    navigateBack(navigate, listPath);
  }, [isPdfView, navigate, summaryPath, listPath]);

  useCatalogPageHeader({
    title: salesOrder?.salesOrderNumber ?? 'Sales order',
    subtitle: salesOrder?.date ? formatInvoiceDate(salesOrder.date) : null,
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!salesOrderId) return;
    let cancelled = false;

    setLoading(true);
    setError('');

    fetchAdminSalesOrderDetail(salesOrderId)
      .then(data => {
        if (!cancelled) {
          setSalesOrder(data);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setSalesOrder(null);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [salesOrderId]);

  if (!salesOrderId) return null;

  const outletContext: AdminSalesOrderDetailOutletContext = {
    salesOrder,
    loading,
    error,
    salesOrderId,
    listPath,
  };

  return (
    <div className={`page-content fade-in invoice-detail-page ${isPdfView ? 'invoice-detail-page--pdf-view' : ''}`}>
      {error && (
        <div className="products-inline-error panel glass invoice-detail-page__error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading && !salesOrder ? (
        <FetchingLoader label="Loading Sales order…" />
      ) : !salesOrder ? (
        <div className="invoices-empty panel glass">
          <ClipboardList size={36} aria-hidden />
          <h2>Sales order not found</h2>
          <p className="text-muted text-sm">This Sales order may have been removed or is unavailable.</p>
        </div>
      ) : (
        <>
          {!isPdfView && (
            <div className="invoice-detail-top admin-invoice-detail-top">
              <div className="invoice-detail-top__actions" role="tablist" aria-label="Sales order sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected
                  className="invoice-detail-top__card invoice-detail-top__card--blue is-active"
                  onClick={() => navigate(`${summaryPath}/view`)}
                >
                  <span className="invoice-detail-top__card-icon">
                    <FileText size={28} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="invoice-detail-top__card-label">View PDF</span>
                </button>
              </div>
            </div>
          )}
          <Outlet context={outletContext} />
        </>
      )}
    </div>
  );
};
