import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ClipboardList, FileText, MapPin } from 'lucide-react';
import { FetchingLoader } from '../../components/FetchingLoader';
import { SpareOrderListViewDialog } from '../../components/invoices/SpareOrderListViewDialog';
import { BookCourierEntryButton } from '../../components/logistics/BookCourierEntryButton';
import {
  DelhiveryDocumentDialog,
  type DelhiveryDocumentDialogPayload,
} from '../../components/logistics/DelhiveryDocumentDialog';
import { DelhiveryQuoteStrip } from '../../components/logistics/DelhiveryQuoteStrip';
import { EwayBillIcon } from '../../components/logistics/EwayBillIcon';
import { InvoiceAddLrDialog } from '../../components/logistics/InvoiceAddLrDialog';
import { InvoiceCustomerPickupDialog } from '../../components/logistics/InvoiceCustomerPickupDialog';
import { LogisticsAwbEntryButton } from '../../components/logistics/LogisticsAwbEntryButton';
import { invoiceTotalInclGst } from '../../constants/ewayBill';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import {
  fetchAdminInvoiceDetail,
} from '../../lib/admin-invoices';
import { fetchCatalog } from '../../lib/catalog';
import { pinFromText } from '../../lib/delhiveryQuote';
import {
  ensureInvoiceEwayBill,
  type InvoiceEwayBillResult,
} from '../../lib/invoiceEwayBill';
import {
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceHasCategory,
} from '../../lib/invoices';
import {
  canCreateLogisticsBooking,
  findLogisticsBookingForInvoice,
} from '../../lib/logisticsBookings';
import {
  buildInvoiceBookingDraftPatch,
  canBookCourierForInvoice,
  canRecordInvoiceLogisticsLr,
  resolveInvoiceCourierPartner,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import { resolveInvoiceShipFromSiteOrDefault, shipFromSiteLabel } from '../../lib/logisticsShipFrom';
import {
  canMarkInvoiceCustomerPickup,
  invoiceNeedsCustomerPickupEwayVehicle,
  isInvoiceCustomerPickup,
} from '../../lib/invoiceCustomerPickup';
import { base64ToUint8Array } from '../../lib/pdfViewer';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { CatalogProduct } from '../../types/catalog';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../../types/staff-logistics';
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
  const [existingBooking, setExistingBooking] = useState<LogisticsBooking | null>(null);
  const [addLrAvailable, setAddLrAvailable] = useState(false);
  const [addLrPartnerId, setAddLrPartnerId] = useState<LogisticsPartnerId>('delhivery');
  const [addLrPartnerFromFreight, setAddLrPartnerFromFreight] = useState(false);
  const [addLrShipFrom, setAddLrShipFrom] = useState<StaffLogisticsSite | null>(null);
  const [addLrOpen, setAddLrOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [pickupShipFrom, setPickupShipFrom] = useState<StaffLogisticsSite>('cochin');
  const [pickupShipFromLabel, setPickupShipFromLabel] = useState('Cochin');
  const [orderListOpen, setOrderListOpen] = useState(false);
  const [delhiveryOriginPin, setDelhiveryOriginPin] = useState('');
  const [ewayDocOpening, setEwayDocOpening] = useState(false);
  const [ewayDocError, setEwayDocError] = useState('');
  const [ewayDocDialog, setEwayDocDialog] = useState<DelhiveryDocumentDialogPayload | null>(null);

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
    let cancelled = false;
    void loadLogisticsSettings()
      .then((settings) => {
        if (cancelled) return;
        const pin = pinFromText(
          settings.fromAddresses?.cochin || settings.fromAddresses?.head_office || '',
        );
        setDelhiveryOriginPin(pin);
      })
      .catch(() => { /* optional */ });
    return () => { cancelled = true; };
  }, []);

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

  /** Existing AWB booking wins; else Book Courier (≤4 days) or Add LR (any age). */
  useEffect(() => {
    if (!invoice || !customerId || !invoiceId || !user) {
      setCourierEntry(null);
      setExistingBooking(null);
      setAddLrAvailable(false);
      return;
    }
    if (!isInternalOpsUser(user)) {
      setCourierEntry(null);
      setExistingBooking(null);
      setAddLrAvailable(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const linked = await findLogisticsBookingForInvoice(invoiceId).catch(() => null);
      if (cancelled) return;
      if (linked) {
        setExistingBooking(linked);
        setCourierEntry(null);
        setAddLrAvailable(false);
        return;
      }
      setExistingBooking(null);

      if (isInvoiceCustomerPickup(invoice)) {
        setCourierEntry(null);
        setAddLrAvailable(false);
        return;
      }

      const branch = await resolveInvoiceShipFromSiteOrDefault(invoice);
      const shipFromSite = branch.site;
      if (cancelled) return;
      setAddLrShipFrom(shipFromSite);
      setPickupShipFrom(shipFromSite);
      setPickupShipFromLabel(branch.branchLabel);
      const courierPartner = resolveInvoiceCourierPartner(invoice);
      setAddLrPartnerId(courierPartner.partnerId);
      setAddLrPartnerFromFreight(courierPartner.fromFreight);

      const canCreate = canCreateLogisticsBooking(user);
      setAddLrAvailable(canCreate && canRecordInvoiceLogisticsLr(invoice));

      if (!canCreate || !canBookCourierForInvoice(invoice)) {
        setCourierEntry(null);
        return;
      }
      let productsById: Map<string, CatalogProduct> | undefined;
      try {
        const catalog = await fetchCatalog();
        productsById = new Map(catalog.items.map(item => [item.id, item]));
      } catch {
        // Still allow booking with partner + dealer even if catalog dims fail.
      }
      if (cancelled) return;
      setCourierEntry({
        draftPatch: buildInvoiceBookingDraftPatch(
          invoice,
          invoiceId,
          customerId,
          customerId,
          {
            productsById,
            shipFromSite,
            partnerId: courierPartner.partnerId,
          },
        ),
        dealerQuery: invoice.customerName ?? undefined,
        // No freight line → ops picks partner on Logistics.
        lockPartner: courierPartner.fromFreight,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice, customerId, invoiceId, user]);

  if (!customerId || !invoiceId) return null;

  const showManualLogistics = Boolean(addLrAvailable && !existingBooking && !isInvoiceCustomerPickup(invoice));
  const showCustomerPickup = Boolean(
    user
    && isInternalOpsUser(user)
    && canCreateLogisticsBooking(user)
    && invoice
    && canMarkInvoiceCustomerPickup(invoice, Boolean(existingBooking)),
  );
  const customerPickupActive = isInvoiceCustomerPickup(invoice);
  const outletContext: AdminInvoiceDetailOutletContext = {
    invoice,
    loading,
    error,
    customerId,
    invoiceId,
    invoicesPath,
    showManualLogistics,
    manualLogisticsPartnerId: addLrPartnerId,
    manualLogisticsPartnerFromFreight: addLrPartnerFromFreight,
    manualLogisticsShipFrom: addLrShipFrom,
    onOpenManualLogistics: () => setAddLrOpen(true),
    existingBooking,
  };

  // Shared picking list for product/spare invoices — ops (staff / super admin) only.
  const showOrderList = Boolean(
    user
    && isInternalOpsUser(user)
    && invoice
    && (
      invoiceHasCategory(invoice, 'product')
      || invoiceHasCategory(invoice, 'spare')
    ),
  );
  const showCourierCard = Boolean(courierEntry || existingBooking || customerPickupActive);
  const showPickupEwayCard = Boolean(
    customerPickupActive
    && invoice
    && (
      invoice.ewayBill?.status === 'generated'
      || Boolean(invoice.ewayBill?.ewaybillNumber?.trim())
      || invoice.ewayBill?.required === true
      || invoiceNeedsCustomerPickupEwayVehicle(invoice)
    ),
  );
  const topCardCount = 1
    + (showOrderList ? 1 : 0)
    + (showCourierCard || showCustomerPickup ? 1 : 0)
    + (showPickupEwayCard ? 1 : 0);
  const actionsLayout = topCardCount >= 4
    ? 'quad'
    : topCardCount === 3
      ? 'triple'
      : topCardCount === 2
        ? 'pair'
        : 'single';

  const showPickupEwayFromResult = useCallback((result: InvoiceEwayBillResult) => {
    if (!result.required) {
      setEwayDocError(result.message || 'E-way bill is not required for this invoice.');
      return;
    }
    if (!result.contentBase64) {
      setEwayDocError(result.message || 'E-way bill is not ready yet.');
      return;
    }
    const bytes = base64ToUint8Array(result.contentBase64);
    const mimeType = result.mimeType || 'application/pdf';
    const blob = new Blob([Uint8Array.from(bytes)], { type: mimeType });
    if (mimeType.includes('html')) {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    setEwayDocDialog({
      title: result.ewaybillNumber ? `E way bill ${result.ewaybillNumber}` : 'E way bill',
      contentType: mimeType,
      pdfBytes: bytes,
      fileName: result.filename || 'eway-bill.pdf',
      downloadBlob: blob,
      hideDownload: true,
    });
  }, []);

  const openPickupEwayBillDocument = useCallback(async () => {
    if (!invoice || !customerId || !invoiceId) return;
    setEwayDocOpening(true);
    setEwayDocError('');
    try {
      const result = await ensureInvoiceEwayBill({
        customerId,
        invoiceId,
        partnerId: 'personal_collection',
        lrNumber: invoice.customerPickup?.vehicleNumber || null,
        invoiceTotalInr: invoiceTotalInclGst(invoice),
        autoGenerate: invoice.ewayBill?.status !== 'generated',
      });
      setInvoice(prev => prev ? {
        ...prev,
        ewayBill: {
          ...(prev.ewayBill ?? {}),
          status: result.status ?? prev.ewayBill?.status ?? null,
          ewaybillNumber: result.ewaybillNumber ?? prev.ewayBill?.ewaybillNumber ?? null,
          required: result.required,
        },
      } : prev);
      showPickupEwayFromResult(result);
    } catch (err) {
      setEwayDocError(err instanceof Error ? err.message : 'Could not open e-way bill.');
    } finally {
      setEwayDocOpening(false);
    }
  }, [customerId, invoice, invoiceId, showPickupEwayFromResult]);

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
                  `invoice-detail-top__actions--${actionsLayout}`,
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
                {showOrderList ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={orderListOpen}
                    className={[
                      'invoice-detail-top__card',
                      'invoice-detail-top__card--green',
                      orderListOpen ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setOrderListOpen(true)}
                    title="Open order / picking list PDF"
                  >
                    <span className="invoice-detail-top__card-icon">
                      <ClipboardList size={28} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="invoice-detail-top__card-label">Order list</span>
                  </button>
                ) : null}
                {existingBooking ? (
                  <LogisticsAwbEntryButton
                    bookingId={existingBooking.id}
                    awbLabel={
                      existingBooking.consignmentNo?.trim()
                      || existingBooking.trackingNo?.trim()
                      || null
                    }
                    variant="card"
                  />
                ) : customerPickupActive ? (
                  <div
                    className="invoice-detail-top__card invoice-detail-top__card--amber is-active"
                    title="Customer pickup"
                  >
                    <span className="invoice-detail-top__card-icon">
                      <MapPin size={28} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="invoice-detail-top__card-label">Customer pickup</span>
                    <span className="invoice-detail-top__card-meta text-sm">
                      {invoice.customerPickup?.shipFromLabel
                        || shipFromSiteLabel(invoice.customerPickup?.shipFromSite)}
                      {invoice.customerPickup?.vehicleNumber
                        ? ` · ${invoice.customerPickup.vehicleNumber}`
                        : ''}
                    </span>
                  </div>
                ) : courierEntry ? (
                  <BookCourierEntryButton entry={courierEntry} variant="card" />
                ) : null}
                {showCustomerPickup ? (
                  <button
                    type="button"
                    className="invoice-detail-top__card invoice-detail-top__card--amber"
                    title="Mark as customer pickup — no courier booking"
                    onClick={() => setPickupOpen(true)}
                  >
                    <span className="invoice-detail-top__card-icon">
                      <MapPin size={28} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="invoice-detail-top__card-label">Customer pickup</span>
                  </button>
                ) : null}
                {showPickupEwayCard ? (
                  <button
                    type="button"
                    className={[
                      'invoice-detail-top__card',
                      'invoice-detail-top__card--purple',
                      invoice.ewayBill?.status === 'generated' || invoice.ewayBill?.ewaybillNumber
                        ? 'is-active'
                        : '',
                      ewayDocOpening ? 'is-disabled' : '',
                    ].filter(Boolean).join(' ')}
                    title="View or download e-way bill"
                    onClick={() => { void openPickupEwayBillDocument(); }}
                    disabled={ewayDocOpening}
                  >
                    <span className="invoice-detail-top__card-icon" aria-hidden>
                      <EwayBillIcon size={28} />
                    </span>
                    <span className="invoice-detail-top__card-label">E way bill</span>
                    <span className="invoice-detail-top__card-sub">
                      {ewayDocOpening
                        ? 'Opening…'
                        : (invoice.ewayBill?.ewaybillNumber
                          ? `EWB ${invoice.ewayBill.ewaybillNumber}`
                          : 'View or download e-way bill')}
                    </span>
                  </button>
                ) : null}
              </div>
              {ewayDocError ? (
                <p className="logistics-booking__docs-error" role="alert">{ewayDocError}</p>
              ) : null}
              {!existingBooking
                && courierEntry?.draftPatch?.partnerId === 'delhivery'
                && invoice
                && pinFromText(invoice.shippingAddress || invoice.billingAddress || '') ? (
                  <DelhiveryQuoteStrip
                    originPin={delhiveryOriginPin || null}
                    destinationPin={pinFromText(
                      invoice.shippingAddress || invoice.billingAddress || '',
                    )}
                    weightKg={5}
                    freightBillingMode="btc"
                    includeEstimate={Boolean(delhiveryOriginPin)}
                    compact
                  />
                ) : null}
            </div>
          )}
          <Outlet context={outletContext} />
          {orderListOpen && invoice ? (
            <SpareOrderListViewDialog
              invoice={invoice}
              booking={existingBooking}
              onClose={() => setOrderListOpen(false)}
            />
          ) : null}
          {invoice && user && addLrOpen ? (
            <InvoiceAddLrDialog
              open={addLrOpen}
              invoice={invoice}
              invoiceId={invoiceId}
              zohoCustomerId={customerId}
              partnerId={addLrPartnerId}
              allowPartnerPick={!addLrPartnerFromFreight}
              shipFromSite={addLrShipFrom}
              user={user}
              onClose={() => setAddLrOpen(false)}
              onCreated={booking => {
                setExistingBooking(booking);
                setCourierEntry(null);
                setAddLrAvailable(false);
              }}
            />
          ) : null}
          {invoice && pickupOpen ? (
            <InvoiceCustomerPickupDialog
              open={pickupOpen}
              invoice={invoice}
              customerId={customerId}
              invoiceId={invoiceId}
              shipFromSite={pickupShipFrom}
              shipFromLabel={pickupShipFromLabel}
              onClose={() => setPickupOpen(false)}
              onComplete={result => {
                setInvoice(prev => prev ? {
                  ...prev,
                  customerPickup: result.customerPickup,
                  ewayBill: result.eway?.status
                    ? {
                      ...(prev.ewayBill ?? {}),
                      status: result.eway.status,
                      ewaybillNumber: result.eway.ewaybillNumber ?? prev.ewayBill?.ewaybillNumber ?? null,
                      required: result.ewayRequired,
                    }
                    : prev.ewayBill,
                } : prev);
                setCourierEntry(null);
                setAddLrAvailable(false);
              }}
            />
          ) : null}
          {ewayDocDialog ? (
            <DelhiveryDocumentDialog
              payload={ewayDocDialog}
              onClose={() => {
                setEwayDocDialog(null);
                setEwayDocError('');
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
};
