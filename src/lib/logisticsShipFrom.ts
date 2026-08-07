import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { DealerInvoiceDetail } from '../types/invoices';
import type { LogisticsBookingDraft } from '../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../types/staff-logistics';
import { STAFF_LOGISTICS_SITE_LABELS, isStaffLogisticsSite } from '../types/staff-logistics';
import { inventorySiteLabel, parseInventorySite } from './salesOrderSegments';
import { fetchAdminInvoiceDetail } from './admin-invoices';
import { fetchDealerInvoiceDetail } from './invoices';

export type InvoiceBranchShipFrom = {
  site: StaffLogisticsSite;
  branchLabel: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  source: 'sales_order' | 'invoice_category';
};

/**
 * Resolve ship-from site from the invoice’s linked sales-order branch
 * (`yesOneInventorySite` / `yesOneBranchLabel`).
 */
export async function resolveShipFromSiteForInvoice(
  invoice: Pick<
    DealerInvoiceDetail,
    'salesOrderId' | 'salesOrderNumber' | 'invoiceCategory' | 'categories'
  >,
): Promise<InvoiceBranchShipFrom | null> {
  const soId = invoice.salesOrderId?.trim() || '';
  if (soId) {
    try {
      const snap = await getDoc(doc(db, 'salesOrders', soId));
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        const site = parseInventorySite(data.yesOneInventorySite);
        if (site) {
          const branchLabel = String(data.yesOneBranchLabel ?? '').trim()
            || inventorySiteLabel(site);
          return {
            site,
            branchLabel,
            salesOrderId: soId,
            salesOrderNumber: invoice.salesOrderNumber?.trim()
              || (data.salesOrderNumber != null ? String(data.salesOrderNumber) : null),
            source: 'sales_order',
          };
        }
      }
    } catch {
      // Fall through — caller may use staff/default.
    }
  }
  return null;
}

export async function fetchInvoiceBranchShipFrom(input: {
  invoiceId: string;
  customerId: string;
  isOps: boolean;
}): Promise<InvoiceBranchShipFrom | null> {
  const invoiceId = input.invoiceId.trim();
  const customerId = input.customerId.trim();
  if (!invoiceId || !customerId) return null;
  try {
    const invoice = input.isOps
      ? await fetchAdminInvoiceDetail(customerId, invoiceId)
      : await fetchDealerInvoiceDetail(invoiceId, { customerId });
    return resolveShipFromSiteForInvoice(invoice);
  } catch {
    return null;
  }
}

export function shipFromSiteLabel(site: StaffLogisticsSite | string | null | undefined): string {
  if (site && isStaffLogisticsSite(site)) return STAFF_LOGISTICS_SITE_LABELS[site];
  return String(site ?? '—');
}

/** Prefer linked SO inventory site when persisting an invoice-linked booking. */
export async function resolvePersistShipFromSite(
  draft: Pick<LogisticsBookingDraft, 'source' | 'invoiceId' | 'zohoCustomerId' | 'shipFromSite'>,
): Promise<StaffLogisticsSite> {
  if (draft.source !== 'invoice') return draft.shipFromSite;
  const invoiceId = draft.invoiceId?.trim() || '';
  const customerId = draft.zohoCustomerId?.trim() || '';
  if (!invoiceId || !customerId) return draft.shipFromSite;
  const branch = await fetchInvoiceBranchShipFrom({
    invoiceId,
    customerId,
    isOps: true,
  });
  return branch?.site ?? draft.shipFromSite;
}
