import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Check, FileText, ClipboardList, Ban } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminSalesOrderDetail,
  type AdminSalesOrderDetail,
} from '../../lib/admin-sales-orders';
import { fetchDealerSalesOrderDetail } from '../../lib/dealer-sales-orders';
import {
  confirmZohoSalesOrder,
  dealerOrderErrorMessage,
  voidZohoSalesOrder,
} from '../../lib/dealerOrders';
import { formatInvoiceDate, invoiceErrorMessage, invoiceStatusLabel } from '../../lib/invoices';
import { canNavigateBackInApp } from '../../lib/navigation';
import type { AdminSalesOrderDetailOutletContext } from './adminSalesOrderDetailContext';

export const AdminSalesOrderDetailLayout: React.FC = () => {
  const { salesOrderId = '' } = useParams<{ salesOrderId: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const basePath = pathname.startsWith('/staff')
    ? '/staff'
    : pathname.startsWith('/dealer')
      ? (pathname.startsWith('/dealer-staff') ? '/dealer-staff' : '/dealer')
      : '/super-admin';
  const isDealerView = basePath === '/dealer' || basePath === '/dealer-staff';
  const canManageZoho = !isDealerView
    && (user?.role === 'staff' || user?.role === 'super_admin');
  const listPath = `${basePath}/sales-orders`;
  const summaryPath = `${listPath}/${salesOrderId}`;
  const isPdfView = pathname.endsWith('/view');

  const [salesOrder, setSalesOrder] = useState<AdminSalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<'confirm' | 'void' | null>(null);

  const handleBack = useCallback(() => {
    if (isPdfView) {
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
    title: salesOrder?.salesOrderNumber ?? 'Sales order',
    subtitle: salesOrder?.date ? formatInvoiceDate(salesOrder.date) : null,
    showBack: true,
    onBack: handleBack,
  });

  const reload = useCallback(() => {
    if (!salesOrderId) return;
    setLoading(true);
    setError('');
    const load = isDealerView
      ? fetchDealerSalesOrderDetail(salesOrderId)
      : fetchAdminSalesOrderDetail(salesOrderId);
    void load
      .then(data => {
        setSalesOrder(data);
        setError('');
      })
      .catch(err => {
        setSalesOrder(null);
        setError(invoiceErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [salesOrderId, isDealerView]);

  useEffect(() => {
    reload();
  }, [reload]);

  const statusKey = String(salesOrder?.status || '').toLowerCase().replace(/\s+/g, '_');
  const canConfirm = canManageZoho && (statusKey === 'draft' || statusKey === 'pending');
  const canVoid = canManageZoho
    && statusKey
    && statusKey !== 'void'
    && statusKey !== 'closed'
    && statusKey !== 'cancelled'
    && statusKey !== 'canceled';

  const handleConfirm = async () => {
    if (!salesOrderId || actionBusy) return;
    if (!window.confirm('Mark this Zoho sales order as Confirmed?')) return;
    setActionBusy('confirm');
    try {
      await confirmZohoSalesOrder(salesOrderId);
      reload();
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setActionBusy(null);
    }
  };

  const handleVoid = async () => {
    if (!salesOrderId || actionBusy) return;
    const reason = window.prompt('Reason for voiding this sales order (optional):');
    if (reason === null) return;
    if (!window.confirm('Void this Zoho sales order? This cannot be undone easily.')) return;
    setActionBusy('void');
    try {
      await voidZohoSalesOrder(salesOrderId, reason.trim() || '');
      reload();
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setActionBusy(null);
    }
  };

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
              {(canConfirm || canVoid) && (
                <div className="invoice-detail-top__ops" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <span className="text-muted text-sm" style={{ width: '100%' }}>
                    Zoho status: <strong>{invoiceStatusLabel(salesOrder.status)}</strong>
                  </span>
                  {canConfirm && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={Boolean(actionBusy)}
                      onClick={() => { void handleConfirm(); }}
                    >
                      <Check size={14} aria-hidden />
                      {actionBusy === 'confirm' ? 'Confirming…' : 'Confirm in Zoho'}
                    </button>
                  )}
                  {canVoid && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={Boolean(actionBusy)}
                      onClick={() => { void handleVoid(); }}
                    >
                      <Ban size={14} aria-hidden />
                      {actionBusy === 'void' ? 'Voiding…' : 'Void in Zoho'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <Outlet context={outletContext} />
        </>
      )}
    </div>
  );
};
