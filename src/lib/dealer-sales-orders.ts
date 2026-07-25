import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { AdminFirestoreSalesOrder, AdminSalesOrderDetail } from './admin-sales-orders';
import { invoiceErrorMessage, parseInvoiceCategory, sumInvoiceProductQuantity } from './invoices';
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
    salesOrderCategory: list.salesOrderCategory,
    subtotal: Number(raw.subtotal ?? 0),
    taxTotal: Number(raw.taxTotal ?? 0),
    notes: raw.notes ? String(raw.notes) : null,
    lineItems,
  };
}

export async function listDealerSalesOrders(params: {
  limit?: number;
} = {}): Promise<AdminFirestoreSalesOrder[]> {
  try {
    const callable = httpsCallable<typeof params, { data: Record<string, unknown>[] }>(
      functions,
      'listDealerSalesOrders',
      { timeout: 60_000 },
    );
    const result = await callable(params);
    return (result.data?.data ?? []).map(row => mapListRow(row));
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
