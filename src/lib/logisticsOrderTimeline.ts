import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { invoiceTotalInclGst } from '../constants/ewayBill';
import { logisticsPartnerLabel } from '../constants/logisticsPartners';
import { LOGISTICS_BOOKING_STATUSES } from './logisticsBooking';
import { fetchInvoiceForLogisticsBooking } from './logisticsFreightCompare';
import { formatLogisticsDateTimeLabel } from './logisticsDateTime';
import { yesOneStageLabelForAudience } from './salesOrderWorkflow';
import type { DealerInvoiceDetail } from '../types/invoices';
import type { LogisticsBooking } from '../types/logistics-dispatch';
import { homePathForRole, type Role } from '../types';

export type LogisticsOrderTimelineLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type LogisticsOrderTimelineEvent = {
  id: string;
  /** ISO timestamp for sorting; null sorts last within same day. */
  at: string | null;
  atLabel: string;
  title: string;
  details: string[];
  links?: LogisticsOrderTimelineLink[];
};

function parseTime(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ms = Date.parse(`${raw}T12:00:00`);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function atLabel(value: unknown): string {
  return formatLogisticsDateTimeLabel(
    value == null ? null : String(value),
  );
}

function firestoreIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function pushEvent(
  out: LogisticsOrderTimelineEvent[],
  event: {
    id: string;
    at: string | null;
    title: string;
    details: string[];
    links?: LogisticsOrderTimelineLink[];
  },
): void {
  out.push({
    ...event,
    atLabel: atLabel(event.at),
  });
}

function resolveSoCreatorRole(so: Record<string, unknown>): string {
  if (Boolean(so.yesOneCreatedFromCart)) return 'Dealer portal';
  if (Boolean(so.yesOneCreatedByStaff)) return 'Staff';
  if (so.yesOneCreatedByName) return 'Super admin / Ops';
  return 'Zoho / system';
}

/** SO document date / cart ref — never yesOneUpdatedAt (that moves on every workflow step). */
function resolveSoCreatedAt(so: Record<string, unknown>): string | null {
  const date = String(so.date ?? '').trim();
  if (date && parseTime(date) != null) return date;

  const ref = String(so.referenceNumber ?? '').trim();
  const fromRef = ref.match(/YES-ORD-(\d{4})(\d{2})(\d{2})/i);
  if (fromRef) {
    return `${fromRef[1]}-${fromRef[2]}-${fromRef[3]}`;
  }

  const synced = firestoreIso(so.syncedAt);
  if (synced && parseTime(synced) != null) return synced;

  return null;
}

/** Stable ordering when multiple events share the same timestamp. */
function eventSortKey(id: string): number {
  if (id === 'so-created') return 10;
  if (id.startsWith('so-price-')) return 15;
  if (id === 'so-ready-payment') return 20;
  if (id.startsWith('so-stage-')) return 25;
  if (id === 'so-payment-submitted') return 30;
  if (id === 'so-payment-verified') return 40;
  if (id === 'so-einvoice') return 45;
  if (id === 'invoice-synced') return 50;
  if (id === 'invoice-eway') return 55;
  if (id === 'support-linked') return 60;
  if (id === 'logistics-created') return 70;
  if (id === 'logistics-pickup') return 75;
  if (id === 'freight-diff-settled') return 80;
  if (id === 'logistics-labels') return 85;
  if (id === 'logistics-in-transit') return 90;
  if (id === 'logistics-delivered') return 100;
  if (id === 'logistics-cancelled' || id === 'logistics-returned') return 110;
  if (id.startsWith('logistics-status-')) return 95;
  return 200;
}

function formatInr(amount: unknown): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
}

