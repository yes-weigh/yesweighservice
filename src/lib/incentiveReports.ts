import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { SHIBIN_SALESPERSON_ID } from '../constants/shibinSalesperson';
import { db } from '../firebase';
import {
  fetchAllAdminInvoicesInRange,
  type AdminFirestoreInvoice,
} from './admin-invoices';
import { canonicalSalespersonName } from './dealerKamDisplay';
import {
  invoiceAmountExclGst,
  isFreightInvoiceLineItem,
  isGatcFeeInvoiceLineItem,
} from './invoices';
import { loadPriceLevels } from './priceLevels';
import type { PriceLevel } from '../types/priceLevels';

export const INCENTIVE_RATE = 0.035;
export const INCENTIVE_DIRECTOR_RATE = 0.02;
export const INCENTIVE_MONTH_START = '2026-04';

export type IncentiveKamId =
  | 'biju'
  | 'visak'
  | 'namratha'
  | 'saritha'
  | 'supriya'
  | 'shibin';

export type IncentiveKamOption = {
  id: IncentiveKamId;
  label: string;
  salespersonIds: string[];
  nameTokens: string[];
  spareOnly: boolean;
};

export const INCENTIVE_KAMS: IncentiveKamOption[] = [
  {
    id: 'biju',
    label: 'Biju',
    salespersonIds: ['99381000031557358'],
    nameTokens: ['biju'],
    spareOnly: false,
  },
  {
    id: 'visak',
    label: 'Visak',
    salespersonIds: ['99381000031557361'],
    nameTokens: ['visak', 'visakh'],
    spareOnly: false,
  },
  {
    id: 'namratha',
    label: 'Namratha',
    salespersonIds: ['99381000031557445'],
    nameTokens: ['namratha', 'namrata'],
    spareOnly: false,
  },
  {
    id: 'saritha',
    label: 'Saritha',
    salespersonIds: ['99381000029368684'],
    nameTokens: ['saritha', 'sarita'],
    spareOnly: false,
  },
  {
    id: 'supriya',
    label: 'Supriya',
    salespersonIds: ['99381000028629702'],
    nameTokens: ['supriya'],
    spareOnly: false,
  },
  {
    id: 'shibin',
    label: 'Shibin',
    salespersonIds: [SHIBIN_SALESPERSON_ID],
    nameTokens: ['shibin'],
    spareOnly: false,
  },
];

export type IncentivePriceAdjust = 'discount' | 'hike' | null;

export type IncentiveInvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string | null;
  date: string | null;
  salespersonName: string | null;
  kamId: IncentiveKamId | null;
  sales: number;
  incentive: number;
  rate: number;
  priceAdjust: IncentivePriceAdjust;
};

export type IncentiveInvoiceLine = {
  name: string;
  sku: string | null;
  qty: number;
  rate: number;
  total: number;
  itemId: string | null;
  priceAdjust: IncentivePriceAdjust;
};

type PriceChangeLike = {
  productId?: unknown;
  itemId?: unknown;
  sku?: unknown;
  name?: unknown;
  catalogRate?: unknown;
  rate?: unknown;
  source?: unknown;
  changedByUid?: unknown;
  priceLevelName?: unknown;
};

function isManualUserPriceChange(change: PriceChangeLike): boolean {
  if (change.source === 'price_level') return false;
  if (!change.changedByUid && change.priceLevelName) return false;
  return change.source === 'user' || Boolean(change.changedByUid) || change.source == null;
}

function priceAdjustFromChange(change: PriceChangeLike): IncentivePriceAdjust {
  if (!isManualUserPriceChange(change)) return null;
  const catalog = Number(change.catalogRate) || 0;
  const charged = Number(change.rate) || 0;
  if (catalog <= 0) return null;
  if (charged < catalog - 0.005) return 'discount';
  if (charged > catalog + 0.005) return 'hike';
  return null;
}

function summarizePriceAdjusts(changes: PriceChangeLike[]): IncentivePriceAdjust {
  let hike = false;
  for (const change of changes) {
    const kind = priceAdjustFromChange(change);
    if (kind === 'discount') return 'discount';
    if (kind === 'hike') hike = true;
  }
  return hike ? 'hike' : null;
}

function changeMatchesLine(
  change: PriceChangeLike,
  line: Pick<IncentiveInvoiceLine, 'itemId' | 'sku' | 'name'>,
): boolean {
  const productId = String(change.productId ?? '').trim();
  const itemId = String(change.itemId ?? '').trim();
  if (line.itemId && (productId === line.itemId || itemId === line.itemId)) return true;
  const sku = String(change.sku ?? '').trim();
  if (sku && line.sku && sku === line.sku.trim()) return true;
  const name = String(change.name ?? '').trim();
  return Boolean(name && line.name && name === line.name);
}

