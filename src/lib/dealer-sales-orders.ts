import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { AdminFirestoreSalesOrder, AdminSalesOrderDetail } from './admin-sales-orders';
import {
  invoiceErrorMessage,
  normalizeInvoiceCategories,
  normalizeInvoiceCategoryAmounts,
  parseInvoiceCategory,
  sumInvoiceProductQuantity,
} from './invoices';
import type { DealerInvoiceLineItem } from '../types/invoices';

const functions = getFunctions(app, 'asia-south1');

function mapLineItem(raw: Record<string, unknown>): DealerInvoiceLineItem {
  return {
    id: String(raw.id ?? ''),
    itemId: raw.itemId ? String(raw.itemId) : null,
    name: String(raw.name ?? 'Item'),
    description: raw.description ? String(raw.description) : null,
    sku: raw.sku ? String(raw.sku) : null,
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    total: Number(raw.total ?? 0),
    imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
    hsn: raw.hsn != null && String(raw.hsn).trim() ? String(raw.hsn) : null,
  };
}

function mapListRow(raw: Record<string, unknown>): AdminFirestoreSalesOrder {
  const lineItems = Array.isArray(raw.lineItems)
    ? raw.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
    : [];
  return {
    id: String(raw.id ?? ''),
    salesOrderNumber: String(raw.salesOrderNumber ?? ''),
    customerId: String(raw.customerId ?? ''),
    customerName: raw.customerName ? String(raw.customerName) : null,
    date: raw.date ? String(raw.date) : null,
    shipmentDate: raw.shipmentDate ? String(raw.shipmentDate) : null,
    status: String(raw.status ?? 'draft'),
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? 0),
    currencyCode: raw.currencyCode ? String(raw.currencyCode).toUpperCase() : 'INR',
    referenceNumber: raw.referenceNumber ? String(raw.referenceNumber) : null,
    syncedAt: raw.syncedAt ? String(raw.syncedAt) : null,
    itemQuantity: lineItems.length
      ? sumInvoiceProductQuantity(lineItems)
      : (raw.itemQuantity != null ? Number(raw.itemQuantity) : null),
    salesOrderCategory: parseInvoiceCategory(raw.salesOrderCategory),
    categories: normalizeInvoiceCategories(raw.categories),
    categoryAmounts: normalizeInvoiceCategoryAmounts(raw.categoryAmounts),
    yesOneStage: raw.yesOneStage ? String(raw.yesOneStage) : null,
    yesOneCreatedFromCart: Boolean(raw.yesOneCreatedFromCart),
  };
}

function mapDetail(raw: Record<string, unknown>): AdminSalesOrderDetail {
  const list = mapListRow(raw);
  const lineItems = Array.isArray(raw.lineItems)
    ? raw.lineItems.map(item => mapLineItem(item as Record<string, unknown>))
    : [];
  return {
    id: list.id,
    salesOrderNumber: list.salesOrderNumber,
    date: list.date,
    shipmentDate: list.shipmentDate,
    status: list.status,
    total: list.total,
    balance: list.balance,
    referenceNumber: list.referenceNumber,
    currencyCode: list.currencyCode,
    customerId: list.customerId,
    customerName: list.customerName,
    salespersonId: raw.salespersonId ? String(raw.salespersonId) : null,
    salespersonName: raw.salespersonName ? String(raw.salespersonName) : null,
    shippingAddress: raw.shippingAddress ? String(raw.shippingAddress) : null,
    salesOrderCategory: list.salesOrderCategory,
    categories: list.categories,
    categoryAmounts: list.categoryAmounts,
    subtotal: Number(raw.subtotal ?? 0),
    taxTotal: Number(raw.taxTotal ?? 0),
    notes: raw.notes ? String(raw.notes) : null,
    lineItems,
    yesOneStage: list.yesOneStage ?? null,
    yesOneCreatedFromCart: list.yesOneCreatedFromCart,
    paymentAmount: raw.paymentAmount != null ? Number(raw.paymentAmount) : null,
    paymentUtr: raw.paymentUtr ? String(raw.paymentUtr) : null,
    paymentNotes: raw.paymentNotes ? String(raw.paymentNotes) : null,
    paymentScreenshotStoragePath: raw.paymentScreenshotStoragePath
      ? String(raw.paymentScreenshotStoragePath)
      : null,
    paymentScreenshotUrl: raw.paymentScreenshotUrl ? String(raw.paymentScreenshotUrl) : null,
    paymentSubmittedAt: raw.paymentSubmittedAt ? String(raw.paymentSubmittedAt) : null,
    paymentVerifiedAt: raw.paymentVerifiedAt ? String(raw.paymentVerifiedAt) : null,
    readyForPaymentAt: raw.readyForPaymentAt ? String(raw.readyForPaymentAt) : null,
    readyForPaymentByName: raw.readyForPaymentByName ? String(raw.readyForPaymentByName) : null,
    zohoInvoiceId: raw.zohoInvoiceId ? String(raw.zohoInvoiceId) : null,
    zohoInvoiceNumber: raw.zohoInvoiceNumber ? String(raw.zohoInvoiceNumber) : null,
  };
}

export async function listDealerSalesOrders(params: {
  /** Max rows to return (server pages until this; default 2500). */
  limit?: number;
  dateStart?: string | null;
  dateEnd?: string | null;
} = {}): Promise<AdminFirestoreSalesOrder[]> {
  try {
    const callable = httpsCallable<
      typeof params,
      {
        salesOrders?: Record<string, unknown>[];
        data?: Record<string, unknown>[];
      } | Record<string, unknown>[]
    >(
      functions,
      'listDealerSalesOrders',
      { timeout: 180_000 },
    );
    const result = await callable(params);
    const payload = result.data;
    const rows = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.salesOrders)
        ? payload.salesOrders
        : (Array.isArray(payload?.data) ? payload.data : []));
    return rows.map(row => mapListRow(row as Record<string, unknown>));
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

export async function fetchDealerSalesOrderDetail(
  salesOrderId: string,
): Promise<AdminSalesOrderDetail> {
  try {
    const callable = httpsCallable<{ salesOrderId: string }, Record<string, unknown>>(
      functions,
      'getDealerSalesOrderDetail',
      { timeout: 60_000 },
    );
    const result = await callable({ salesOrderId });
    return mapDetail(result.data ?? {});
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
