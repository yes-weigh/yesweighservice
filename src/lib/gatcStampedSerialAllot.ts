import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { parseGatcStampingCapacityKg } from './gatcReports';
import { gatcStampingRangeFromDescription, invoiceLineHasGatcTag } from './invoiceGatcTag';
import { serialNumbersFromLineItem } from './invoices';
import {
  isMandatorySerialExemptLine,
  lineIsMandatorySerialCategory,
} from './mandatorySerials';
import {
  YESGATC_OV_MACHINE_HSN,
  YESONE_RC_CODE,
  isYesGatcOvCertificate,
  isYesoneIwpCertificate,
  listYesGatcCertificates,
} from './yesgatcRecords';
import type { DealerInvoiceLineItem } from '../types/invoices';
import type { AllotNonGatcSerialsResult } from './nonGatcSerialAllot';

const MACHINE_HSN = new Set<string>(YESGATC_OV_MACHINE_HSN);

function hsnDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export type UnlinkedIwpGatcCertificate = {
  id: string;
  certificateNumber: string;
  serialNumber: string;
  productName: string;
  productId?: string | null;
  sku: string | null;
  rcCode: string | null;
  rcName: string | null;
  issuedAt: string | null;
  max: string;
  min: string;
  e: string;
};

export function isGatcStampedSerialEligibleLine(line: Pick<
  DealerInvoiceLineItem,
  'hsn' | 'description' | 'quantity' | 'sku' | 'itemId' | 'categoryName'
> & { isWeighingScale?: boolean | null }): boolean {
  if (isMandatorySerialExemptLine(line)) return false;
  if (!invoiceLineHasGatcTag(line)) return false;
  if (MACHINE_HSN.has(hsnDigits(line.hsn))) return true;
  return lineIsMandatorySerialCategory(line);
}

export function gatcStampedSerialShortage(line: DealerInvoiceLineItem): number {
  if (!isGatcStampedSerialEligibleLine(line)) return 0;
  const qty = Math.max(0, Math.round(Number(line.quantity) || 0));
  return Math.max(0, qty - serialNumbersFromLineItem(line).length);
}

/** Prefer "Stamping: 50Kg 5g", then Max 50Kg on the invoice line. */
export function invoiceLineStampingCapacityKg(line: {
  description?: string | null;
  name?: string | null;
}): number | null {
  return parseGatcStampingCapacityKg(gatcStampingRangeFromDescription(line.description))
    || parseGatcStampingCapacityKg(line.description)
    || parseGatcStampingCapacityKg(line.name);
}

export function certificateCapacityKg(row: { max?: string | null }): number | null {
  return parseGatcStampingCapacityKg(row.max);
}

export function invoiceNeedsGatcStampedSerialAllotment(
  lines: ReadonlyArray<DealerInvoiceLineItem> | undefined,
): boolean {
  return (lines ?? []).some(line => gatcStampedSerialShortage(line) > 0);
}

function toPickerRow(row: {
  id: string;
  certificateNumber: string;
  serialNumber: string;
  productName: string;
  productId?: string | null;
  sku?: string | null;
  rcCode?: string | null;
  rcName?: string | null;
  issuedAt?: string | null;
  max?: string;
  min?: string;
  e?: string;
}): UnlinkedIwpGatcCertificate {
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    serialNumber: row.serialNumber,
    productName: row.productName,
    productId: row.productId ?? null,
    sku: row.sku ?? null,
    rcCode: row.rcCode ?? null,
    rcName: row.rcName ?? null,
    issuedAt: row.issuedAt ?? null,
    max: row.max ?? '',
    min: row.min ?? '',
    e: row.e ?? '',
  };
}

function isUnlinkedCertificate(row: { invoiceNumber?: string | null; invoiceId?: string | null }): boolean {
  return !String(row.invoiceNumber ?? '').trim() && !String(row.invoiceId ?? '').trim();
}

export async function listUnlinkedIwpGatcCertificates(
  max = 2000,
): Promise<UnlinkedIwpGatcCertificate[]> {
  try {
    const listed = await listYesGatcCertificates(10000, {
      rcCode: YESONE_RC_CODE,
      ovOnly: true,
    });
    const unlinked = listed
      .filter(row => (
        isYesoneIwpCertificate(row)
        && isYesGatcOvCertificate(row)
        && isUnlinkedCertificate(row)
        && !row.voided
        && Boolean(row.serialNumber.trim())
      ))
      .map(toPickerRow);
    if (unlinked.length) return unlinked.slice(0, max);
  } catch {
    // Warehouse / callable — fall through to the dedicated list.
  }

  const fn = httpsCallable<{ max?: number }, { rows?: UnlinkedIwpGatcCertificate[] }>(
    getFunctions(app, 'asia-south1'),
    'listUnlinkedIwpGatcCertificatesFn',
    { timeout: 60_000 },
  );
  return (await fn({ max })).data.rows ?? [];
}

export async function allotGatcStampedSerialsToInvoice(input: {
  customerId: string;
  invoiceId: string;
  lineId: string;
  certificateIds: string[];
  actorName: string;
}): Promise<AllotNonGatcSerialsResult> {
  const fn = httpsCallable<typeof input, AllotNonGatcSerialsResult>(
    getFunctions(app, 'asia-south1'),
    'allotGatcStampedSerialsToInvoiceFn',
    { timeout: 90_000 },
  );
  return (await fn(input)).data;
}

export async function unlinkGatcStampedSerialsFromInvoice(input: {
  customerId: string;
  invoiceId: string;
  actorName: string;
  lineId?: string;
}): Promise<AllotNonGatcSerialsResult> {
  const fn = httpsCallable<typeof input & { unlink: true }, AllotNonGatcSerialsResult>(
    getFunctions(app, 'asia-south1'),
    'allotGatcStampedSerialsToInvoiceFn',
    { timeout: 90_000 },
  );
  return (await fn({ ...input, unlink: true })).data;
}
