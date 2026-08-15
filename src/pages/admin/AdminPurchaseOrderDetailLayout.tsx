import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, FileText, Ship, ShoppingBag } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { PurchaseOrderBlDialog } from '../../components/admin/PurchaseOrderBlDialog';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminPurchaseOrderDetail,
  purchaseOrderHasBl,
  type AdminPurchaseOrderDetail,
} from '../../lib/admin-purchase-orders';
import { formatInvoiceDate, invoiceErrorMessage } from '../../lib/invoices';
import { canNavigateBackInApp } from '../../lib/navigation';
import { canUpdatePurchaseOrders } from '../../lib/staffAccess';
import type { AdminPurchaseOrderDetailOutletContext } from './adminPurchaseOrderDetailContext';

export const AdminPurchaseOrderDetailLayout: React.FC = () => {
  const { purchaseOrderId = '' } = useParams<{ purchaseOrderId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const basePath = '/super-admin';
  const listPath = `${basePath}/purchase-orders`;
  const summaryPath = `${listPath}/${purchaseOrderId}`;
  const isPdfView = pathname.endsWith('/view');

  const { user } = useAuth();
  const [purchaseOrder, setPurchaseOrder] = useState<AdminPurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [blOpen, setBlOpen] = useState(false);
  const canEditBl = canUpdatePurchaseOrders(user);

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
    setPurchaseOrder,
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
            <>
            <div className="invoice-detail-top admin-invoice-detail-top">
              <div
                className="invoice-detail-top__actions invoice-detail-top__actions--pair"
                role="tablist"
                aria-label="Purchase order sections"
              >
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
                <button
                  type="button"
                  role="tab"
                  aria-selected={blOpen}
                  className={[
                    'invoice-detail-top__card',
                    'invoice-detail-top__card--amber',
                    purchaseOrderHasBl(purchaseOrder.bl) || blOpen ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setBlOpen(true)}
                  title={purchaseOrder.bl?.containerNumber
                    ? `Bill of lading · ${purchaseOrder.bl.containerNumber}`
                    : 'Bill of lading'}
                >
                  <span className="invoice-detail-top__card-icon">
                    <Ship size={28} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="invoice-detail-top__card-label">BL</span>
                  {purchaseOrder.bl?.containerNumber ? (
                    <span className="invoice-detail-top__card-meta">
                      {purchaseOrder.bl.containerNumber}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
            <PurchaseOrderBlDialog
              open={blOpen}
              purchaseOrder={purchaseOrder}
              canEdit={canEditBl}
              onClose={() => setBlOpen(false)}
              onSaved={bl => {
                setPurchaseOrder({ ...purchaseOrder, bl });
                setBlOpen(false);
              }}
            />
            </>
          )}
          <Outlet context={outletContext} />
        </>
      )}
    </div>
  );
};
