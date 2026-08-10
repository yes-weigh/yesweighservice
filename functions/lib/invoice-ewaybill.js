/**
 * Generate, cache, and serve e-way bills for Zoho invoices (logistics workflow).
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import { invoicesCollection } from './invoice-sync.js';
import {
  cancelZohoEwayBill,
  createZohoEwayBillForInvoice,
  fetchZohoEwayBillPdf,
  findZohoEwayBillForInvoice,
  loadPartnerGstin,
  mapZohoEwayBillRecord,
  normalizeGstin,
  resolveZohoTransporterId,
} from './zoho-ewaybills.js';

function partnerLabel(partnerId) {
  const labels = {
    delhivery: 'Delhivery',
    st_courier: 'ST Courier',
    bluedart: 'Blue Dart',
    trackon: 'Trackon',
    dtdc: 'DTDC',
    ecosafe: 'Ecosafe',
    aps: 'APS',
    personal_collection: 'Customer Pickup',
    own_vehicle: 'Own vehicle',
  };
  const id = String(partnerId ?? '');
  if (labels[id]) return labels[id];
  if (id.startsWith('bluedart_')) return 'Blue Dart';
  if (id.startsWith('trackon_')) return 'Trackon';
  return id || 'Courier';
}

export const EWAY_BILL_THRESHOLD_INR = 50_000;

function isEwayBillRequired(totalInr) {
  const total = Number(totalInr);
  return Number.isFinite(total) && total > EWAY_BILL_THRESHOLD_INR;
}

function ewayBillPdfPath(customerId, invoiceId, extension = 'pdf') {
  return `invoices/${customerId}/${invoiceId}-ewaybill.${extension}`;
}

async function readPdfFromStorage(storagePath) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buffer] = await file.download();
  return buffer?.length ? buffer : null;
}

async function uploadPdfToStorage(storagePath, buffer, mimeType) {
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    contentType: mimeType,
    metadata: { cacheControl: 'private, max-age=3600' },
  });
  return storagePath;
}

function normalizeEwayBillDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    zohoEwaybillId: raw.zohoEwaybillId ? String(raw.zohoEwaybillId) : null,
    ewaybillNumber: raw.ewaybillNumber ? String(raw.ewaybillNumber) : null,
    status: raw.status ? String(raw.status) : null,
    generatedAt: raw.generatedAt ? String(raw.generatedAt) : null,
    expiryDate: raw.expiryDate ? String(raw.expiryDate) : null,
    pdfStoragePath: raw.pdfStoragePath ? String(raw.pdfStoragePath) : null,
    transporterGstin: raw.transporterGstin ? String(raw.transporterGstin) : null,
    partnerId: raw.partnerId ? String(raw.partnerId) : null,
    lrNumber: raw.lrNumber ? String(raw.lrNumber) : null,
    error: raw.error ? String(raw.error) : null,
    required: raw.required !== false,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

async function persistEwayBill(customerId, invoiceId, patch, bookingId = null) {
  const db = getFirestore();
  const normalized = {
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await invoicesCollection(customerId).doc(invoiceId).set(
    { ewayBill: normalized },
    { merge: true },
  );
  if (bookingId) {
    await db.collection('logisticsBookings').doc(String(bookingId)).set({
      ewayBillNumber: normalized.ewaybillNumber ?? null,
      ewayBillStatus: normalized.status ?? null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  return normalized;
}

async function loadInvoiceMirror(customerId, invoiceId) {
  const snap = await invoicesCollection(String(customerId)).doc(String(invoiceId)).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (String(data.customerId ?? customerId) !== String(customerId)) return null;
  return { id: snap.id, ...data };
}

/**
 * Pull e-way metadata from Zoho (no generation). Used during invoice sync.
 */
