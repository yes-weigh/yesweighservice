import { fetchAdminInvoiceDetail } from './admin-invoices';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function positiveInvoiceTotalInr(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Wait for Zoho-mirrored invoice number + total before Delhivery book.
 * Does not invent ₹1 — returns 0 when the mirror is still empty so the
 * booking callable can refresh from Zoho and then proceed.
 */
export async function hydrateInvoiceFieldsForDelhiveryBooking(input: {
  customerId: string;
  invoiceId: string;
  knownNumber?: string | null;
  knownTotal?: number | null;
}): Promise<{ invoiceNumber: string | null; invoiceValueInr: number }> {
  let invoiceNumber = input.knownNumber?.trim() || null;
  let invoiceValueInr = positiveInvoiceTotalInr(input.knownTotal);
  if (invoiceNumber && invoiceValueInr > 0) {
    return { invoiceNumber, invoiceValueInr };
  }

  const delaysMs = [0, 400, 800, 1200, 1600];
  for (const delayMs of delaysMs) {
    if (delayMs) await sleep(delayMs);
    try {
      const invoice = await fetchAdminInvoiceDetail(input.customerId, input.invoiceId);
      const number = invoice.invoiceNumber?.trim() || invoiceNumber;
      const total = positiveInvoiceTotalInr(invoice.total);
      if (number) invoiceNumber = number;
      if (total > 0) invoiceValueInr = total;
      if (invoiceNumber && invoiceValueInr > 0) {
        return { invoiceNumber, invoiceValueInr };
      }
    } catch {
      // Mirror may still be writing — keep waiting.
    }
  }

  return { invoiceNumber, invoiceValueInr };
}
