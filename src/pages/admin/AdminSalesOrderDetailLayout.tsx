import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ClipboardList,
} from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { useAuth } from '../../context/AuthContext';
import { InvoiceCategoryBadge } from '../../components/invoices/InvoiceCategoryVisual';
import { useCatalogPageHeader, usePageHeaderTitleMeta } from '../../context/PageHeaderContext';
import {
  fetchAdminSalesOrderDetail,
  type AdminSalesOrderDetail,
} from '../../lib/admin-sales-orders';
import { fetchDealerSalesOrderDetail } from '../../lib/dealer-sales-orders';
import { dealerOrderErrorMessage, voidZohoSalesOrder } from '../../lib/dealerOrders';
import {
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceStatusLabel,
} from '../../lib/invoices';
import { canNavigateBackInApp } from '../../lib/navigation';
import {
  deleteDraftSalesOrder,
  markSalesOrderReadyForPayment,
  verifySalesOrderPayment,
  yesOneStageLabel,
} from '../../lib/salesOrderWorkflow';
import type {
  AdminSalesOrderDetailOutletContext,
  SalesOrderActionBusy,
  SalesOrderWorkflowActions,
} from './adminSalesOrderDetailContext';

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
  const canVerifyPayment = !isDealerView && user?.role === 'super_admin';
  const listPath = `${basePath}/sales-orders`;
  const summaryPath = `${listPath}/${salesOrderId}`;
  const isPdfView = pathname.endsWith('/view');

  const [salesOrder, setSalesOrder] = useState<AdminSalesOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<SalesOrderActionBusy>(null);

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

  const isOrderPlaced = salesOrder?.yesOneStage === 'review';
  const titleStatusLabel = isOrderPlaced
    ? (salesOrder?.status ? invoiceStatusLabel(salesOrder.status) : 'Draft')
    : salesOrder?.yesOneStage
      ? yesOneStageLabel(salesOrder.yesOneStage)
      : (salesOrder?.status ? invoiceStatusLabel(salesOrder.status) : '');
  const titleStatusClass = isOrderPlaced
    ? `invoices-status invoices-status--${String(salesOrder?.status || 'draft').toLowerCase().replace(/\s+/g, '_')}`
    : salesOrder?.yesOneStage
      ? (
        salesOrder.yesOneStage === 'completed' ? 'invoices-status invoices-status--paid'
          : salesOrder.yesOneStage === 'void' ? 'invoices-status invoices-status--void'
            : salesOrder.yesOneStage === 'payment_submitted' ? 'invoices-status invoices-status--partially_paid'
              : salesOrder.yesOneStage === 'ready_for_payment' ? 'invoices-status invoices-status--overdue'
                : 'invoices-status invoices-status--draft'
      )
      : `invoices-status invoices-status--${String(salesOrder?.status || 'draft').toLowerCase().replace(/\s+/g, '_')}`;

  const titleMeta = useMemo(() => {
    if (!salesOrder || isPdfView) return null;
    return (
      <>
        <InvoiceCategoryBadge category={salesOrder.salesOrderCategory} />
        {isOrderPlaced ? (
          <span className="invoices-status so-status--order-placed">Order placed</span>
        ) : null}
        {titleStatusLabel ? (
          <span className={titleStatusClass}>{titleStatusLabel}</span>
        ) : null}
      </>
    );
  }, [salesOrder, isPdfView, isOrderPlaced, titleStatusLabel, titleStatusClass]);

  usePageHeaderTitleMeta(titleMeta, Boolean(titleMeta));

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
  const stage = String(salesOrder?.yesOneStage || 'review');
  const canReady = canManageZoho
    && (statusKey === 'draft' || statusKey === 'pending' || statusKey === 'confirmed' || statusKey === 'open')
    && (stage === 'review' || !salesOrder?.yesOneStage);
  const canVerify = canVerifyPayment && stage === 'payment_submitted';
  const canDelete = Boolean(
    (canManageZoho || isDealerView)
    && (statusKey === 'draft' || statusKey === 'pending')
    && stage !== 'payment_submitted'
    && stage !== 'completed'
    && stage !== 'void',
  );
  const canVoid = Boolean(
    canManageZoho
    && !canDelete
    && statusKey
    && statusKey !== 'void'
    && statusKey !== 'closed'
    && statusKey !== 'cancelled'
    && statusKey !== 'canceled'
    && stage !== 'completed'
    && stage !== 'void',
  );

  const handleReady = useCallback(async () => {
    if (!salesOrderId || actionBusy) return;
    if (!window.confirm(
      'Mark this order ready for payment? The dealer will be asked to upload payment proof. You can still edit lines until they submit payment.',
    )) return;
    setActionBusy('ready');
    try {
      const next = await markSalesOrderReadyForPayment(salesOrderId);
      setSalesOrder(next);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }, [salesOrderId, actionBusy]);

  const handleVerify = useCallback(async () => {
    if (!salesOrderId || actionBusy) return;
    if (!window.confirm(
      'Verify payment, confirm this sales order in Zoho, and create the invoice?',
    )) return;
    setActionBusy('verify');
    try {
      const next = await verifySalesOrderPayment(salesOrderId);
      setSalesOrder(next);
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }, [salesOrderId, actionBusy]);

  const handleVoid = useCallback(async () => {
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
  }, [salesOrderId, actionBusy, reload]);

  const handleDelete = useCallback(async () => {
    if (!salesOrderId || actionBusy) return;
    const label = salesOrder?.salesOrderNumber?.trim() || 'this draft sales order';
    if (!window.confirm(
      `Delete ${label}? It will be permanently removed from Zoho and YesOne. This cannot be undone.`,
    )) return;
    setActionBusy('delete');
    try {
      await deleteDraftSalesOrder(salesOrderId);
      navigate(listPath, { replace: true });
    } catch (err) {
      window.alert(dealerOrderErrorMessage(err));
      setActionBusy(null);
    }
  }, [salesOrderId, actionBusy, salesOrder?.salesOrderNumber, navigate, listPath]);

  const workflowActions = useMemo<SalesOrderWorkflowActions | null>(() => {
    if (isPdfView) return null;
    if (isDealerView) {
      if (!canDelete) return null;
      return {
        actionBusy,
        canReady: false,
        canVerify: false,
        canVoid: false,
        canDelete,
        onReady: () => {},
        onVerify: () => {},
        onVoid: () => {},
        onDelete: () => { void handleDelete(); },
      };
    }
    return {
      actionBusy,
      canReady,
      canVerify,
      canVoid,
      canDelete,
      onReady: () => { void handleReady(); },
      onVerify: () => { void handleVerify(); },
      onVoid: () => { void handleVoid(); },
      onDelete: () => { void handleDelete(); },
    };
  }, [
    isDealerView,
    isPdfView,
    actionBusy,
    canReady,
    canVerify,
    canVoid,
    canDelete,
    handleReady,
    handleVerify,
    handleVoid,
    handleDelete,
  ]);

  if (!salesOrderId) return null;

  const outletContext: AdminSalesOrderDetailOutletContext = {
    salesOrder,
    loading,
    error,
    salesOrderId,
    listPath,
    reload,
    setSalesOrder,
    workflowActions,
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
        <Outlet context={outletContext} />
      )}
    </div>
  );
};
