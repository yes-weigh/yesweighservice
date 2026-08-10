import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Barcode,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  MapPin,
  MessageSquareWarning,
  Package,
  SquareArrowOutUpRight,
  Trash2,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { cancelDelhiveryShipment, createDelhiveryPickupRequest } from '../../lib/delhiveryB2b';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { formatCurrency } from '../../lib/catalog';
import {
  LOGISTICS_BOOKING_STATUSES,
  LOGISTICS_PIPELINE_STATUSES,
  boxChargeableWeight,
  boxDimensionsLabel,
  bookingStatusIndex,
  bookingSummaryLines,
  chargeableWeight,
  courierSlipFileName,
  isIncompleteLogisticsBooking,
  missingFinalPackagePhoto,
  shipmentModeLabel,
  shippingLabelFileName,
} from '../../lib/logisticsBooking';
import {
  canDeleteLogisticsBooking,
  cancelLogisticsBooking,
  fetchLogisticsBooking,
  generateLogisticsDocument,
  hydrateLogisticsBookingPhotos,
  updateLogisticsBookingDelhiveryIds,
  updateLogisticsBookingDelhiveryPickup,
  updateLogisticsBookingFreightBillingMode,
  updateLogisticsBookingShipFrom,
  uploadLogisticsBookingFinalPackagePhoto,
} from '../../lib/logisticsBookings';
import {
  formatFreightDiffLabel,
  loadLogisticsFreightCompare,
  type LogisticsFreightCompare,
} from '../../lib/logisticsFreightCompare';
import {
  fetchInvoiceBranchShipFrom,
  shipFromSiteLabel,
  type InvoiceBranchShipFrom,
} from '../../lib/logisticsShipFrom';
import { isPlaceholderLogisticsAddress } from '../../lib/logisticsDealers';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import { shippingLabelAddressGate } from '../../lib/shippingLabel';
import { homePathForRole } from '../../types';
import type {
  LogisticsBooking,
  LogisticsBookingStatus,
  LogisticsCourierFreight,
  LogisticsDocumentType,
} from '../../types/logistics-dispatch';
import { STAFF_LOGISTICS_SITE_LABELS } from '../../types/staff-logistics';
import {
  buildCourierSlipFromBooking,
  buildCourierSlipShareBlob,
} from '../../lib/courierSlipImage';
import { CourierSlipViewDialog } from './CourierSlipViewDialog';
import {
  DelhiveryDocumentDialog,
  type DelhiveryDocumentDialogPayload,
} from './DelhiveryDocumentDialog';
import { PhotoLightbox } from './PhotoLightbox';
import { RaiseLogisticsIssueDialog } from './RaiseLogisticsIssueDialog';
import { ShippingLabelPrintDialog } from './ShippingLabelPrintDialog';
import {
  bookingDateFromTrackBookedAt,
  fetchDelhiveryShipmentTrack,
  inferDelhiveryUiStatus,
  isDelhiveryB2bLrn,
  resolveDelhiveryBookingIds,
} from '../../lib/delhiveryTrack';
import {
  delhiveryBase64ToObjectUrl,
  delhiveryBase64ToUint8Array,
  fetchDelhiveryDocumentImage,
  fetchDelhiveryLrCopy,
  fetchDelhiveryPod,
  fetchDelhiveryShippingLabels,
  listDelhiveryBookingDocuments,
  type DelhiveryBookingDocument,
} from '../../lib/delhiveryDocuments';
import { composeDelhiveryBookingSlipPdf } from '../../lib/delhiveryLrCopyPdf';
import {
  downloadAdminInvoiceDocument,
  downloadDealerInvoiceDocument,
  invoiceDocumentToBlob,
} from '../../lib/invoices';
import { ensureInvoiceEwayBill, cancelInvoiceEwayBill } from '../../lib/invoiceEwayBill';
import { isEwayBillRequired, type EwayBillCancelReason } from '../../constants/ewayBill';
import { EwayBillCancelDialog } from './EwayBillCancelDialog';
import { base64ToUint8Array } from '../../lib/pdfViewer';
import { EwayBillIcon } from './EwayBillIcon';
import { StCourierTrackPanel } from './StCourierTrackPanel';

type DelhiveryDocCardTone = 'slip' | 'label' | 'pod' | 'invoice' | 'eway' | 'default';

type LogisticsDocCard = {
  id: string;
  kind: string;
  label?: string;
  note?: string;
  urls?: string[];
  enabled: boolean;
  disabledReason?: string | null;
};

type DocCardIcon = React.FC<{ size?: number; strokeWidth?: number; className?: string }>;

function delhiveryDocCardMeta(kind: string): {
  tone: DelhiveryDocCardTone;
  title: string;
  subtitle: string;
  Icon: DocCardIcon | LucideIcon;
} {
  if (kind === 'lr_copy') {
    return {
      tone: 'slip',
      title: 'Waybill',
      subtitle: 'View or download waybill',
      Icon: FileText,
    };
  }
  if (kind === 'shipping_label') {
    return {
      tone: 'label',
      title: 'Shipping label',
      subtitle: 'View or download shipping label',
      Icon: Barcode,
    };
  }
  if (kind === 'invoice') {
    return {
      tone: 'invoice',
      title: 'Invoice',
      subtitle: 'Download or share invoice PDF',
      Icon: IndianRupee,
    };
  }
  if (kind === 'eway_bill') {
    return {
      tone: 'eway',
      title: 'E way bill',
      subtitle: 'View or download e-way bill',
      Icon: EwayBillIcon,
    };
  }
  if (kind === 'pod') {
    return {
      tone: 'pod',
      title: 'POD',
      subtitle: 'View proof of delivery (POD)',
      Icon: ClipboardCheck,
    };
  }
  return {
    tone: 'default',
    title: kind === 'cod' ? 'COD document' : 'Document',
    subtitle: 'View Delhivery document',
    Icon: FileText,
  };
}

/** Prefer pre-tax freight; never surface GST in ops freight views. */
function delhiveryFreightExclGst(freight: LogisticsCourierFreight): number | null {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const preTax = freight.breakup?.preTaxFreight;
  if (typeof preTax === 'number' && Number.isFinite(preTax)) return round2(preTax);
  if (
    typeof freight.totalInr === 'number'
    && Number.isFinite(freight.totalInr)
    && typeof freight.breakup?.gst === 'number'
    && Number.isFinite(freight.breakup.gst)
  ) {
    return round2(freight.totalInr - freight.breakup.gst);
  }
  return typeof freight.totalInr === 'number' && Number.isFinite(freight.totalInr)
    ? round2(freight.totalInr)
    : null;
}

function delhiveryFreightBreakupRows(
  freight: LogisticsCourierFreight,
): Array<{ label: string; value: string; emphasize?: boolean }> {
  const rows: Array<{ label: string; value: string; emphasize?: boolean }> = [];
  if (freight.lrn) rows.push({ label: 'LRN', value: freight.lrn });
  if (freight.chargedWeightKg != null && freight.chargedWeightKg !== 0) {
    rows.push({ label: 'Charged weight', value: `${freight.chargedWeightKg.toFixed(2)} kg` });
  }
  if (freight.minChargedWeightKg != null && freight.minChargedWeightKg !== 0) {
    rows.push({ label: 'Min charged weight', value: `${freight.minChargedWeightKg.toFixed(2)} kg` });
  }
  const breakup = freight.breakup;
  if (breakup) {
    const money = (amount: number | null | undefined, label: string) => {
      if (amount == null || !Number.isFinite(amount) || amount === 0) return;
      rows.push({ label, value: formatCurrency(amount) });
    };
    money(breakup.baseFreightCharge, 'Base freight');
    money(breakup.fuelSurcharge, 'Fuel surcharge');
    money(breakup.fuelHike, 'Fuel hike');
    money(breakup.insuranceRov, 'Insurance / ROV');
    money(breakup.odaFm, 'ODA (first mile)');
    money(breakup.odaLm, 'ODA (last mile)');
    money(breakup.fm, 'First mile');
    money(breakup.lm, 'Last mile');
    money(breakup.green, 'Green');
    money(breakup.otherHandlingCharges, 'Other handling');
    money(breakup.markup, 'Markup');
  }
  const exclGst = delhiveryFreightExclGst(freight);
  if (exclGst != null) {
    rows.push({ label: 'Freight (excl. GST)', value: formatCurrency(exclGst), emphasize: true });
  }
  if (freight.fetchedAt) {
    const parsed = Date.parse(freight.fetchedAt);
    rows.push({
      label: 'Fetched',
      value: Number.isNaN(parsed)
        ? freight.fetchedAt
        : new Date(parsed).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    });
  }
  return rows;
}

interface LogisticsBookingDetailProps {
  booking: LogisticsBooking;
  isOps?: boolean;
  onUpdate: (booking: LogisticsBooking) => void;
  onAdvanceStatus?: (status: LogisticsBookingStatus) => void;
  onCancel?: () => void;
  onReturn?: () => void;
  onDelete?: () => void;
}

const PROGRESS_STATUSES = LOGISTICS_PIPELINE_STATUSES;

function bookingNeedsPhotoHydration(booking: LogisticsBooking): boolean {
  const missingBoxUrl = booking.boxes.some(box =>
    box.photos.some(photo => Boolean(photo.storagePath?.trim()) && !photo.url?.trim()),
  );
  const missingFinal = Boolean(
    booking.finalPackagePhotoStoragePath?.trim() && !booking.finalPackagePhoto?.trim(),
  );
  return missingBoxUrl || missingFinal;
}

function bookingHasPhotos(booking: LogisticsBooking): boolean {
  return booking.boxes.some(box => box.photos.some(photo =>
    Boolean(photo.url?.trim() || photo.storagePath?.trim()),
  )) || Boolean(booking.finalPackagePhoto?.trim() || booking.finalPackagePhotoStoragePath?.trim());
}