export async function syncEwayBillMetadataFromZoho(accessToken, orgId, customerId, invoiceId, invoiceTotal) {
  const total = Number(invoiceTotal ?? 0);
  if (!isEwayBillRequired(total)) {
    await persistEwayBill(customerId, invoiceId, {
      required: false,
      status: 'not_required',
    });
    return null;
  }

  const remote = await findZohoEwayBillForInvoice(accessToken, orgId, invoiceId);
  if (!remote) {
    await persistEwayBill(customerId, invoiceId, {
      required: true,
      status: 'missing',
    });
    return null;
  }

  const mapped = mapZohoEwayBillRecord(remote);
  if (!mapped?.zohoEwaybillId) return null;

  return persistEwayBill(customerId, invoiceId, {
    ...mapped,
    required: true,
  });
}

/**
 * @param {object} secrets
 * @param {string} orgId
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   partnerId?: string | null;
 *   lrNumber?: string | null;
 *   bookingId?: string | null;
 *   autoGenerate?: boolean;
 *   invoiceTotalInr?: number | null;
 * }} input
 */
export async function ensureInvoiceEwayBill(secrets, orgId, input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const partnerId = String(input.partnerId ?? '').trim();
  const lrNumber = String(input.lrNumber ?? '').trim();
  const bookingId = String(input.bookingId ?? '').trim() || null;
  const autoGenerate = input.autoGenerate !== false;

  if (!customerId || !invoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }

  const invoice = await loadInvoiceMirror(customerId, invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found in portal. Sync invoices from Zoho first.');
  }

  const invoiceTotal = Number(input.invoiceTotalInr ?? invoice.total ?? 0);
  if (!isEwayBillRequired(invoiceTotal)) {
    const doc = await persistEwayBill(customerId, invoiceId, {
      required: false,
      status: 'not_required',
    }, bookingId);
    return {
      required: false,
      status: doc.status,
      ewaybillNumber: null,
      message: `E-way bill is not required for invoices of ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`,
    };
  }

  const existing = normalizeEwayBillDoc(invoice.ewayBill);
  if (existing?.pdfStoragePath && existing.status === 'generated') {
    const buffer = await readPdfFromStorage(existing.pdfStoragePath);
    if (buffer) {
      const ext = existing.pdfStoragePath.endsWith('.html') ? 'html' : 'pdf';
      const mimeType = ext === 'html' ? 'text/html' : 'application/pdf';
      return {
        required: true,
        status: 'generated',
        ewaybillNumber: existing.ewaybillNumber,
        contentBase64: buffer.toString('base64'),
        filename: `${invoice.invoiceNumber || invoiceId}-ewaybill.${ext}`,
        mimeType,
        cached: true,
      };
    }
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  let remote = await findZohoEwayBillForInvoice(accessToken, organizationId, invoiceId);
  if (!remote && autoGenerate) {
    if (!partnerId) {
      throw new Error('Delivery partner is required to generate an e-way bill.');
    }
    const partnerGstin = await loadPartnerGstin(getFirestore(), partnerId);
    const transporterName = partnerLabel(partnerId) || partnerId;
    const transporterId = await resolveZohoTransporterId(
      accessToken,
      organizationId,
      partnerGstin,
      transporterName,
    );
    remote = await createZohoEwayBillForInvoice(accessToken, organizationId, {
      invoiceId,
      transporterId,
      lrNumber,
    });
  }

  if (!remote) {
    const doc = await persistEwayBill(customerId, invoiceId, {
      required: true,
      status: autoGenerate ? 'pending' : 'missing',
      partnerId: partnerId || existing?.partnerId || null,
      lrNumber: lrNumber || existing?.lrNumber || null,
    }, bookingId);
    return {
      required: true,
      status: doc.status,
      ewaybillNumber: null,
      message: autoGenerate
        ? 'E-way bill is not generated yet.'
        : 'No e-way bill found in Zoho for this invoice.',
    };
  }

  const mapped = mapZohoEwayBillRecord(remote);
  if (!mapped?.zohoEwaybillId) {
    throw new Error('Zoho returned an invalid e-way bill record.');
  }

  let pdfStoragePath = existing?.pdfStoragePath ?? null;
  let mimeType = 'application/pdf';
  let extension = 'pdf';
  let buffer = pdfStoragePath ? await readPdfFromStorage(pdfStoragePath) : null;

  if (!buffer && mapped.pdfPrintAllowed !== false) {
    const printed = await fetchZohoEwayBillPdf(accessToken, organizationId, mapped.zohoEwaybillId);
    buffer = printed.buffer;
    mimeType = printed.mimeType;
    extension = printed.extension;
    pdfStoragePath = await uploadPdfToStorage(
      ewayBillPdfPath(customerId, invoiceId, extension),
      buffer,
      mimeType,
    );
  }

  const saved = await persistEwayBill(customerId, invoiceId, {
    ...mapped,
    required: true,
    pdfStoragePath,
    partnerId: partnerId || existing?.partnerId || null,
    lrNumber: lrNumber || existing?.lrNumber || null,
    transporterGstin: mapped.transporterGstin || existing?.transporterGstin || null,
    error: null,
  }, bookingId);

  if (!buffer) {
    return {
      required: true,
      status: saved.status,
      ewaybillNumber: saved.ewaybillNumber,
      message: 'E-way bill generated in Zoho but printable copy is not available yet.',
    };
  }

  return {
    required: true,
    status: saved.status || 'generated',
    ewaybillNumber: saved.ewaybillNumber,
    contentBase64: buffer.toString('base64'),
    filename: `${invoice.invoiceNumber || invoiceId}-ewaybill.${extension}`,
    mimeType,
    cached: false,
  };
}

async function deletePdfFromStorage(storagePath) {
  const path = String(storagePath ?? '').trim();
  if (!path) return;
  try {
    const bucket = getStorage().bucket();
    await bucket.file(path).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn(`Could not delete e-way bill file ${path}:`, err?.message ?? err);
  }
}

/**
 * @param {object} secrets
 * @param {string} orgId
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   bookingId?: string | null;
 *   reason: string;
 *   remarks?: string | null;
 * }} input
 */
export async function cancelInvoiceEwayBill(secrets, orgId, input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const bookingId = String(input.bookingId ?? '').trim() || null;
  if (!customerId || !invoiceId) {
    throw new Error('Customer id and invoice id are required.');
  }

  const invoice = await loadInvoiceMirror(customerId, invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found.');
  }

  const existing = normalizeEwayBillDoc(invoice.ewayBill);
  let zohoEwaybillId = existing?.zohoEwaybillId ?? null;

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  if (!zohoEwaybillId) {
    const remote = await findZohoEwayBillForInvoice(accessToken, organizationId, invoiceId);
    zohoEwaybillId = remote?.ewaybill_id ? String(remote.ewaybill_id) : null;
  }

  if (!zohoEwaybillId) {
    throw new Error('No generated e-way bill found for this invoice.');
  }

  if (existing?.status === 'cancelled') {
    return {
      ok: true,
      status: 'cancelled',
      ewaybillNumber: existing.ewaybillNumber ?? null,
      message: 'E-way bill is already cancelled.',
    };
  }

  const remote = await cancelZohoEwayBill(accessToken, organizationId, zohoEwaybillId, {
    reason: input.reason,
    remarks: input.remarks ?? null,
  });
  const mapped = mapZohoEwayBillRecord(remote) ?? {};

  if (existing?.pdfStoragePath) {
    await deletePdfFromStorage(existing.pdfStoragePath);
  }

  const saved = await persistEwayBill(customerId, invoiceId, {
    ...existing,
    ...mapped,
    zohoEwaybillId,
    required: true,
    status: 'cancelled',
    ewaybillNumber: mapped.ewaybillNumber ?? existing?.ewaybillNumber ?? null,
    pdfStoragePath: null,
    error: null,
    cancelReason: String(input.reason ?? ''),
    cancelRemarks: String(input.remarks ?? '').trim() || null,
  }, bookingId);

  return {
    ok: true,
    status: saved.status || 'cancelled',
    ewaybillNumber: saved.ewaybillNumber ?? null,
    message: 'E-way bill cancelled on the GST portal.',
  };
}

export { isEwayBillRequired };