export function buildLogisticsOrderTimeline(input: {
  booking: LogisticsBooking;
  invoice: DealerInvoiceDetail | null;
  salesOrder: Record<string, unknown> | null;
  invoiceRaw: Record<string, unknown> | null;
  role: Role;
  isOps: boolean;
}): LogisticsOrderTimelineEvent[] {
  const { booking, invoice, salesOrder, invoiceRaw, role, isOps } = input;
  const events: LogisticsOrderTimelineEvent[] = [];
  const basePath = homePathForRole(role);
  const customerId = booking.dealer.zohoCustomerId?.trim() || invoice?.salesOrderId || '';
  const invoiceId = booking.invoiceId?.trim() || invoice?.id || '';
  const soId = invoice?.salesOrderId?.trim()
    || (salesOrder?.id ? String(salesOrder.id) : '');

  if (salesOrder) {
    const soNumber = String(salesOrder.salesOrderNumber || invoice?.salesOrderNumber || '').trim();
    const creator = String(salesOrder.yesOneCreatedByName || '').trim();
    const creatorRole = resolveSoCreatorRole(salesOrder);
    const createdAt = resolveSoCreatedAt(salesOrder);
    const details = [
      soNumber
        ? (/^SO[-\s]/i.test(soNumber) ? soNumber : `SO ${soNumber}`)
        : null,
      creator ? `Created by ${creator} (${creatorRole})` : `Created via ${creatorRole}`,
      salesOrder.salespersonName
        ? `KAM ${String(salesOrder.salespersonName)}`
        : null,
      salesOrder.yesOneBranchLabel
        ? `Ship-from ${String(salesOrder.yesOneBranchLabel)}`
        : null,
      salesOrder.referenceNumber
        ? `Ref ${String(salesOrder.referenceNumber)}`
        : null,
    ].filter(Boolean) as string[];

    pushEvent(events, {
      id: 'so-created',
      at: createdAt,
      title: 'Sales order created',
      details,
      links: isOps && soId
        ? [{ label: 'Open sales order', href: `${basePath}/sales-orders/${soId}` }]
        : undefined,
    });

    if (salesOrder.readyForPaymentAt) {
      pushEvent(events, {
        id: 'so-ready-payment',
        at: String(salesOrder.readyForPaymentAt),
        title: 'Ready for payment',
        details: [
          salesOrder.readyForPaymentByName
            ? `Marked by ${String(salesOrder.readyForPaymentByName)} (Staff)`
            : 'Awaiting dealer payment',
          salesOrder.paymentAmount != null
            ? `Amount ${formatInr(salesOrder.paymentAmount) ?? '—'}`
            : null,
        ].filter(Boolean) as string[],
        links: isOps && soId
          ? [{ label: 'Open sales order', href: `${basePath}/sales-orders/${soId}` }]
          : undefined,
      });
    }

    if (salesOrder.paymentSubmittedAt) {
      const links: LogisticsOrderTimelineLink[] = [];
      if (isOps && soId) {
        links.push({ label: 'Open sales order', href: `${basePath}/sales-orders/${soId}` });
      }
      const proofUrl = String(salesOrder.paymentScreenshotUrl || '').trim();
      if (proofUrl) {
        links.push({ label: 'View payment proof', href: proofUrl, external: true });
      }
      pushEvent(events, {
        id: 'so-payment-submitted',
        at: String(salesOrder.paymentSubmittedAt),
        title: 'Payment submitted',
        details: [
          salesOrder.paymentSubmittedByName
            ? `Submitted by ${String(salesOrder.paymentSubmittedByName)} (Dealer)`
            : 'Dealer submitted payment',
          salesOrder.paymentUtr
            ? `UTR ${String(salesOrder.paymentUtr)}`
            : null,
          salesOrder.paymentNotes
            ? `Note: ${String(salesOrder.paymentNotes)}`
            : null,
        ].filter(Boolean) as string[],
        links: links.length ? links : undefined,
      });
    }

    if (salesOrder.paymentVerifiedAt) {
      pushEvent(events, {
        id: 'so-payment-verified',
        at: String(salesOrder.paymentVerifiedAt),
        title: 'Payment approved',
        details: [
          salesOrder.paymentVerifiedByName
            ? `Approved by ${String(salesOrder.paymentVerifiedByName)} (Super admin)`
            : 'Payment verified',
          salesOrder.zohoInvoiceNumber
            ? `Invoice ${String(salesOrder.zohoInvoiceNumber)} created in Zoho`
            : null,
        ].filter(Boolean) as string[],
        links: isOps && soId
          ? [{ label: 'Open sales order', href: `${basePath}/sales-orders/${soId}` }]
          : undefined,
      });
    }

    const stage = String(salesOrder.yesOneStage || '').trim();
    if (stage && stage !== 'review' && !salesOrder.paymentSubmittedAt && !salesOrder.paymentVerifiedAt) {
      pushEvent(events, {
        id: `so-stage-${stage}`,
        at: String(salesOrder.yesOneUpdatedAt || salesOrder.syncedAt || salesOrder.date || ''),
        title: yesOneStageLabelForAudience(stage, 'admin'),
        details: [`Workflow stage: ${stage}`],
      });
    }

    const priceChanges = Array.isArray(salesOrder.yesOnePriceChanges)
      ? salesOrder.yesOnePriceChanges
      : [];
    for (const [index, raw] of priceChanges.entries()) {
      const row = raw as Record<string, unknown>;
      if (!row.changedAt) continue;
      pushEvent(events, {
        id: `so-price-${index}-${String(row.productId || index)}`,
        at: String(row.changedAt),
        title: 'Line rate customized',
        details: [
          String(row.name || row.sku || 'Item'),
          row.changedByName
            ? `By ${String(row.changedByName)}`
            : null,
          row.catalogRate != null && row.rate != null
            ? `₹${Number(row.catalogRate)} → ₹${Number(row.rate)}`
            : null,
        ].filter(Boolean) as string[],
      });
    }

    if (salesOrder.einvoicePushedAt) {
      pushEvent(events, {
        id: 'so-einvoice',
        at: String(salesOrder.einvoicePushedAt),
        title: 'E-invoice pushed to IRP',
        details: [
          salesOrder.einvoicePushStatus
            ? `Status ${String(salesOrder.einvoicePushStatus)}`
            : null,
          salesOrder.einvoicePushError
            ? `Error: ${String(salesOrder.einvoicePushError)}`
            : null,
        ].filter(Boolean) as string[],
      });
    }
  }

  if (invoice || invoiceRaw) {
    const invNumber = invoice?.invoiceNumber
      || (invoiceRaw?.invoiceNumber ? String(invoiceRaw.invoiceNumber) : booking.invoiceNumber);
    const invDate = invoice?.date || (invoiceRaw?.date ? String(invoiceRaw.date) : null);
    const syncedAt = firestoreIso(invoiceRaw?.syncedAt);
    const invAt = syncedAt || invDate;
    const status = invoice?.status || (invoiceRaw?.status ? String(invoiceRaw.status) : null);
    const total = invoice
      ? invoiceTotalInclGst(invoice)
      : Number(invoiceRaw?.total ?? 0);
    const totalInr = total != null && Number.isFinite(total) ? total : 0;

    pushEvent(events, {
      id: 'invoice-synced',
      at: invAt,
      title: 'Invoice on record',
      details: [
        invNumber ? `Invoice ${invNumber}` : null,
        status ? `Status ${status}` : null,
        totalInr > 0 ? `Total ${formatInr(totalInr) ?? '—'} incl. GST` : null,
        invoice?.salespersonName ? `KAM ${invoice.salespersonName}` : null,
      ].filter(Boolean) as string[],
      links: isOps && customerId && invoiceId
        ? [{ label: 'Open invoice', href: `${basePath}/invoices/${customerId}/${invoiceId}/invoice` }]
        : undefined,
    });

    const eway = (invoice?.ewayBill ?? invoiceRaw?.ewayBill) as Record<string, unknown> | null | undefined;
    if (eway?.generatedAt || eway?.ewaybillNumber) {
      pushEvent(events, {
        id: 'invoice-eway',
        at: eway.generatedAt ? String(eway.generatedAt) : invAt,
        title: 'E-way bill',
        details: [
          eway.ewaybillNumber ? `EWB ${String(eway.ewaybillNumber)}` : null,
          eway.status ? `Status ${String(eway.status)}` : null,
          eway.transporterGstin ? `Transporter GSTIN ${String(eway.transporterGstin)}` : null,
        ].filter(Boolean) as string[],
      });
    }
  }

  if (booking.supportRequestId) {
    pushEvent(events, {
      id: 'support-linked',
      at: booking.createdAt,
      title: 'Complaint linked',
      details: [
        booking.supportRequestNumber
          ? `Complaint ${booking.supportRequestNumber}`
          : `Complaint ${booking.supportRequestId}`,
      ],
    });
  }

  const logisticsTitle = booking.source === 'invoice'
    ? 'Logistics booked from invoice'
    : booking.source === 'support'
      ? 'Logistics booked from support'
      : 'Logistics entry created';

  pushEvent(events, {
    id: 'logistics-created',
    at: booking.createdAt,
    title: logisticsTitle,
    details: [
      booking.createdByName
        ? `By ${booking.createdByName}`
        : null,
      `${logisticsPartnerLabel(booking.partnerId)} · ${booking.consignmentNo || booking.trackingNo || '—'}`,
      booking.invoiceNumber ? `Invoice ${booking.invoiceNumber}` : null,
      booking.orderRef ? `Order ref ${booking.orderRef}` : null,
    ].filter(Boolean) as string[],
  });

  if (booking.delhiveryPickup?.requestedAt) {
    pushEvent(events, {
      id: 'logistics-pickup',
      at: booking.delhiveryPickup.requestedAt,
      title: 'Delhivery pickup requested',
      details: [
        booking.delhiveryPickup.pickupId
          ? `Pickup ${booking.delhiveryPickup.pickupId}`
          : null,
        booking.delhiveryPickup.pickupLocationName
          ? String(booking.delhiveryPickup.pickupLocationName)
          : null,
        booking.delhiveryPickup.alreadyExisted ? 'Pickup already open at warehouse' : null,
      ].filter(Boolean) as string[],
    });
  }

  if (booking.shippingLabelGenerated || booking.courierSlipGenerated) {
    pushEvent(events, {
      id: 'logistics-labels',
      at: booking.updatedAt,
      title: 'Shipping documents generated',
      details: [
        booking.shippingLabelGenerated ? 'Shipping label ready' : null,
        booking.courierSlipGenerated ? 'Courier slip ready' : null,
      ].filter(Boolean) as string[],
    });
  }

  if (booking.inTransitAt) {
    pushEvent(events, {
      id: 'logistics-in-transit',
      at: booking.inTransitAt,
      title: 'In transit',
      details: [
        booking.courierTrack?.status
          ? String(booking.courierTrack.status)
          : null,
      ].filter(Boolean) as string[],
    });
  }

  if (booking.deliveredAt || booking.courierTrack?.deliveredAt) {
    pushEvent(events, {
      id: 'logistics-delivered',
      at: booking.deliveredAt || booking.courierTrack?.deliveredAt || null,
      title: 'Delivered',
      details: [],
    });
  }

  if (booking.status === 'cancelled') {
    pushEvent(events, {
      id: 'logistics-cancelled',
      at: booking.updatedAt,
      title: 'Shipment cancelled',
      details: [],
    });
  } else if (booking.status === 'returned') {
    pushEvent(events, {
      id: 'logistics-returned',
      at: booking.updatedAt,
      title: 'Shipment returned',
      details: [],
    });
  }

  if (booking.freightDiffSettledAt) {
    pushEvent(events, {
      id: 'freight-diff-settled',
      at: booking.freightDiffSettledAt,
      title: 'Freight difference settled',
      details: [
        booking.freightDiffSettledInvoiceId ? 'Applied on next invoice' : null,
      ].filter(Boolean) as string[],
    });
  }

  const statusMeta = LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status);
  if (
    statusMeta
    && booking.status !== 'cancelled'
    && booking.status !== 'returned'
    && !booking.deliveredAt
    && !booking.inTransitAt
    && booking.status !== 'label_generated'
  ) {
    pushEvent(events, {
      id: `logistics-status-${booking.status}`,
      at: booking.updatedAt,
      title: `Shipment · ${statusMeta.label}`,
      details: [],
    });
  }

  events.sort((a, b) => {
    const aMs = parseTime(a.at) ?? Number.MAX_SAFE_INTEGER;
    const bMs = parseTime(b.at) ?? Number.MAX_SAFE_INTEGER;
    if (aMs !== bMs) return aMs - bMs;
    return eventSortKey(a.id) - eventSortKey(b.id);
  });

  return events;
}