function linePriceAdjust(
  line: Pick<IncentiveInvoiceLine, 'itemId' | 'sku' | 'name'>,
  changes: PriceChangeLike[],
): IncentivePriceAdjust {
  let hike = false;
  for (const change of changes) {
    if (!changeMatchesLine(change, line)) continue;
    const kind = priceAdjustFromChange(change);
    if (kind === 'discount') return 'discount';
    if (kind === 'hike') hike = true;
  }
  return hike ? 'hike' : null;
}

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeName(value: string | null | undefined): string {
  return canonicalSalespersonName(value)
    .toLowerCase()
    .replace(/[()[\]]+/g, ' ')
    .replace(/[-_/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function invoiceStatusExcluded(status: string | null | undefined): boolean {
  const key = String(status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return key === 'void' || key === 'draft' || key === 'cancelled' || key === 'canceled';
}

export function incentiveMonthBounds(yearMonth: string): { dateStart: string; dateEnd: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    dateStart: `${yearMonth}-01`,
    dateEnd: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function matchIncentiveKam(
  invoice: Pick<AdminFirestoreInvoice, 'salespersonId' | 'salespersonName'>,
): IncentiveKamOption | null {
  const salespersonId = String(invoice.salespersonId ?? '').trim();
  const name = normalizeName(invoice.salespersonName);
  return INCENTIVE_KAMS.find(kam => {
    if (salespersonId && kam.salespersonIds.includes(salespersonId)) return true;
    return kam.nameTokens.some(token => name.includes(token));
  }) ?? null;
}

function categoryAmount(
  invoice: AdminFirestoreInvoice,
  category: 'product' | 'spare' | 'service' | 'software_key' | 'gatc',
): number {
  const raw = Number(invoice.categoryAmounts?.[category] ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Invoice sales for incentive: exclude GST, courier/freight, and GATC fees.
 * Freight is already omitted from categoryAmounts; GATC is dropped here.
 */
export function incentiveEligibleSales(
  invoice: AdminFirestoreInvoice,
  spareOnly = false,
): number {
  if (spareOnly) return Math.max(0, round2(categoryAmount(invoice, 'spare')));

  const product = categoryAmount(invoice, 'product');
  const spare = categoryAmount(invoice, 'spare');
  const software = categoryAmount(invoice, 'software_key');
  const service = categoryAmount(invoice, 'service');
  const gatc = categoryAmount(invoice, 'gatc');
  const fromCategories = product + spare + software + service;

  if (fromCategories > 0 || gatc > 0 || Object.keys(invoice.categoryAmounts ?? {}).length > 0) {
    return Math.max(0, round2(fromCategories));
  }

  return Math.max(0, round2(invoiceAmountExclGst(invoice)));
}

export function isDirectorPriceLevelName(name: string | null | undefined): boolean {
  const key = String(name ?? '').trim().toLowerCase();
  return key === 'director' || key === 'directors';
}

export function directorDealerIdSet(levels: Array<Pick<PriceLevel, 'name' | 'dealerIds'>>): Set<string> {
  const ids = new Set<string>();
  for (const level of levels) {
    if (!isDirectorPriceLevelName(level.name)) continue;
    for (const raw of level.dealerIds ?? []) {
      const id = String(raw ?? '').trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function incentiveRateForInvoice(
  kamId: IncentiveKamId | null,
  dealerIsDirector: boolean,
): number {
  if (kamId === 'shibin' && dealerIsDirector) return INCENTIVE_DIRECTOR_RATE;
  return INCENTIVE_RATE;
}

export function incentiveForSales(sales: number, rate = INCENTIVE_RATE): number {
  return round2(sales * rate);
}

function toIncentiveRow(
  invoice: AdminFirestoreInvoice,
  directorDealerIds: Set<string>,
): IncentiveInvoiceRow | null {
  if (invoiceStatusExcluded(invoice.status)) return null;
  const kam = matchIncentiveKam(invoice);
  const sales = incentiveEligibleSales(invoice, kam?.spareOnly === true);
  if (sales <= 0) return null;
  const dealerIsDirector = directorDealerIds.has(String(invoice.customerId ?? '').trim());
  const rate = incentiveRateForInvoice(kam?.id ?? null, dealerIsDirector);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber || invoice.id,
    customerId: String(invoice.customerId ?? '').trim(),
    customerName: invoice.customerName,
    date: invoice.date,
    salespersonName: invoice.salespersonName ?? kam?.label ?? null,
    kamId: kam?.id ?? null,
    sales,
    incentive: incentiveForSales(sales, rate),
    rate,
    priceAdjust: null,
  };
}

export async function fetchIncentiveInvoiceLines(
  customerId: string | null | undefined,
  invoiceId: string,
): Promise<IncentiveInvoiceLine[]> {
  const cid = String(customerId ?? '').trim();
  const invId = invoiceId.trim();
  if (!cid || !invId) return [];
  try {
    const snap = await getDoc(doc(db, 'zohoCustomers', cid, 'invoices', invId));
    if (!snap.exists()) return [];
    const invoice = snap.data() ?? {};
    const salesOrderId = invoice.salesOrderId != null ? String(invoice.salesOrderId).trim() : '';
    const changes = await loadSalesOrderPriceChanges(invId, salesOrderId);
    const lines = (Array.isArray(invoice.lineItems) ? invoice.lineItems : []) as unknown[];
    return lines
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      .map(raw => {
        const name = String(raw.name ?? 'Item');
        const sku = raw.sku != null ? String(raw.sku) : null;
        const itemId = raw.itemId != null ? String(raw.itemId) : (
          raw.item_id != null ? String(raw.item_id) : null
        );
        const hsn = raw.hsn != null ? String(raw.hsn) : null;
        return {
          name,
          sku,
          qty: Number(raw.quantity ?? raw.qty ?? 0) || 0,
          rate: Number(raw.rate ?? 0) || 0,
          total: Number(raw.total ?? 0) || 0,
          itemId,
          hsn,
        };
      })
      .filter(line => (
        !isFreightInvoiceLineItem(line)
        && !isGatcFeeInvoiceLineItem(line)
        && line.qty > 0
      ))
      .map(({ name, sku, qty, rate, total, itemId }) => ({
        name,
        sku,
        qty,
        rate,
        total,
        itemId,
        priceAdjust: linePriceAdjust({ itemId, sku, name }, changes),
      }));
  } catch {
    return [];
  }
}

async function loadSalesOrderPriceChanges(
  invoiceId: string,
  salesOrderId?: string,
): Promise<PriceChangeLike[]> {
  if (salesOrderId) {
    const soSnap = await getDoc(doc(db, 'salesOrders', salesOrderId));
    if (soSnap.exists()) {
      const raw = soSnap.data()?.yesOnePriceChanges;
      return Array.isArray(raw) ? raw : [];
    }
  }
  const found = await getDocs(query(
    collection(db, 'salesOrders'),
    where('zohoInvoiceId', '==', invoiceId),
    limit(1),
  ));
  if (found.empty) return [];
  const raw = found.docs[0].data()?.yesOnePriceChanges;
  return Array.isArray(raw) ? raw : [];
}

async function loadInvoicePriceAdjustments(
  invoiceIds: string[],
): Promise<Map<string, IncentivePriceAdjust>> {
  const map = new Map<string, IncentivePriceAdjust>();
  const ids = [...new Set(invoiceIds.map(id => id.trim()).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(query(
      collection(db, 'salesOrders'),
      where('zohoInvoiceId', 'in', chunk),
    ));
    for (const row of snap.docs) {
      const invoiceId = String(row.data()?.zohoInvoiceId ?? '').trim();
      if (!invoiceId) continue;
      const raw = row.data()?.yesOnePriceChanges;
      const kind = summarizePriceAdjusts(Array.isArray(raw) ? raw : []);
      if (kind) map.set(invoiceId, kind);
    }
  }
  return map;
}

export async function listIncentiveInvoices(yearMonth: string): Promise<{
  rows: IncentiveInvoiceRow[];
  truncated: boolean;
}> {
  const { dateStart, dateEnd } = incentiveMonthBounds(yearMonth);
  const [{ rows, truncated }, priceLevels] = await Promise.all([
    fetchAllAdminInvoicesInRange({
      category: 'all',
      dateStart,
      dateEnd,
      sort: 'latest',
      skipDerivedOverlays: true,
      maxRows: 4000,
    }),
    loadPriceLevels().catch(() => ({ levels: [] as PriceLevel[] })),
  ]);
  const directorDealerIds = directorDealerIdSet(priceLevels.levels);
  const mapped = rows
    .map(row => toIncentiveRow(row, directorDealerIds))
    .filter((row): row is IncentiveInvoiceRow => Boolean(row));
  const adjusts = await loadInvoicePriceAdjustments(mapped.map(row => row.id));
  return {
    rows: mapped.map(row => ({
      ...row,
      priceAdjust: adjusts.get(row.id) ?? null,
    })),
    truncated,
  };
}