export const LogisticsBookingDetail: React.FC<LogisticsBookingDetailProps> = ({
  booking,
  isOps = false,
  onUpdate,
  onAdvanceStatus,
  onCancel,
  onReturn,
  onDelete,
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const finalPhotoInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState<LogisticsDocumentType | null>(null);
  const [shippingLabelOpen, setShippingLabelOpen] = useState(false);
  /** Prefer corrected booking immediately after ship-from fix (before parent re-render). */
  const [shippingLabelBooking, setShippingLabelBooking] = useState<LogisticsBooking | null>(null);
  const [courierSlipOpen, setCourierSlipOpen] = useState(false);
  const [downloadingSlip, setDownloadingSlip] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [uploadingFinalPhoto, setUploadingFinalPhoto] = useState(false);
  const [freightCompare, setFreightCompare] = useState<LogisticsFreightCompare | null>(null);
  const [freightLoading, setFreightLoading] = useState(false);
  const [invoiceBranch, setInvoiceBranch] = useState<InvoiceBranchShipFrom | null>(null);
  const [updatingShipFrom, setUpdatingShipFrom] = useState(false);
  const [delhiveryLrnDraft, setDelhiveryLrnDraft] = useState('');
  const [delhiveryMwbDraft, setDelhiveryMwbDraft] = useState('');
  const [savingDelhiveryIds, setSavingDelhiveryIds] = useState(false);
  const [delhiveryIdsError, setDelhiveryIdsError] = useState('');
  const [savingBillingMode, setSavingBillingMode] = useState(false);
  const [raiseIssueOpen, setRaiseIssueOpen] = useState(false);
  const [delhiveryDocs, setDelhiveryDocs] = useState<DelhiveryBookingDocument[]>([]);
  const [delhiveryDocsLoading, setDelhiveryDocsLoading] = useState(false);
  const [delhiveryDocsError, setDelhiveryDocsError] = useState('');
  const [delhiveryDocOpening, setDelhiveryDocOpening] = useState<string | null>(null);
  const [delhiveryDocDialog, setDelhiveryDocDialog] = useState<DelhiveryDocumentDialogPayload | null>(null);
  const delhiveryDocObjectUrlsRef = React.useRef<string[]>([]);
  const [ewayBillStatus, setEwayBillStatus] = useState<string | null>(booking.ewayBillStatus ?? null);
  const [ewayBillNumber, setEwayBillNumber] = useState<string | null>(booking.ewayBillNumber ?? null);
  const [ewayEnsuring, setEwayEnsuring] = useState(false);
  const [ewayCancelOpen, setEwayCancelOpen] = useState(false);
  const [ewayCancelling, setEwayCancelling] = useState(false);
  const [ewayCancelError, setEwayCancelError] = useState('');
  const [cancellingDelhivery, setCancellingDelhivery] = useState(false);
  const [cancelDelhiveryError, setCancelDelhiveryError] = useState('');
  const [requestingPickup, setRequestingPickup] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
  const isEnvelope = booking.shipmentMode === 'envelope';
  const needsOuterPhoto = missingFinalPackagePhoto(booking);
  const galleryUrls = useMemo(() => {
    const urls = booking.boxes.flatMap(box =>
      box.photos
        .map(photo => photo.url?.trim())
        .filter((url): url is string => Boolean(url)),
    );
    const finalUrl = booking.finalPackagePhoto?.trim();
    if (finalUrl) urls.push(finalUrl);
    return urls;
  }, [booking.boxes, booking.finalPackagePhoto]);
  const currentIndex = isIncompleteLogisticsBooking(booking)
    ? -1
    : bookingStatusIndex(booking.status);
  // Advance only along the public pipeline (Booked → Transit → Delivered).
  const nextStatus = (
    isIncompleteLogisticsBooking(booking)
    || booking.status === 'returned'
    || booking.status === 'cancelled'
    || booking.status === 'delivered'
    || (booking.status === 'label_generated' && !booking.shippingLabelGenerated)
  )
    ? null
    : PROGRESS_STATUSES[currentIndex + 1]?.id ?? null;
  const basePath = user ? homePathForRole(user.role) : '/dealer';
  // Delhivery: show/fetch with LRN first; MWB stays on booking for Express track fallback.
  const trackAwb = (
    booking.partnerId === 'delhivery'
      ? (booking.consignmentNo || booking.trackingNo || '')
      : (booking.trackingNo || booking.consignmentNo || '')
  ).trim();
  const trackUrl = logisticsTrackingUrl(booking.partnerId, trackAwb);
  const isStCourier = booking.partnerId === 'st_courier';
  const isTrackon = (
    booking.partnerId === 'trackon_air'
    || booking.partnerId === 'trackon_surface'
  );
  const isDelhivery = booking.partnerId === 'delhivery';
  const delhiveryIds = useMemo(
    () => (isDelhivery ? resolveDelhiveryBookingIds(booking) : null),
    [booking, isDelhivery],
  );
  const hasLinkedInvoice = Boolean(booking.invoiceId?.trim());
  const invoiceTotalForEway = Number(booking.invoiceValueInr ?? 0);
  const ewayRequired = hasLinkedInvoice && isEwayBillRequired(invoiceTotalForEway);
  const ewayCustomerId = booking.dealer.zohoCustomerId?.trim() || '';
  const ewayLrNumber = (delhiveryIds?.lrn || booking.consignmentNo || '').trim();
  const needsDelhiveryIds = Boolean(
    isDelhivery
    && isOps
    && delhiveryIds
    && (delhiveryIds.missingLrn || delhiveryIds.missingMasterAwb),
  );
  const showInAppTrack = (isStCourier || isTrackon || isDelhivery) && Boolean(trackAwb);

  useEffect(() => {
    if (!delhiveryIds) return;
    setDelhiveryLrnDraft(delhiveryIds.lrn || '');
    setDelhiveryMwbDraft(delhiveryIds.masterAwb || '');
    setDelhiveryIdsError('');
  }, [booking.id, delhiveryIds?.lrn, delhiveryIds?.masterAwb]);

  useEffect(() => {
    if (!isDelhivery) {
      setDelhiveryDocs([]);
      setDelhiveryDocsError('');
      return undefined;
    }
    const lrn = (delhiveryIds?.lrn || booking.consignmentNo || '').replace(/\D/g, '');
    if (!lrn) {
      setDelhiveryDocs([]);
      return undefined;
    }
    let cancelled = false;
    setDelhiveryDocsLoading(true);
    setDelhiveryDocsError('');
    void listDelhiveryBookingDocuments({ bookingId: booking.id, lrn })
      .then(result => {
        if (cancelled) return;
        setDelhiveryDocs(result.documents);
      })
      .catch(err => {
        if (cancelled) return;
        setDelhiveryDocs([]);
        setDelhiveryDocsError(
          err instanceof Error ? err.message : 'Could not load Delhivery documents.',
        );
      })
      .finally(() => {
        if (!cancelled) setDelhiveryDocsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isDelhivery,
    booking.id,
    booking.consignmentNo,
    booking.status,
    delhiveryIds?.lrn,
  ]);

  useEffect(() => {
    setEwayBillStatus(booking.ewayBillStatus ?? null);
    setEwayBillNumber(booking.ewayBillNumber ?? null);
  }, [booking.ewayBillNumber, booking.ewayBillStatus]);

  const ewayAutoEnsuredRef = useRef('');
  useEffect(() => {
    if (!ewayRequired || !hasLinkedInvoice || !ewayCustomerId) return;
    const autoKey = `${booking.id}:${booking.invoiceId}:${isOps}`;
    if (ewayAutoEnsuredRef.current === autoKey) return;
    ewayAutoEnsuredRef.current = autoKey;
    let cancelled = false;
    setEwayEnsuring(true);
    void ensureInvoiceEwayBill({
      customerId: ewayCustomerId,
      invoiceId: booking.invoiceId!.trim(),
      partnerId: booking.partnerId,
      lrNumber: ewayLrNumber || null,
      bookingId: booking.id,
      invoiceTotalInr: booking.invoiceValueInr ?? null,
      autoGenerate: isOps,
    })
      .then(result => {
        if (cancelled) return;
        setEwayBillStatus(result.status ?? null);
        setEwayBillNumber(result.ewaybillNumber ?? null);
      })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '';
        if (message) setDelhiveryDocsError(message);
      })
      .finally(() => {
        if (!cancelled) setEwayEnsuring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    booking.id,
    booking.invoiceId,
    booking.invoiceValueInr,
    booking.partnerId,
    ewayRequired,
    ewayCustomerId,
    ewayLrNumber,
    hasLinkedInvoice,
    isOps,
  ]);

  const openEwayBillDocument = useCallback(async () => {
    const invoiceId = booking.invoiceId?.trim();
    if (!invoiceId) {
      setDelhiveryDocsError('No invoice linked to this shipment.');
      return;
    }
    if (!ewayCustomerId) {
      setDelhiveryDocsError('Dealer is not linked to a Zoho customer.');
      return;
    }
    setDelhiveryDocOpening('eway_bill');
    setDelhiveryDocsError('');
    try {
      const result = await ensureInvoiceEwayBill({
        customerId: ewayCustomerId,
        invoiceId,
        partnerId: booking.partnerId,
        lrNumber: ewayLrNumber || null,
        bookingId: booking.id,
        invoiceTotalInr: booking.invoiceValueInr ?? null,
        autoGenerate: isOps,
      });
      setEwayBillStatus(result.status ?? null);
      setEwayBillNumber(result.ewaybillNumber ?? null);
      if (!result.required) {
        setDelhiveryDocsError(result.message || 'E-way bill is not required for this invoice.');
        return;
      }
      if (!result.contentBase64) {
        setDelhiveryDocsError(result.message || 'E-way bill is not ready yet.');
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
      setDelhiveryDocDialog({
        title: result.ewaybillNumber ? `E way bill ${result.ewaybillNumber}` : 'E way bill',
        contentType: mimeType,
        pdfBytes: bytes,
        fileName: result.filename || 'eway-bill.pdf',
        downloadBlob: blob,
        hideDownload: true,
        onCancel: isOps && result.status === 'generated'
          ? () => {
            setEwayCancelError('');
            setEwayCancelOpen(true);
          }
          : undefined,
        cancelLabel: 'Cancel e-way bill',
      });
    } catch (err) {
      setDelhiveryDocsError(
        err instanceof Error ? err.message : 'Could not open e-way bill.',
      );
    } finally {
      setDelhiveryDocOpening(null);
    }
  }, [
    booking.id,
    booking.invoiceId,
    booking.invoiceValueInr,
    booking.partnerId,
    ewayCustomerId,
    ewayLrNumber,
    isOps,
  ]);

  const sharedDocCards = useMemo((): LogisticsDocCard[] => {
    const cards: LogisticsDocCard[] = [];
    if (hasLinkedInvoice) {
      cards.push({
        id: 'invoice',
        kind: 'invoice',
        label: 'Invoice',
        enabled: true,
      });
    }
    if (ewayRequired) {
      const generated = ewayBillStatus === 'generated';
      const cancelled = ewayBillStatus === 'cancelled';
      cards.push({
        id: 'eway_bill',
        kind: 'eway_bill',
        label: 'E way bill',
        enabled: generated || isOps,
        disabledReason: generated || isOps
          ? null
          : cancelled
            ? 'E-way bill was cancelled.'
            : 'E-way bill is not generated yet.',
        note: cancelled
          ? (isOps ? 'Cancelled — tap to regenerate' : 'Cancelled')
          : (ewayBillNumber ? `EWB ${ewayBillNumber}` : undefined),
      });
    }
    return cards;
  }, [
    ewayBillNumber,
    ewayBillStatus,
    ewayRequired,
    hasLinkedInvoice,
    isOps,
  ]);

  /** Waybill + shipping label + invoice + E-way; POD/COD when available. */
  const delhiveryDocCards = useMemo((): LogisticsDocCard[] => {
    if (!isDelhivery) return sharedDocCards;
    const hasLrn = Boolean((delhiveryIds?.lrn || booking.consignmentNo || '').replace(/\D/g, ''));
    const byId = new Map(delhiveryDocs.map(doc => [doc.id, doc]));
    const cards: LogisticsDocCard[] = [
      {
        id: 'lr_copy',
        kind: 'lr_copy',
        label: 'Waybill',
        enabled: hasLrn,
        disabledReason: hasLrn ? null : 'Create or enter an LR number first.',
      },
      {
        id: 'shipping_label',
        kind: 'shipping_label',
        label: 'Shipping label',
        enabled: hasLrn,
        disabledReason: hasLrn ? null : 'Create or enter an LR number first.',
      },
      ...sharedDocCards,
    ];
    if (byId.has('pod')) {
      cards.push({
        id: 'pod',
        kind: 'pod',
        label: 'POD',
        urls: byId.get('pod')?.urls,
        enabled: true,
      });
    }
    for (const doc of delhiveryDocs) {
      if (doc.id === 'lr_copy' || doc.id === 'shipping_label' || doc.id === 'pod') continue;
      cards.push({
        id: doc.id,
        kind: doc.kind,
        label: doc.label,
        note: doc.note,
        urls: doc.urls,
        enabled: true,
      });
    }
    return cards;
  }, [
    isDelhivery,
    delhiveryDocs,
    delhiveryIds?.lrn,
    booking.consignmentNo,
    sharedDocCards,
  ]);

  const markDocumentGenerated = useCallback(async (document: LogisticsDocumentType) => {
    if (!user || !isOps) return;
    setGenerating(document);
    try {
      const updated = await generateLogisticsDocument(booking, document, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update document status.');
    } finally {
      setGenerating(null);
    }
  }, [booking, isOps, onUpdate, user]);

  const closeDelhiveryDocDialog = useCallback(() => {
    for (const url of delhiveryDocObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    delhiveryDocObjectUrlsRef.current = [];
    setDelhiveryDocDialog(null);
  }, []);

  const handleConfirmCancelEwayBill = useCallback(async (input: {
    reason: EwayBillCancelReason;
    remarks: string;
  }) => {
    const invoiceId = booking.invoiceId?.trim();
    if (!invoiceId || !ewayCustomerId) return;
    setEwayCancelling(true);
    setEwayCancelError('');
    try {
      const result = await cancelInvoiceEwayBill({
        customerId: ewayCustomerId,
        invoiceId,
        bookingId: booking.id,
        reason: input.reason,
        remarks: input.remarks || null,
      });
      setEwayBillStatus(result.status ?? 'cancelled');
      setEwayBillNumber(null);
      ewayAutoEnsuredRef.current = '';
      setEwayCancelOpen(false);
      closeDelhiveryDocDialog();
      setDelhiveryDocsError('');
    } catch (err) {
      setEwayCancelError(
        err instanceof Error ? err.message : 'Could not cancel e-way bill.',
      );
    } finally {
      setEwayCancelling(false);
    }
  }, [
    booking.id,
    booking.invoiceId,
    closeDelhiveryDocDialog,
    ewayCustomerId,
  ]);

  const openLinkedInvoiceDocument = useCallback(async () => {
    const invoiceId = booking.invoiceId?.trim();
    if (!invoiceId) {
      setDelhiveryDocsError('No invoice linked to this shipment.');
      return;
    }
    const customerId = booking.dealer.zohoCustomerId?.trim() || '';
    setDelhiveryDocOpening('invoice');
    setDelhiveryDocsError('');
    try {
      const doc = isOps && customerId
        ? await downloadAdminInvoiceDocument(customerId, invoiceId, 'invoice')
        : await downloadDealerInvoiceDocument(invoiceId, 'invoice');
      const bytes = base64ToUint8Array(doc.contentBase64);
      const blob = invoiceDocumentToBlob(doc);
      setDelhiveryDocDialog({
        title: 'Invoice',
        contentType: doc.mimeType || 'application/pdf',
        pdfBytes: bytes,
        fileName: doc.filename || `${booking.invoiceNumber || invoiceId}.pdf`,
        downloadBlob: blob,
      });
    } catch (err) {
      setDelhiveryDocsError(
        err instanceof Error ? err.message : 'Could not open invoice PDF.',
      );
    } finally {
      setDelhiveryDocOpening(null);
    }
  }, [
    booking.dealer.zohoCustomerId,
    booking.invoiceId,
    booking.invoiceNumber,
    isOps,
  ]);

  const openDelhiveryDocument = useCallback(async (doc: Pick<DelhiveryBookingDocument, 'id' | 'kind' | 'label' | 'urls'>) => {
    const lrn = (delhiveryIds?.lrn || booking.consignmentNo || '').replace(/\D/g, '');
    if (!lrn) return;
    const bookingId = booking.id;
    const card = delhiveryDocCardMeta(doc.kind);
    setDelhiveryDocOpening(doc.id);
    setDelhiveryDocsError('');
    try {
      if (doc.kind === 'lr_copy') {
        const copy = await fetchDelhiveryLrCopy(lrn, 'all', bookingId);
        if (!copy.available || !copy.base64) {
          setDelhiveryDocsError(copy.error || 'Waybill is not available yet.');
          return;
        }
        const rawBytes = delhiveryBase64ToUint8Array(copy.base64);
        let bytes = rawBytes;
        try {
          bytes = await composeDelhiveryBookingSlipPdf(rawBytes);
        } catch {
          // Fall back to the original Delhivery PDF if compose fails.
          bytes = rawBytes;
        }
        const blob = new Blob([Uint8Array.from(bytes)], {
          type: copy.contentType || 'application/pdf',
        });
        setDelhiveryDocDialog({
          title: card.title,
          contentType: copy.contentType || 'application/pdf',
          pdfBytes: bytes,
          fileName: copy.fileName || `${lrn}-waybill.pdf`,
          downloadBlob: blob,
        });
        return;
      }
      if (doc.kind === 'shipping_label') {
        const labels = await fetchDelhiveryShippingLabels(lrn, 'a4', bookingId);
        if (!labels.available || !labels.images.length) {
          setDelhiveryDocsError(labels.error || 'Shipping label is not available yet.');
          return;
        }
        const objectUrls: string[] = [];
        const urls = labels.images.map(image => {
          if (image.url) return image.url;
          if (!image.base64) return '';
          const objectUrl = delhiveryBase64ToObjectUrl(
            image.base64,
            image.contentType || 'image/png',
          );
          objectUrls.push(objectUrl);
          return objectUrl;
        }).filter(Boolean);
        delhiveryDocObjectUrlsRef.current = objectUrls;
        const first = labels.images[0];
        const firstBytes = first?.base64 ? delhiveryBase64ToUint8Array(first.base64) : null;
        setDelhiveryDocDialog({
          title: card.title,
          contentType: first?.contentType || 'image/png',
          imageUrls: urls,
          fileName: first?.fileName || `${lrn}-shipping-label.png`,
          layout: 'shipping_label',
          downloadBlob: firstBytes
            ? new Blob([Uint8Array.from(firstBytes)], {
              type: first?.contentType || 'image/png',
            })
            : null,
        });
        return;
      }
      if (doc.kind === 'pod') {
        const fresh = await fetchDelhiveryPod({ lrn, bookingId });
        const urls = fresh.urls.length ? fresh.urls : (doc.urls || []);
        if (!urls.length) {
          setDelhiveryDocsError(fresh.error || 'POD is not available yet for this shipment.');
          return;
        }
        setDelhiveryDocDialog({
          title: card.title,
          contentType: 'image/jpeg',
          imageUrls: urls,
          fileName: `${lrn}-pod.jpg`,
        });
        return;
      }
      if (doc.kind === 'cod') {
        const image = await fetchDelhiveryDocumentImage(lrn, 'COD', bookingId);
        if (!image.available || (!image.base64 && !image.url)) {
          setDelhiveryDocsError(image.error || 'COD document is not available for this shipment.');
          return;
        }
        const contentType = image.contentType || 'image/jpeg';
        if (image.url) {
          setDelhiveryDocDialog({
            title: card.title,
            contentType,
            imageUrls: [image.url],
            fileName: `${lrn}-cod.jpg`,
          });
          return;
        }
        const bytes = delhiveryBase64ToUint8Array(image.base64!);
        const url = delhiveryBase64ToObjectUrl(image.base64!, contentType);
        delhiveryDocObjectUrlsRef.current = [url];
        setDelhiveryDocDialog({
          title: card.title,
          contentType,
          imageUrls: [url],
          fileName: `${lrn}-cod.jpg`,
          downloadBlob: new Blob([Uint8Array.from(bytes)], { type: contentType }),
        });
      }
    } catch (err) {
      setDelhiveryDocsError(
        err instanceof Error ? err.message : 'Could not open Delhivery document.',
      );
    } finally {
      setDelhiveryDocOpening(null);
    }
  }, [booking.consignmentNo, booking.id, delhiveryIds?.lrn]);

  const openLogisticsDocCard = useCallback((card: LogisticsDocCard) => {
    if (!card.enabled) {
      if (card.disabledReason) setDelhiveryDocsError(card.disabledReason);
      return;
    }
    if (card.kind === 'invoice') {
      void openLinkedInvoiceDocument();
      return;
    }
    if (card.kind === 'eway_bill') {
      void openEwayBillDocument();
      return;
    }
    void openDelhiveryDocument({
      id: card.id,
      kind: card.kind,
      label: card.label || card.kind,
      urls: card.urls,
    });
  }, [openDelhiveryDocument, openEwayBillDocument, openLinkedInvoiceDocument]);

  const handleCourierSlipViewed = useCallback(() => {
    if (!isOps || booking.courierSlipGenerated) return;
    void markDocumentGenerated('courier_slip');
  }, [booking.courierSlipGenerated, isOps, markDocumentGenerated]);

  const handleDownloadCourierSlip = useCallback(async () => {
    setDownloadingSlip(true);
    try {
      const slip = buildCourierSlipFromBooking(booking);
      const { blob, fileName } = await buildCourierSlipShareBlob(slip);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      handleCourierSlipViewed();
    } catch (err) {
      console.error(err);
    } finally {
      setDownloadingSlip(false);
    }
  }, [booking, handleCourierSlipViewed]);

  const handleShippingLabelPrinted = useCallback(() => {
    if (!isOps) return;
    void markDocumentGenerated('shipping_label');
  }, [isOps, markDocumentGenerated]);

  const needsPhotoHydration = bookingNeedsPhotoHydration(booking);

  useEffect(() => {
    if (!needsPhotoHydration) return;
    let cancelled = false;
    setPhotosLoading(true);
    void hydrateLogisticsBookingPhotos(booking)
      .then(hydrated => {
        if (cancelled) return;
        // Avoid update loops when resolution fails (URLs still missing).
        if (bookingNeedsPhotoHydration(hydrated)) return;
        onUpdate(hydrated);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });
    return () => { cancelled = true; };
    // Re-run when list refresh wipes URLs (needsPhotoHydration flips back to true).
  }, [booking, needsPhotoHydration, onUpdate]);

  const openPreview = useCallback((url: string) => {
    const index = galleryUrls.indexOf(url);
    if (index >= 0) setPreviewIndex(index);
  }, [galleryUrls]);

  const handleFinalPhotoSelected = useCallback(async (file: File | undefined) => {
    if (!file || !user || !isOps) return;
    setUploadingFinalPhoto(true);
    try {
      const updated = await uploadLogisticsBookingFinalPackagePhoto(booking, file, user);
      onUpdate(updated);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not upload outer package photo.');
    } finally {
      setUploadingFinalPhoto(false);
    }
  }, [booking, isOps, onUpdate, user]);

  const handleCancelDelhiveryLr = useCallback(async () => {
    if (!user || !isOps || booking.partnerId !== 'delhivery') return;
    const lrn = (delhiveryIds?.lrn || booking.consignmentNo || '').replace(/\D/g, '');
    if (!isDelhiveryB2bLrn(lrn)) {
      setCancelDelhiveryError('A 9-digit Delhivery LRN is required to cancel on Delhivery.');
      return;
    }
    const ok = await confirm({
      title: 'Cancel LR on Delhivery',
      message:
        `Cancel LR ${lrn} on Delhivery? This voids the shipment with Delhivery `
        + '(allowed while Manifested / Pending / Open / Scheduled / In Transit). '
        + 'This booking will also be marked cancelled here.',
      confirmLabel: 'Cancel on Delhivery',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;
    setCancellingDelhivery(true);
    setCancelDelhiveryError('');
    try {
      await cancelDelhiveryShipment(lrn);
      const updated = await cancelLogisticsBooking(booking, user);
      onUpdate(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not cancel Delhivery LR.';
      // If Delhivery already cancelled it, still close locally.
      if (/already\s*cancel|cancelled|canceled/i.test(message)) {
        try {
          const updated = await cancelLogisticsBooking(booking, user);
          onUpdate(updated);
          return;
        } catch {
          // fall through
        }
      }
      setCancelDelhiveryError(message);
    } finally {
      setCancellingDelhivery(false);
    }
  }, [
    booking,
    confirm,
    delhiveryIds?.lrn,
    isOps,
    onUpdate,
    user,
  ]);

  const handleRequestDelhiveryPickup = useCallback(async () => {
    if (!user || !isOps || booking.partnerId !== 'delhivery') return;
    setRequestingPickup(true);
    setPickupError('');
    try {
      const result = await createDelhiveryPickupRequest({
        shipFromSite: booking.shipFromSite,
        expectedPackageCount: Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1),
      });
      const updated = await updateLogisticsBookingDelhiveryPickup(
        booking,
        {
          ok: result.ok === true,
          alreadyExisted: result.alreadyExisted === true,
          pickupId: result.pickupId?.trim() || null,
          pickupLocationName: result.pickupLocationName ?? null,
          pickupDate: result.pickupDate ?? null,
          pickupTime: result.pickupTime ?? null,
          expectedPackageCount: result.expectedPackageCount ?? null,
          message: result.message ?? null,
          requestedAt: result.requestedAt || new Date().toISOString(),
        },
        user,
      );
      onUpdate(updated);
    } catch (err) {
      setPickupError(err instanceof Error ? err.message : 'Could not create pickup request.');
    } finally {
      setRequestingPickup(false);
    }
  }, [booking, isOps, onUpdate, user]);

  const handleSaveDelhiveryIdsAndRefresh = useCallback(async () => {
    if (!user || !isOps || booking.partnerId !== 'delhivery') return;
    const current = resolveDelhiveryBookingIds(booking);
    setSavingDelhiveryIds(true);
    setDelhiveryIdsError('');
    try {
      const updated = await updateLogisticsBookingDelhiveryIds(
        booking,
        {
          lrn: current.missingLrn ? delhiveryLrnDraft : current.lrn,
          masterAwb: current.missingMasterAwb ? delhiveryMwbDraft : current.masterAwb,
        },
        user,
      );
      onUpdate(updated);
      const ids = resolveDelhiveryBookingIds(updated);
      const fetchId = ids.lrn || ids.masterAwb || updated.consignmentNo;
      if (fetchId) {
        await fetchDelhiveryShipmentTrack(fetchId, { bookingId: updated.id });
      }
      const fresh = await fetchLogisticsBooking(updated.id);
      if (fresh) onUpdate(fresh);
    } catch (err) {
      setDelhiveryIdsError(
        err instanceof Error ? err.message : 'Could not save Delhivery IDs.',
      );
    } finally {
      setSavingDelhiveryIds(false);
    }
  }, [
    booking,
    delhiveryLrnDraft,
    delhiveryMwbDraft,
    isOps,
    onUpdate,
    user,
  ]);

  useEffect(() => {
    if (!booking.invoiceId?.trim()) {
      setFreightCompare(null);
      setFreightLoading(false);
      return;
    }
    let cancelled = false;
    setFreightLoading(true);
    void loadLogisticsFreightCompare(booking, { isOps })
      .then(result => {
        if (!cancelled) setFreightCompare(result);
      })
      .catch(() => {
        if (!cancelled) setFreightCompare(null);
      })
      .finally(() => {
        if (!cancelled) setFreightLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    booking.id,
    booking.invoiceId,
    booking.partnerId,
    booking.shipmentMode,
    booking.shipFromSite,
    booking.actualWeightKg,
    booking.volumetricWeightKg,
    booking.numberOfBoxes,
    booking.boxes,
    booking.deliveryAddress,
    booking.dealer.zohoCustomerId,
    isOps,
  ]);

  useEffect(() => {
    const invoiceId = booking.invoiceId?.trim() || '';
    const customerId = booking.dealer.zohoCustomerId?.trim() || '';
    if (!invoiceId || !customerId) {
      setInvoiceBranch(null);
      return;
    }
    let cancelled = false;
    void fetchInvoiceBranchShipFrom({ invoiceId, customerId, isOps })
      .then(branch => {
        if (!cancelled) setInvoiceBranch(branch);
      })
      .catch(() => {
        if (!cancelled) setInvoiceBranch(null);
      });
    return () => { cancelled = true; };
  }, [booking.invoiceId, booking.dealer.zohoCustomerId, isOps]);

  const shipFromMismatch = Boolean(
    isOps
    && invoiceBranch
    && booking.shipFromSite !== invoiceBranch.site
    && booking.status !== 'returned'
    && booking.status !== 'cancelled',
  );

  const handleFixShipFrom = useCallback(async () => {
    if (!user || !isOps || !invoiceBranch) return;
    setUpdatingShipFrom(true);
    try {
      const updated = await updateLogisticsBookingShipFrom(booking, invoiceBranch.site, user);
      onUpdate(updated);
      setShippingLabelBooking(updated);
      setShippingLabelOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update ship-from.');
    } finally {
      setUpdatingShipFrom(false);
    }
  }, [booking, invoiceBranch, isOps, onUpdate, user]);

  /** Pull Sites address onto this booking (settings save does not update existing shipments). */
  const handleApplyShipFromFromSites = useCallback(async (opts?: { openLabel?: boolean }) => {
    if (!user || !isOps) return false;
    setUpdatingShipFrom(true);
    try {
      const settings = await loadLogisticsSettings();
      const site = booking.shipFromSite;
      const address = settings.fromAddresses[site]?.trim() || '';
      if (isPlaceholderLogisticsAddress(address)) {
        window.alert(
          `No ship-from address saved for ${STAFF_LOGISTICS_SITE_LABELS[site] || site}. `
          + 'Set it under Admin → Logistics → Sites, save, then try again.',
        );
        return false;
      }
      const updated = await updateLogisticsBookingShipFrom(booking, site, user);
      onUpdate(updated);
      setShippingLabelBooking(updated);
      if (opts?.openLabel) {
        const gate = shippingLabelAddressGate(updated);
        if (!gate.message) setShippingLabelOpen(true);
      }
      return true;
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not update ship-from.');
      return false;
    } finally {
      setUpdatingShipFrom(false);
    }
  }, [booking, isOps, onUpdate, user]);

  const shipFromAutoAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOps || !user) return;
    if (!isPlaceholderLogisticsAddress(booking.shipFromAddress)) return;
    if (shipFromAutoAppliedRef.current === booking.id) return;
    shipFromAutoAppliedRef.current = booking.id;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await loadLogisticsSettings();
        const address = settings.fromAddresses[booking.shipFromSite]?.trim() || '';
        if (cancelled || isPlaceholderLogisticsAddress(address)) return;
        const updated = await updateLogisticsBookingShipFrom(booking, booking.shipFromSite, user);
        if (!cancelled) {
          onUpdate(updated);
          setShippingLabelBooking(updated);
        }
      } catch {
        /* leave blocked UI; user can Apply manually */
      }
    })();
    return () => { cancelled = true; };
  }, [
    booking,
    booking.id,
    booking.shipFromAddress,
    booking.shipFromSite,
    isOps,
    onUpdate,
    user,
  ]);

  const shippingLabelGate = useMemo(() => shippingLabelAddressGate(booking), [booking]);
  const shippingLabelBlocked = Boolean(shippingLabelGate.message);

  const openShippingLabel = useCallback(() => {
    if (shippingLabelGate.message) {
      window.alert(shippingLabelGate.message);
      return;
    }
    setShippingLabelBooking(booking);
    setShippingLabelOpen(true);
  }, [booking, shippingLabelGate.message]);

  const productItems = freightCompare?.items.filter(
    item => !item.isFreight && !item.isStampingFee,
  ) ?? [];
  const freightItems = freightCompare?.items.filter(
    item => item.isFreight || item.isStampingFee,
  ) ?? [];

  return (
    <article className="logistics-booking panel glass">
      <header className="logistics-booking__header">
        <span className="logistics-booking__partner-logo-wrap" aria-hidden>
          {partner && (
            <img src={partner.image} alt="" className="logistics-booking__partner-logo" />
          )}
        </span>
        <div className="logistics-booking__header-copy">
          <h3>{logisticsPartnerLabel(booking.partnerId)}</h3>
          <p className="text-muted text-sm">
            {booking.orderRef} · {booking.trackingNo}
            {showInAppTrack && booking.courierTrack?.ok && booking.courierTrack.status
              ? ` · ${booking.courierTrack.status}`
              : ''}
          </p>
        </div>
        <div className="logistics-booking__header-actions">
          {!showInAppTrack && trackUrl && (
            <a
              href={trackUrl}
              target="_blank"
              rel="noreferrer"
              className="logistics-booking__track-btn"
              aria-label="Track shipment"
              title="Track shipment"
            >
              <SquareArrowOutUpRight size={16} aria-hidden />
            </a>
          )}
          <span className={`logistics-booking__status logistics-booking__status--${
            isIncompleteLogisticsBooking(booking) ? 'incomplete' : booking.status
          }`}
          >
            {isIncompleteLogisticsBooking(booking)
              ? 'Incomplete'
              : LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label}
          </span>
        </div>
      </header>

      {(booking.invoiceId || booking.supportRequestId) && (
        <section className="logistics-booking__links">
          {booking.invoiceId && booking.invoiceNumber && (
            <Link
              to={user?.role === 'super_admin'
                ? `/super-admin/invoices/${booking.dealer.zohoCustomerId}/${booking.invoiceId}/invoice`
                : `${basePath}/invoices/${booking.invoiceId}/invoice`}
              className="logistics-booking__source-link"
            >
              <ExternalLink size={14} aria-hidden />
              Invoice {booking.invoiceNumber}
            </Link>
          )}
          {booking.supportRequestId && booking.supportRequestNumber && (
            <Link
              to={`${basePath}/warranty-support/${booking.supportRequestId}`}
              className="logistics-booking__source-link"
            >
              <ExternalLink size={14} aria-hidden />
              Support {booking.supportRequestNumber}
            </Link>
          )}
        </section>
      )}

      {shipFromMismatch && invoiceBranch && (
        <div className="logistics-booking__ship-from-mismatch" role="alert">
          <AlertTriangle size={18} strokeWidth={2.25} aria-hidden />
          <div className="logistics-booking__ship-from-mismatch-copy">
            <strong>Ship-from differs from invoice branch</strong>
            <p>
              Current: {shipFromSiteLabel(booking.shipFromSite)}
              {booking.shipFromAddress?.trim()
                ? ` — ${booking.shipFromAddress.trim()}`
                : ''}
              . Invoice branch: {invoiceBranch.branchLabel}
              {invoiceBranch.salesOrderNumber
                ? ` (SO ${invoiceBranch.salesOrderNumber})`
                : ''}
              .
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={updatingShipFrom}
            onClick={() => void handleFixShipFrom()}
          >
            {updatingShipFrom
              ? 'Updating…'
              : `Update to ${STAFF_LOGISTICS_SITE_LABELS[invoiceBranch.site]}`}
          </button>
        </div>
      )}

      {needsDelhiveryIds && delhiveryIds && (
        <section
          className="logistics-booking__delhivery-ids"
          aria-label="Missing Delhivery identifiers"
        >
          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <Truck size={16} aria-hidden />
              Add missing Delhivery ID
            </h4>
            <p className="text-muted text-sm">
              LRN (9 digits) is required for freight.
              Master AWB is required for live tracking.
              Save, then Refresh pulls both.
            </p>
            <div className="logistics-booking__delhivery-ids-fields">
              {delhiveryIds.missingLrn && (
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>LRN</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={delhiveryLrnDraft}
                    onChange={e => setDelhiveryLrnDraft(e.target.value)}
                    placeholder="e.g. 298833418"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={savingDelhiveryIds}
                  />
                </label>
              )}
              {delhiveryIds.missingMasterAwb && (
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>Master AWB</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={delhiveryMwbDraft}
                    onChange={e => setDelhiveryMwbDraft(e.target.value)}
                    placeholder="e.g. 20560010118230"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={savingDelhiveryIds}
                  />
                </label>
              )}
            </div>
            {delhiveryIdsError ? (
              <p className="dealers-modal__error">{delhiveryIdsError}</p>
            ) : null}
            <div className="logistics-booking__delhivery-ids-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={
                  savingDelhiveryIds
                  || !(
                    (delhiveryIds.missingLrn && delhiveryLrnDraft.trim())
                    || (delhiveryIds.missingMasterAwb && delhiveryMwbDraft.trim())
                  )
                }
                onClick={() => void handleSaveDelhiveryIdsAndRefresh()}
              >
                {savingDelhiveryIds ? 'Saving…' : 'Save & refresh'}
              </button>
            </div>
          </div>
        </section>
      )}

      {showInAppTrack && (
        <StCourierTrackPanel
          awb={trackAwb}
          bookingId={booking.id}
          provider={isTrackon ? 'trackon' : isDelhivery ? 'delhivery' : 'st_courier'}
          shipFromSite={booking.shipFromSite}
          courierDeliveryOffice={isStCourier ? booking.courierDeliveryOffice : null}
          cachedTrack={booking.courierTrack}
          onTrackUpdated={(track) => {
            let nextStatus = booking.status;
            if (booking.status !== 'returned' && booking.status !== 'cancelled') {
              if (isDelhivery) {
                nextStatus = inferDelhiveryUiStatus(track, booking.status) as typeof booking.status;
              } else if (!track.ok) {
                nextStatus = 'label_generated';
              } else if (
                booking.status === 'label_generated'
                || Boolean(String(track.deliveredAt || '').trim())
                || /\bdelivered\b/i.test(track.status || '')
              ) {
                const delivered = Boolean(String(track.deliveredAt || '').trim())
                  || /\bdelivered\b/i.test(track.status || '');
                nextStatus = delivered ? 'delivered' : 'in_transit';
              }
            }
            const statusType = 'statusType' in track
              ? (track as { statusType?: string | null }).statusType
              : undefined;
            const nextBookingDate = track.ok
              ? bookingDateFromTrackBookedAt(track.bookedAt)
              : null;
            const optimistic: LogisticsBooking = {
              ...booking,
              status: nextStatus,
              ...(nextBookingDate && nextBookingDate !== booking.bookingDate
                ? { bookingDate: nextBookingDate }
                : {}),
              courierTrack: {
                awb: track.awb,
                ok: track.ok,
                error: track.error,
                status: track.status,
                ...(statusType != null ? { statusType: String(statusType) } : {}),
                origin: track.origin,
                destination: track.destination,
                consignmentType: track.consignmentType,
                bookedAt: track.bookedAt,
                deliveredAt: track.deliveredAt,
                history: track.history,
                sourceUrl: track.sourceUrl,
                fetchedAt: track.fetchedAt,
              },
              trackFetchedAt: track.fetchedAt,
            };
            onUpdate(optimistic);
            // Reload so Delhivery freight (and other server patches) appear after Refresh.
            void fetchLogisticsBooking(booking.id).then((fresh) => {
              if (fresh) onUpdate(fresh);
            });
          }}
        />
      )}

      {booking.invoiceId && (
        <section className="logistics-booking__invoice-freight" aria-label="Invoice and freight">
          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <FileText size={16} aria-hidden />
              Invoice &amp; items
              {freightCompare?.invoiceNumber
                ? ` · ${freightCompare.invoiceNumber}`
                : booking.invoiceNumber
                  ? ` · ${booking.invoiceNumber}`
                  : ''}
            </h4>
            {freightLoading && !freightCompare && (
              <p className="text-muted text-sm">Loading invoice details…</p>
            )}
            {!freightLoading && !freightCompare?.items.length && (
              <p className="text-muted text-sm">Invoice line items unavailable.</p>
            )}
            {productItems.length > 0 && (
              <ul className="logistics-booking__invoice-items">
                {productItems.map(item => (
                  <li key={item.id}>
                    <span className="logistics-booking__invoice-item-thumb" aria-hidden>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : (
                        <Package size={18} strokeWidth={1.5} />
                      )}
                    </span>
                    <div className="logistics-booking__invoice-item-main">
                      <strong>{item.name}</strong>
                      {item.sku && <span className="text-muted">{item.sku}</span>}
                      {item.stampingLabel && (
                        <span
                          className={[
                            'logistics-booking__invoice-item-stamp',
                            item.hasStamping === true
                              ? 'is-stamped'
                              : item.hasStamping === false
                                ? 'is-plain'
                                : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {item.stampingLabel}
                        </span>
                      )}
                      {item.serialNumbers.length > 0 && (
                        <span className="logistics-booking__invoice-item-serials">
                          S/N {item.serialNumbers.join(', ')}
                        </span>
                      )}
                      {item.description && (
                        <span className="logistics-booking__invoice-item-desc">
                          {item.description}
                        </span>
                      )}
                    </div>
                    <div className="logistics-booking__invoice-item-meta">
                      <span>Qty {item.quantity}</span>
                      <span>{formatCurrency(item.total)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {freightItems.length > 0 && (
              <ul className="logistics-booking__invoice-items logistics-booking__invoice-items--freight">
                {freightItems.map(item => (
                  <li key={item.id}>
                    <span className="logistics-booking__invoice-item-thumb" aria-hidden>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : (
                        <Truck size={18} strokeWidth={1.5} />
                      )}
                    </span>
                    <div className="logistics-booking__invoice-item-main">
                      <strong>{item.name}</strong>
                      {item.sku && <span className="text-muted">{item.sku}</span>}
                    </div>
                    <div className="logistics-booking__invoice-item-meta">
                      <span>{item.isStampingFee ? 'Stamping' : 'Freight line'}</span>
                      <span>{formatCurrency(item.total)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <IndianRupee size={16} aria-hidden />
              Freight compare
            </h4>
            {booking.partnerId === 'delhivery' && isOps && user ? (
              <div className="logistics-booking__billing-mode">
                <span className="text-muted text-sm">
                  Freight billing
                  {booking.freightBillingModeSource
                    ? ` · ${booking.freightBillingModeSource}`
                    : ''}
                  {freightCompare?.billingModeLocked ? ' · locked (invoice paid)' : ''}
                </span>
                <div className="logistics-booking__billing-mode-actions">
                  <button
                    type="button"
                    className={[
                      'btn btn-secondary',
                      (freightCompare?.freightBillingMode || booking.freightBillingMode) === 'btc'
                        ? 'is-active'
                        : '',
                    ].filter(Boolean).join(' ')}
                    disabled={savingBillingMode || Boolean(freightCompare?.billingModeLocked)}
                    onClick={() => {
                      setSavingBillingMode(true);
                      void updateLogisticsBookingFreightBillingMode(booking, 'btc', user)
                        .then(next => onUpdate(next))
                        .finally(() => setSavingBillingMode(false));
                    }}
                  >
                    BTC
                  </button>
                  <button
                    type="button"
                    className={[
                      'btn btn-secondary',
                      (freightCompare?.freightBillingMode || booking.freightBillingMode) === 'fod'
                        ? 'is-active'
                        : '',
                    ].filter(Boolean).join(' ')}
                    disabled={savingBillingMode || Boolean(freightCompare?.billingModeLocked)}
                    onClick={() => {
                      setSavingBillingMode(true);
                      void updateLogisticsBookingFreightBillingMode(booking, 'fod', user)
                        .then(next => onUpdate(next))
                        .finally(() => setSavingBillingMode(false));
                    }}
                  >
                    FOD
                  </button>
                </div>
              </div>
            ) : null}
            {freightCompare?.isFod ? (
              <dl className="logistics-booking__freight-compare">
                <div className="logistics-booking__freight-fod-row">
                  <dt>FOD</dt>
                  <dd>
                    {freightCompare.actualFreightInr != null
                      ? formatCurrency(freightCompare.actualFreightInr)
                      : (freightLoading ? '…' : '—')}
                    <em className="logistics-booking__freight-source">
                      Consignee pays freight — no Diff / under-billed
                    </em>
                  </dd>
                </div>
              </dl>
            ) : (
            <dl className="logistics-booking__freight-compare">
              <div>
                <dt>Paid freight</dt>
                <dd>
                  {freightCompare?.paidFreightInr != null
                    ? formatCurrency(freightCompare.paidFreightInr)
                    : (freightLoading ? '…' : '—')}
                </dd>
              </div>
              <div>
                <dt>Actual freight</dt>
                <dd>
                  {freightCompare?.actualFreightInr != null
                    ? formatCurrency(freightCompare.actualFreightInr)
                    : (freightLoading ? '…' : '—')}
                  {booking.courierFreight?.ok && booking.courierFreight.totalInr != null ? (
                    <em className="logistics-booking__freight-source">Delhivery API</em>
                  ) : null}
                </dd>
              </div>
              <div className={[
                'logistics-booking__freight-diff',
                freightCompare?.differenceInr == null
                  ? ''
                  : freightCompare.differenceInr > 0
                    ? 'is-under'
                    : freightCompare.differenceInr < 0
                      ? 'is-over'
                      : 'is-matched',
              ].filter(Boolean).join(' ')}
              >
                <dt>Difference</dt>
                <dd>
                  {freightCompare?.differenceInr != null
                    ? (
                      <>
                        {formatCurrency(freightCompare.differenceInr)}
                        <em>{formatFreightDiffLabel(freightCompare.differenceInr)}</em>
                      </>
                    )
                    : (freightLoading ? '…' : '—')}
                </dd>
              </div>
            </dl>
            )}

            {freightCompare?.calc && (
              <div className="logistics-booking__freight-calc">
                <h5>Actual freight calculation</h5>
                <dl className="logistics-booking__freight-calc-meta">
                  <div>
                    <dt>Courier</dt>
                    <dd>{freightCompare.calc.partnerLabel}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>
                      {freightCompare.calc.shipmentMode === 'envelope'
                        ? 'Envelope'
                        : `${freightCompare.calc.boxCount} box${freightCompare.calc.boxCount === 1 ? '' : 'es'}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Ship from</dt>
                    <dd>{freightCompare.calc.shipFromLabel}</dd>
                  </div>
                  {freightCompare.calc.destinationLabel && (
                    <div>
                      <dt>Destination</dt>
                      <dd>{freightCompare.calc.destinationLabel}</dd>
                    </div>
                  )}
                  {freightCompare.calc.zoneLabel && (
                    <div>
                      <dt>Zone</dt>
                      <dd>{freightCompare.calc.zoneLabel}</dd>
                    </div>
                  )}
                  {freightCompare.calc.volumetricDivisor != null && (
                    <div>
                      <dt>Vol. divisor</dt>
                      <dd>{freightCompare.calc.volumetricDivisor}</dd>
                    </div>
                  )}
                </dl>

                {freightCompare.calc.boxes.length > 0 && (
                  <div className="logistics-booking__freight-boxes">
                    <h6>
                      Packages · {freightCompare.calc.boxes.length}
                    </h6>
                    <ul>
                      {freightCompare.calc.boxes.map(box => (
                        <li key={`${box.label}-${box.index}`}>
                          <strong>{box.label}</strong>
                          <span>{box.dimensionsLabel}</span>
                          <span>
                            Actual {box.actualKg.toFixed(2)} kg
                            {' · '}
                            Vol {box.volumetricKg.toFixed(2)} kg
                            {' · '}
                            Chg {box.chargeableKg.toFixed(0)} kg
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <dl className="logistics-booking__freight-calc-totals">
                  <div>
                    <dt>Total actual wt.</dt>
                    <dd>{freightCompare.calc.totalActualKg.toFixed(2)} kg</dd>
                  </div>
                  <div>
                    <dt>Total volumetric wt.</dt>
                    <dd>{freightCompare.calc.totalVolumetricKg.toFixed(2)} kg</dd>
                  </div>
                  <div>
                    <dt>Total chargeable wt.</dt>
                    <dd>
                      {(freightCompare.chargeableKg
                        ?? freightCompare.calc.totalChargeableKg).toFixed(2)}
                      {' '}
                      kg
                    </dd>
                  </div>
                  {freightCompare.calc.boxPerKgInr != null && freightCompare.calc.boxPerKgInr > 0 && (
                    <div>
                      <dt>Rate</dt>
                      <dd>
                        {formatCurrency(freightCompare.calc.boxPerKgInr)}
                        /kg
                      </dd>
                    </div>
                  )}
                  {freightCompare.calc.envelopeFixedInr != null
                    && freightCompare.calc.envelopeFixedInr > 0 && (
                    <div>
                      <dt>Envelope fixed</dt>
                      <dd>{formatCurrency(freightCompare.calc.envelopeFixedInr)}</dd>
                    </div>
                  )}
                  {freightCompare.calc.freightInr != null && (
                    <div>
                      <dt>Base freight</dt>
                      <dd>{formatCurrency(freightCompare.calc.freightInr)}</dd>
                    </div>
                  )}
                  {freightCompare.calc.fuelSurchargePercent != null
                    && freightCompare.calc.fuelSurchargePercent > 0 && (
                    <div>
                      <dt>
                        Fuel (
                        {freightCompare.calc.fuelSurchargePercent}
                        %)
                      </dt>
                      <dd>
                        {freightCompare.calc.fuelSurchargeInr != null
                          ? formatCurrency(freightCompare.calc.fuelSurchargeInr)
                          : '—'}
                      </dd>
                    </div>
                  )}
                  {freightCompare.calc.totalInr != null && (
                    <div className="logistics-booking__freight-calc-total">
                      <dt>Quoted total</dt>
                      <dd>{formatCurrency(freightCompare.calc.totalInr)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <p className="text-muted text-sm logistics-booking__freight-hint">
              Paid = freight on invoice.
              Actual = Delhivery freight charges after weight captured when available,
              otherwise rate-card estimate.
              Difference = Actual − Paid.
            </p>
            {freightCompare?.actualNote && (
              <p className="text-muted text-sm logistics-booking__freight-note">
                {freightCompare.actualNote}
              </p>
            )}
          </div>
        </section>
      )}

      {booking.partnerId === 'delhivery' && booking.courierFreight && (
        <section className="logistics-booking__delhivery-freight" aria-label="Delhivery freight charges">
          <div className="logistics-booking__card logistics-booking__card--wide">
            <h4>
              <IndianRupee size={16} aria-hidden />
              Delhivery freight charges
            </h4>
            {booking.courierFreight.ok ? (
              <dl className="logistics-booking__freight-breakup">
                {delhiveryFreightBreakupRows(booking.courierFreight).map(row => (
                  <div
                    key={row.label}
                    className={row.emphasize ? 'is-total' : undefined}
                  >
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted text-sm">
                {booking.courierFreight.error || 'Freight charges not available yet.'}
                {!/lrn required|weight captured/i.test(booking.courierFreight.error || '')
                  ? ' Available after Delhivery records weight captured.'
                  : ''}
              </p>
            )}
          </div>
        </section>
      )}

      {!isIncompleteLogisticsBooking(booking) && booking.status !== 'returned' && booking.status !== 'cancelled' && (
        <section className="logistics-booking__timeline" aria-label="Shipment status">
          <ol className="logistics-booking__timeline-list">
            {PROGRESS_STATUSES.map((item, index) => {
              const done = index <= currentIndex;
              const current = item.id === booking.status;
              return (
                <li
                  key={item.id}
                  className={[
                    'logistics-booking__timeline-item',
                    done ? 'is-done' : '',
                    current ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="logistics-booking__timeline-dot" aria-hidden>
                    {done ? <Check size={12} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="logistics-booking__timeline-label">{item.label}</span>
                </li>
              );
            })}
          </ol>
          {isOps && nextStatus && onAdvanceStatus && (
            <button
              type="button"
              className="btn btn-secondary btn-sm logistics-booking__advance"
              onClick={() => onAdvanceStatus(nextStatus)}
            >
              Mark as {LOGISTICS_BOOKING_STATUSES.find(item => item.id === nextStatus)?.label}
            </button>
          )}
        </section>
      )}

      <section className="logistics-booking__cards">
        <div className="logistics-booking__card">
          <h4>
            <Truck size={16} aria-hidden />
            Courier details
          </h4>
          <dl className="logistics-booking__meta">
            {isDelhivery ? (
              <>
                <div>
                  <dt>LRN</dt>
                  <dd>{delhiveryIds?.lrn || booking.consignmentNo || '—'}</dd>
                </div>
                <div>
                  <dt>Master AWB</dt>
                  <dd>
                    {delhiveryIds?.masterAwb
                      || booking.masterAwb
                      || booking.courierTrack?.masterAwb
                      || '—'}
                  </dd>
                </div>
                <div>
                  <dt>Pickup</dt>
                  <dd>
                    {booking.delhiveryPickup?.ok && booking.delhiveryPickup.pickupId
                      ? (
                        <>
                          {booking.delhiveryPickup.pickupId}
                          {booking.delhiveryPickup.alreadyExisted ? ' (already open)' : ''}
                          {booking.delhiveryPickup.pickupDate
                            ? ` · ${booking.delhiveryPickup.pickupDate}`
                            : ''}
                          {booking.delhiveryPickup.pickupLocationName
                            ? ` · ${booking.delhiveryPickup.pickupLocationName}`
                            : ''}
                        </>
                      )
                      : (booking.delhiveryPickup && !booking.delhiveryPickup.ok
                        ? (booking.delhiveryPickup.message || 'Pickup request failed')
                        : 'Not requested')}
                  </dd>
                </div>
                {isOps && user && (
                  !booking.delhiveryPickup?.ok || !booking.delhiveryPickup?.pickupId
                ) && (
                  <div>
                    <dt />
                    <dd>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={requestingPickup}
                        onClick={() => { void handleRequestDelhiveryPickup(); }}
                      >
                        {requestingPickup ? 'Requesting pickup…' : 'Request pickup'}
                      </button>
                      {pickupError ? (
                        <p className="text-danger text-sm" style={{ marginTop: 6 }}>{pickupError}</p>
                      ) : null}
                    </dd>
                  </div>
                )}
              </>
            ) : (
              <div><dt>LRN / AWB</dt><dd>{booking.consignmentNo || '—'}</dd></div>
            )}
            <div><dt>Branch</dt><dd>{booking.branch || '—'}</dd></div>
            <div><dt>Service</dt><dd>{booking.serviceType || '—'}</dd></div>
            <div><dt>Booked on</dt><dd>{booking.bookingDate}</dd></div>
            {booking.courierFreight?.ok && delhiveryFreightExclGst(booking.courierFreight) != null && (
              <div>
                <dt>Freight (excl. GST)</dt>
                <dd>{formatCurrency(delhiveryFreightExclGst(booking.courierFreight)!)}</dd>
              </div>
            )}
            <div>
              <dt>Ship from</dt>
              <dd>
                {shipFromSiteLabel(booking.shipFromSite)}
                {booking.shipFromAddress?.trim()
                  ? ` — ${booking.shipFromAddress.trim()}`
                  : ''}
              </dd>
            </div>
          </dl>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <MapPin size={16} aria-hidden />
            Delivery address
          </h4>
          <p className="logistics-booking__address">
            <strong>{booking.dealer.name}</strong>
            <span className="book-courier__dealer-code">{booking.dealer.code}</span>
            <span>{booking.dealer.contactPerson} · {booking.dealer.mobile}</span>
            <span className="book-courier__address-block">{booking.deliveryAddress}</span>
          </p>
        </div>
        <div className="logistics-booking__card">
          <h4>
            <Package size={16} aria-hidden />
            Package
          </h4>
          <dl className="logistics-booking__meta">
            <div><dt>Shipment</dt><dd>{shipmentModeLabel(booking.shipmentMode)}</dd></div>
            {!isEnvelope && (
              <>
                <div><dt>Boxes</dt><dd>{booking.numberOfBoxes}</dd></div>
                <div><dt>Actual wt.</dt><dd>{booking.actualWeightKg.toFixed(2)} kg</dd></div>
                <div><dt>Volumetric wt.</dt><dd>{booking.volumetricWeightKg.toFixed(2)} kg</dd></div>
                <div><dt>Booked chargeable</dt><dd>{chargeableWeight(booking).toFixed(2)} kg</dd></div>
                {booking.courierFreight?.chargedWeightKg != null && (
                  <div>
                    <dt>Delhivery charged</dt>
                    <dd>{booking.courierFreight.chargedWeightKg.toFixed(2)} kg</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {!isEnvelope && booking.boxes.length > 0 && (
            <ul className="logistics-booking__box-dims">
              {booking.boxes.map((box, index) => (
                <li key={box.id}>
                  <div className="logistics-booking__box-dims-head">
                    <strong>Box {index + 1}</strong>
                    <span>{boxDimensionsLabel(box)}</span>
                  </div>
                  <div className="logistics-booking__box-dims-meta">
                    <span>Actual {(box.weightKg || 0).toFixed(2)} kg</span>
                    <span>Vol {(box.volumetricWeightKg || 0).toFixed(2)} kg</span>
                    <span>Chg {boxChargeableWeight(box).toFixed(2)} kg</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(bookingHasPhotos(booking) || (isOps && booking.status !== 'returned' && booking.status !== 'cancelled')) && (
        <section className="logistics-booking__photos">
          <h4>Package photos</h4>
          {photosLoading
            && !booking.boxes.some(box => box.photos.some(p => p.url?.trim()))
            && !booking.finalPackagePhoto && (
            <p className="text-muted text-sm">Loading photos…</p>
          )}
          <div className="book-courier__gallery">
            {booking.boxes.flatMap((box, boxIndex) => box.photos.map((photo, photoIndex) => {
              const photoUrl = photo.url?.trim();
              if (!photoUrl) return null;
              return (
                <div key={photo.storagePath || `${box.id}-${photoIndex}`} className="book-courier__thumb">
                  <button
                    type="button"
                    onClick={() => openPreview(photoUrl)}
                    aria-label={`Preview ${isEnvelope ? 'envelope' : `box ${boxIndex + 1}`}${photoIndex === 0 ? ' inside' : ''} photo`}
                  >
                    <img src={photoUrl} alt={`Box ${boxIndex + 1}`} />
                  </button>
                  <span>{isEnvelope ? 'Envelope' : `Box ${boxIndex + 1}`}{photoIndex === 0 ? ' · inside' : ''}</span>
                </div>
              );
            }))}
            {booking.finalPackagePhoto && (
              <div className="book-courier__thumb">
                <button
                  type="button"
                  onClick={() => openPreview(booking.finalPackagePhoto!)}
                  aria-label="Preview label pasted photo"
                >
                  <img src={booking.finalPackagePhoto} alt="Final package" />
                </button>
                <span>Label pasted</span>
                {isOps && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={uploadingFinalPhoto}
                    onClick={() => finalPhotoInputRef.current?.click()}
                  >
                    <Camera size={14} aria-hidden />
                    {uploadingFinalPhoto ? 'Uploading…' : 'Retake'}
                  </button>
                )}
              </div>
            )}
          </div>
          {isOps && needsOuterPhoto && booking.status !== 'returned' && booking.status !== 'cancelled' && (
            <div className="logistics-booking__final-photo-add">
              <p className="text-muted text-sm">
                Outer package photo not added yet. You can capture it now at any stage.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={uploadingFinalPhoto}
                onClick={() => finalPhotoInputRef.current?.click()}
              >
                <Camera size={14} aria-hidden />
                {uploadingFinalPhoto ? 'Uploading…' : 'Add outer package photo'}
              </button>
            </div>
          )}
          <input
            ref={finalPhotoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={event => {
              void handleFinalPhotoSelected(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </section>
      )}

      <section className="logistics-booking__issue">
        <h4>Support</h4>
        <p className="text-muted text-sm">
          Open a Warranty &amp; Support complaint with this shipment’s dealer and logistics details.
        </p>
        <div className="logistics-booking__issue-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setRaiseIssueOpen(true)}
            disabled={!user}
          >
            <MessageSquareWarning size={14} aria-hidden />
            Raise issue ticket
          </button>
          {booking.supportRequestId && booking.supportRequestNumber && (
            <Link
              to={`${basePath}/warranty-support/${booking.supportRequestId}`}
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink size={14} aria-hidden />
              Open {booking.supportRequestNumber}
            </Link>
          )}
        </div>
      </section>

      <section className="logistics-booking__slips">
        <h4>Documents</h4>
        {isDelhivery ? (
          <>
            <div className="logistics-booking__doc-cards">
              {delhiveryDocCards.map(doc => {
                const meta = delhiveryDocCardMeta(doc.kind);
                const opening = delhiveryDocOpening === doc.id;
                const done = doc.kind === 'shipping_label' && booking.shippingLabelGenerated;
                const disabled = !doc.enabled || delhiveryDocOpening != null;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    className={[
                      'logistics-booking__doc-card',
                      `logistics-booking__doc-card--${meta.tone}`,
                      done ? 'is-done' : '',
                      opening ? 'is-opening' : '',
                      !doc.enabled ? 'is-disabled' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => openLogisticsDocCard(doc)}
                    disabled={disabled}
                    title={doc.disabledReason ?? undefined}
                  >
                    <span className="logistics-booking__doc-card-icon" aria-hidden>
                      <meta.Icon size={22} strokeWidth={1.75} />
                      {doc.enabled ? (
                        <span className="logistics-booking__doc-card-eye">
                          <Eye size={11} strokeWidth={2.25} />
                        </span>
                      ) : null}
                    </span>
                    <span className="logistics-booking__doc-card-copy">
                      <strong>{meta.title}</strong>
                      <em>
                        {opening
                          ? 'Opening…'
                          : (doc.kind === 'eway_bill' && ewayEnsuring
                            ? 'Checking e-way bill…'
                            : (doc.note
                              ? doc.note
                              : (!doc.enabled && doc.disabledReason
                                ? doc.disabledReason
                                : meta.subtitle)))}
                      </em>
                    </span>
                    <span className="logistics-booking__doc-card-chevron" aria-hidden>
                      <ChevronRight size={18} strokeWidth={2.25} />
                    </span>
                  </button>
                );
              })}
            </div>
            {delhiveryDocsLoading && (
              <p className="text-muted text-sm">Loading Delhivery documents…</p>
            )}
            {delhiveryDocsError && (
              <p className="logistics-booking__docs-error" role="alert">{delhiveryDocsError}</p>
            )}
            {isOps && !booking.shippingLabelGenerated && isIncompleteLogisticsBooking(booking) && (
              <p className="text-muted text-sm logistics-booking__slip-hint">
                Open the Delhivery shipping label to confirm this shipment.
              </p>
            )}
          </>
        ) : (
          <>
            {sharedDocCards.length > 0 ? (
              <>
                <div className="logistics-booking__doc-cards">
                  {sharedDocCards.map(doc => {
                    const meta = delhiveryDocCardMeta(doc.kind);
                    const opening = delhiveryDocOpening === doc.id;
                    const disabled = !doc.enabled || delhiveryDocOpening != null;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        className={[
                          'logistics-booking__doc-card',
                          `logistics-booking__doc-card--${meta.tone}`,
                          opening ? 'is-opening' : '',
                          !doc.enabled ? 'is-disabled' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => openLogisticsDocCard(doc)}
                        disabled={disabled}
                        title={doc.disabledReason ?? undefined}
                      >
                        <span className="logistics-booking__doc-card-icon" aria-hidden>
                          <meta.Icon size={22} strokeWidth={1.75} />
                          {doc.enabled ? (
                            <span className="logistics-booking__doc-card-eye">
                              <Eye size={11} strokeWidth={2.25} />
                            </span>
                          ) : null}
                        </span>
                        <span className="logistics-booking__doc-card-copy">
                          <strong>{meta.title}</strong>
                          <em>
                            {opening
                              ? 'Opening…'
                              : (doc.kind === 'eway_bill' && ewayEnsuring
                                ? 'Checking e-way bill…'
                                : (doc.note
                                  ? doc.note
                                  : (!doc.enabled && doc.disabledReason
                                    ? doc.disabledReason
                                    : meta.subtitle)))}
                          </em>
                        </span>
                        <span className="logistics-booking__doc-card-chevron" aria-hidden>
                          <ChevronRight size={18} strokeWidth={2.25} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                {delhiveryDocsError ? (
                  <p className="logistics-booking__docs-error" role="alert">{delhiveryDocsError}</p>
                ) : null}
              </>
            ) : null}
            <div className="logistics-booking__slip-actions">
              <button
                type="button"
                className={`btn btn-secondary btn-sm${booking.courierSlipGenerated ? ' is-done' : ''}`}
                onClick={() => setCourierSlipOpen(true)}
                disabled={generating !== null}
              >
                <Eye size={14} aria-hidden />
                View booking slip
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleDownloadCourierSlip()}
                disabled={generating !== null || downloadingSlip}
              >
                <Download size={14} aria-hidden />
                {downloadingSlip ? 'Downloading…' : 'Download booking slip'}
              </button>
              {isOps && !shippingLabelBlocked && (
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm${booking.shippingLabelGenerated ? ' is-done' : ''}`}
                  onClick={openShippingLabel}
                  disabled={generating !== null}
                >
                  <Eye size={14} aria-hidden />
                  View shipping label
                </button>
              )}
            </div>
            {isOps && shippingLabelBlocked && (
              <div className="logistics-booking__slip-blocked" role="status">
                <AlertTriangle size={14} aria-hidden />
                <div>
                  <strong>Shipping label unavailable</strong>
                  <p>
                    {shippingLabelGate.fromMissing && shippingLabelGate.toMissing
                      ? 'FROM and TO addresses are missing. Apply ship-from from Sites (or save it there first), and refresh the dealer address from Zoho.'
                      : shippingLabelGate.fromMissing
                        ? `This booking still has no ship-from address. Sites settings do not update existing shipments automatically — apply the ${STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'site'} address here.`
                        : 'TO (dealer delivery) address is missing. Refresh the dealer from Zoho, then try again.'}
                  </p>
                  {shippingLabelGate.fromMissing && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm logistics-booking__slip-blocked-action"
                      disabled={updatingShipFrom}
                      onClick={() => void handleApplyShipFromFromSites({ openLabel: true })}
                    >
                      {updatingShipFrom
                        ? 'Applying…'
                        : `Apply ${STAFF_LOGISTICS_SITE_LABELS[booking.shipFromSite] || 'site'} address from Sites`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {isOps && (booking.courierSlipGenerated || booking.shippingLabelGenerated) && (
              <p className="text-muted text-sm logistics-booking__slip-names">
                {booking.courierSlipGenerated && courierSlipFileName(booking)}
                {booking.courierSlipGenerated && booking.shippingLabelGenerated && ' · '}
                {booking.shippingLabelGenerated && shippingLabelFileName(booking)}
              </p>
            )}
            {isOps && !shippingLabelBlocked && !booking.shippingLabelGenerated && isIncompleteLogisticsBooking(booking) && (
              <p className="text-muted text-sm logistics-booking__slip-hint">
                Open and print the shipping label to confirm this shipment.
              </p>
            )}
          </>
        )}
      </section>

      {isOps
        && booking.status !== 'delivered'
        && booking.status !== 'cancelled'
        && booking.status !== 'returned'
        && (onCancel || onReturn || isDelhivery) && (
        <div className="logistics-booking__ops-actions">
          {isDelhivery ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm logistics-booking__delete-btn"
              disabled={cancellingDelhivery || !isDelhiveryB2bLrn(delhiveryIds?.lrn || booking.consignmentNo)}
              onClick={() => void handleCancelDelhiveryLr()}
            >
              <Trash2 size={14} aria-hidden />
              {cancellingDelhivery ? 'Cancelling on Delhivery…' : 'Cancel LR on Delhivery'}
            </button>
          ) : onCancel ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel shipment
            </button>
          ) : null}
          {onReturn && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReturn}>
              Mark returned
            </button>
          )}
          {cancelDelhiveryError ? (
            <p className="dealers-modal__error logistics-booking__cancel-delhivery-error">
              {cancelDelhiveryError}
            </p>
          ) : null}
        </div>
      )}

      {user && canDeleteLogisticsBooking(user) && onDelete && (
        <div className="logistics-booking__ops-actions logistics-booking__ops-actions--danger">
          <button
            type="button"
            className="btn btn-secondary btn-sm logistics-booking__delete-btn"
            onClick={onDelete}
          >
            Delete permanently
          </button>
        </div>
      )}

      <details className="logistics-booking__summary">
        <summary>Full booking summary</summary>
        <dl className="book-courier__review">
          {bookingSummaryLines(booking).map(row => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      {raiseIssueOpen && user && (
        <RaiseLogisticsIssueDialog
          booking={booking}
          user={user}
          onClose={() => setRaiseIssueOpen(false)}
          onCreated={onUpdate}
        />
      )}

      {courierSlipOpen && (
        <CourierSlipViewDialog
          booking={booking}
          onClose={() => setCourierSlipOpen(false)}
          onViewed={handleCourierSlipViewed}
        />
      )}

      {shippingLabelOpen && (shippingLabelBooking || booking) && (
        <ShippingLabelPrintDialog
          booking={shippingLabelBooking ?? booking}
          alreadyPrinted={(shippingLabelBooking ?? booking).shippingLabelGenerated}
          onClose={() => {
            setShippingLabelOpen(false);
            setShippingLabelBooking(null);
          }}
          onPrinted={handleShippingLabelPrinted}
          onBookingRepair={onUpdate}
        />
      )}

      {delhiveryDocDialog && (
        <DelhiveryDocumentDialog
          payload={{
            ...delhiveryDocDialog,
            cancelBusy: ewayCancelling,
          }}
          onClose={closeDelhiveryDocDialog}
          onViewed={
            /shipping label/i.test(delhiveryDocDialog.title)
              ? () => {
                if (!isOps || booking.shippingLabelGenerated) return;
                void markDocumentGenerated('shipping_label');
              }
              : undefined
          }
        />
      )}

      {ewayCancelOpen ? (
        <EwayBillCancelDialog
          ewaybillNumber={ewayBillNumber}
          busy={ewayCancelling}
          error={ewayCancelError}
          onClose={() => {
            if (ewayCancelling) return;
            setEwayCancelOpen(false);
            setEwayCancelError('');
          }}
          onConfirm={handleConfirmCancelEwayBill}
        />
      ) : null}

      {previewIndex != null && galleryUrls[previewIndex] && (
        <PhotoLightbox
          urls={galleryUrls}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onIndexChange={setPreviewIndex}
        />
      )}
    </article>
  );
};