export async function loadLogisticsOrderTimeline(
  booking: LogisticsBooking,
  options: { isOps: boolean; role: Role },
): Promise<LogisticsOrderTimelineEvent[]> {
  const invoice = await fetchInvoiceForLogisticsBooking(booking, { isOps: options.isOps });
  const customerId = booking.dealer.zohoCustomerId?.trim() || '';
  const invoiceId = booking.invoiceId?.trim() || '';

  let salesOrder: Record<string, unknown> | null = null;
  const soId = invoice?.salesOrderId?.trim();
  if (soId) {
    try {
      const snap = await getDoc(doc(db, 'salesOrders', soId));
      if (snap.exists()) {
        salesOrder = { id: snap.id, ...(snap.data() as Record<string, unknown>) };
      }
    } catch {
      salesOrder = null;
    }
  }

  let invoiceRaw: Record<string, unknown> | null = null;
  if (invoiceId && customerId) {
    try {
      const snap = await getDoc(doc(db, 'zohoCustomers', customerId, 'invoices', invoiceId));
      if (snap.exists()) invoiceRaw = snap.data() as Record<string, unknown>;
    } catch {
      invoiceRaw = null;
    }
  }

  return buildLogisticsOrderTimeline({
    booking,
    invoice,
    salesOrder,
    invoiceRaw,
    role: options.role,
    isOps: options.isOps,
  });
}
