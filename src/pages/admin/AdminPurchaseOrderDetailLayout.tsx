import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, DollarSign, FileText, Ship, ShoppingBag } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { PurchaseOrderBlDialog } from '../../components/admin/PurchaseOrderBlDialog';
import { PurchaseOrderPiDialog } from '../../components/admin/PurchaseOrderPiDialog';
import { KotakBankFeedsSheet } from '../../components/salesOrders/KotakBankFeedsSheet';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  associateKotakPayoutWithPurchaseOrder,
  fetchAdminPurchaseOrderDetail,
  formatPurchaseOrderVendorPiTotal,
  purchaseOrderHasBl,
  purchaseOrderHasVendorPi,
  purchaseOrderVendorPiIsPdf,
  type AdminPurchaseOrderDetail,
} from '../../lib/admin-purchase-orders';
import { fetchKotakBankFeeds, type KotakBankFeed } from '../../lib/kotakBankFeeds';
import { fetchUsdToInrRate } from '../../lib/sparePricing';
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
  const [piOpen, setPiOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutAssociating, setPayoutAssociating] = useState(false);
  const [payoutFeeds, setPayoutFeeds] = useState<KotakBankFeed[]>([]);
  const [payoutFetchedAt, setPayoutFetchedAt] = useState<string | null>(null);
  const [usdToInrRate, setUsdToInrRate] = useState<number | null>(null);
  const canEditBl = canUpdatePurchaseOrders(user);

  const openBl = useCallback(() => {
    setBlOpen(true);
  }, []);

  const openPi = useCallback(() => {
    setPiOpen(true);
  }, []);

  const openPayoutSheet = useCallback(() => {
    if (!canEditBl) {
      setError('Only Super Admin can associate a payment.');
      return;
    }
    setPayoutOpen(true);
    setPayoutLoading(true);
    void Promise.all([
      fetchKotakBankFeeds(),
      fetchUsdToInrRate().catch(() => null),
    ]).then(([feeds, fx]) => {
      setPayoutFeeds(feeds.feeds);
      setPayoutFetchedAt(feeds.fetchedAt);
      setUsdToInrRate(fx && fx.rate > 0 ? fx.rate : null);
    }).catch(err => {
      setError(invoiceErrorMessage(err));
      setPayoutOpen(false);
    }).finally(() => {
      setPayoutLoading(false);
    });
  }, [canEditBl]);

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
                className="invoice-detail-top__actions invoice-detail-top__actions--triple"
                role="group"
                aria-label="Purchase order actions"
              >
                <button
                  type="button"
                  className={[
                    'invoice-detail-top__card',
                    'invoice-detail-top__card--blue',
                    purchaseOrderHasVendorPi(purchaseOrder.vendorPi) || piOpen ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={openPi}
                  aria-label="Upload vendor proforma invoice"
                  title={
                    formatPurchaseOrderVendorPiTotal(purchaseOrder.vendorPi)
                      ? `Vendor PI · ${formatPurchaseOrderVendorPiTotal(purchaseOrder.vendorPi)}`
                      : purchaseOrder.vendorPi?.fileName
                        ? `Vendor PI · ${purchaseOrder.vendorPi.fileName}`
                        : 'Upload vendor PI (Excel or PDF)'
                  }
                >
                  <span className="invoice-detail-top__card-icon">
                    <FileText size={28} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="invoice-detail-top__card-label">PI</span>
                  {purchaseOrderHasVendorPi(purchaseOrder.vendorPi) ? (
                    <span className="invoice-detail-top__card-meta">
                      {formatPurchaseOrderVendorPiTotal(purchaseOrder.vendorPi)
                        || (purchaseOrderVendorPiIsPdf(purchaseOrder.vendorPi) ? 'PDF' : 'Excel')}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={[
                    'invoice-detail-top__card',
                    'invoice-detail-top__card--amber',
                    purchaseOrderHasBl(purchaseOrder.bl) || blOpen ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={openBl}
                  aria-label="Upload bill of lading copy"
                  title={purchaseOrder.bl?.containerNumber
                    ? `Bill of lading · ${purchaseOrder.bl.containerNumber}`
                    : 'Upload bill of lading copy'}
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
                <button
                  type="button"
                  className={[
                    'invoice-detail-top__card',
                    'invoice-detail-top__card--green',
                    purchaseOrder.kotakPayout || payoutOpen ? 'is-active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={openPayoutSheet}
                  aria-label="Associate US dollar payment"
                  title={purchaseOrder.kotakPayout?.amountUsd
                    ? `Payment · $${purchaseOrder.kotakPayout.amountUsd.toFixed(2)}`
                    : 'Associate Kotak payout (USD)'}
                >
                  <span className="invoice-detail-top__card-icon">
                    <DollarSign size={28} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="invoice-detail-top__card-label">Payment</span>
                  {purchaseOrder.kotakPayout?.amountUsd ? (
                    <span className="invoice-detail-top__card-meta">
                      ${purchaseOrder.kotakPayout.amountUsd.toFixed(2)}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
            <PurchaseOrderPiDialog
              open={piOpen}
              purchaseOrder={purchaseOrder}
              canEdit={canEditBl}
              onClose={() => setPiOpen(false)}
              onSaved={vendorPi => {
                setPurchaseOrder({ ...purchaseOrder, vendorPi });
                setPiOpen(false);
              }}
              onPiUpdated={vendorPi => {
                setPurchaseOrder(prev => (prev ? { ...prev, vendorPi } : prev));
              }}
            />
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
            {payoutOpen ? (
              <KotakBankFeedsSheet
                kind="payout"
                feeds={payoutFeeds}
                fetchedAt={payoutFetchedAt}
                loading={payoutLoading}
                selecting={payoutAssociating}
                purchaseOrderId={purchaseOrder.id}
                reservedTransactionId={purchaseOrder.kotakPayout?.transactionId ?? null}
                usdToInrRate={usdToInrRate}
                onClose={() => {
                  if (!payoutAssociating) setPayoutOpen(false);
                }}
                onAssociatePayout={async (feed, usd) => {
                  setPayoutAssociating(true);
                  try {
                    const result = await associateKotakPayoutWithPurchaseOrder({
                      purchaseOrderId: purchaseOrder.id,
                      feed,
                      amountUsd: usd.amountUsd,
                      usdToInrRate: usd.usdToInrRate,
                    });
                    setPurchaseOrder({
                      ...purchaseOrder,
                      kotakPayout: result.kotakPayout,
                      tracking: result.tracking,
                      activityLogs: result.activityLogs,
                    });
                    setPayoutOpen(false);
                  } finally {
                    setPayoutAssociating(false);
                  }
                }}
              />
            ) : null}
            </>
          )}
          <Outlet context={outletContext} />
        </>
      )}
    </div>
  );
};
