import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, FileText, ShoppingBag } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminPurchaseOrderDetail,
  type AdminPurchaseOrderDetail,
} from '../../lib/admin-purchase-orders';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { canNavigateBackInApp } from '../../lib/navigation';
import type { AdminPurchaseOrderDetailOutletContext } from './adminPurchaseOrderDetailContext';

export const AdminPurchaseOrderDetailLayout: React.FC = () => {
  const { purchaseOrderId = '' } = useParams<{ purchaseOrderId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = pathname.startsWith('/staff') ? '/staff' : '/super-admin';
  const listPath = `${basePath}/purchase-orders`;
  const summaryPath = `${listPath}/${purchaseOrderId}`;
  const isPdfView = pathname.endsWith('/view');

  const [purchaseOrder, setPurchaseOrder] = useState<AdminPurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handleBack = useCallback(() => {
    if (isPdfView) {
      // Pop PDF off the stack so the next Back from details goes to the list, not PDF again.
      if (canNavigateBackInApp()) {
        navigate(-1);
      } else {
        navigate(summaryPath, { replace: true });
      }
      return;
    }
    navigate(listPath);
  }, [isPdfView, navigate, summaryPath, listPath]);

  useCatalogPageHeader({
    title: purchaseOrder?.purchaseOrderNumber ?? 'Purchase order',
    subtitle: purchaseOrder?.date ? formatInvoiceDate(purchaseOrder.date) : null,
    showBack: true,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!purchaseOrderId) return;
    let cancelled = false;

    setLoading(true);
    setError('');

    fetchAdminPurchaseOrderDetail(purchaseOrderId)
      .then(data => {
        if (!cancelled) {
          setPurchaseOrder(data);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setPurchaseOrder(null);
          setError(invoiceErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [purchaseOrderId]);

  if (!purchaseOrderId) return null;

  const outletContext: AdminPurchaseOrderDetailOutletContext = {
    purchaseOrder,
    loading,
    error,
    purchaseOrderId,
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

      {loading && !purchaseOrder ? (
        <FetchingLoader label="Loading purchase order…" />
      ) : !purchaseOrder ? (
        <div className="invoices-empty panel glass">
          <ShoppingBag size={36} aria-hidden />
          <h2>Purchase order not found</h2>
          <p className="text-muted text-sm">This purchase order may have been removed or is unavailable.</p>
        </div>
      ) : (
        <>
          {!isPdfView && (
            <div className="invoice-detail-top admin-invoice-detail-top">
              <div className="invoice-detail-top__actions" role="tablist" aria-label="Purchase order sections">
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
