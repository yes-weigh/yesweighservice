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
  addZohoEwayBillVehicle,
  fetchZohoEwayBillPdf,
  findZohoEwayBillForInvoice,
  mapZohoEwayBillRecord,
  normalizeGstin,
  resolveTransporterForPartner,
} from './zoho-ewaybills.js';
import {
  ewayVehicleOriginFromAddress,
  resolveEwayShippingContext,
} from './eway-shipping-context.js';

export const EWAY_BILL_THRESHOLD_INR = 50_000;
const PICKUP_PARTNER_ID = 'personal_collection';

function normalizeVehicleNumber(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 20);
}

function isEwayBillRequired(totalInclGst) {
  const total = Number(totalInclGst);
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
    requiredBecause: raw.requiredBecause === 'clubbed_lr' ? 'clubbed_lr' : (raw.requiredBecause === 'invoice_total' ? 'invoice_total' : null),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

function rollupBookingEway(invoices) {
  const rows = Array.isArray(invoices) ? invoices : [];
  const required = rows.filter(row => row?.ewayRequired === true);
  if (!required.length) {
    return { ewayBillNumber: null, ewayBillStatus: null };
  }
  if (required.every(row => String(row.ewayBillStatus || '') === 'generated')) {
    return {
      ewayBillNumber: required[0]?.ewayBillNumber ?? null,
      ewayBillStatus: 'generated',
    };
  }
  if (required.some(row => String(row.ewayBillStatus || '') === 'cancelled')) {
    return { ewayBillNumber: null, ewayBillStatus: 'cancelled' };
  }
  return { ewayBillNumber: null, ewayBillStatus: 'missing' };
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
    const bookingRef = db.collection('logisticsBookings').doc(String(bookingId));
    const snap = await bookingRef.get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const invoices = Array.isArray(data.invoices)
      ? data.invoices.map((row) => {
        if (!row || typeof row !== 'object') return row;
        if (String(row.invoiceId || '') !== String(invoiceId)) return row;
        return {
          ...row,
          ewayBillNumber: normalized.ewaybillNumber ?? row.ewayBillNumber ?? null,
          ewayBillStatus: normalized.status ?? row.ewayBillStatus ?? null,
          ewayRequired: normalized.required !== false,
        };
      })
      : [];
    const rollup = invoices.length
      ? rollupBookingEway(invoices)
      : {
        ewayBillNumber: normalized.ewaybillNumber ?? null,
        ewayBillStatus: normalized.status ?? null,
      };
    await bookingRef.set({
      ...(invoices.length ? { invoices } : {}),
      ewayBillNumber: rollup.ewayBillNumber,
      ewayBillStatus: rollup.ewayBillStatus,
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
  const invoice = await loadInvoiceMirror(customerId, invoiceId);
  const existing = normalizeEwayBillDoc(invoice?.ewayBill);
  if (!isEwayBillRequired(total) && existing?.requiredBecause !== 'clubbed_lr') {
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
   *   forceRequired?: boolean;
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
  const existing = normalizeEwayBillDoc(invoice.ewayBill);
  const forceRequired = input.forceRequired === true
    || existing?.requiredBecause === 'clubbed_lr';
  if (!forceRequired && !isEwayBillRequired(invoiceTotal)) {
    const doc = await persistEwayBill(customerId, invoiceId, {
      required: false,
      status: 'not_required',
    }, bookingId);
    return {
      required: false,
      status: doc.status,
      ewaybillNumber: null,
      message: `E-way bill is not required for invoice totals incl. GST of ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`,
    };
  }
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

  const db = getFirestore();
  const pickupVehicle = normalizeVehicleNumber(invoice.customerPickup?.vehicleNumber);
  const isCustomerPickup = partnerId === PICKUP_PARTNER_ID
    || Boolean(String(invoice.customerPickup?.markedAt ?? '').trim());
  const transporterDocumentNumber = isCustomerPickup ? '' : lrNumber;

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  let remote = await findZohoEwayBillForInvoice(accessToken, organizationId, invoiceId);
  let shippingContext = null;
  if (!remote && autoGenerate) {
    if (!partnerId) {
      throw new Error('Delivery partner is required to generate an e-way bill.');
    }
    const { transporterId } = await resolveTransporterForPartner(
      accessToken,
      organizationId,
      db,
      partnerId,
    );
    shippingContext = await resolveEwayShippingContext(db, {
      bookingId,
      customerId,
      invoiceId,
      invoice,
      shipFromSite: invoice.customerPickup?.shipFromSite,
    });
    if (!shippingContext?.shipFromAddress) {
      throw new Error(
        'Ship-from address is missing on this shipment. '
        + 'Apply the site address from Logistics settings, then retry e-way bill generation.',
      );
    }
    remote = await createZohoEwayBillForInvoice(accessToken, organizationId, {
      invoiceId,
      transporterId,
      lrNumber: transporterDocumentNumber,
      shipFromAddress: shippingContext.shipFromAddress,
      deliveryAddress: shippingContext.deliveryAddress || invoice.shippingAddress || null,
      shipFromSite: shippingContext.shipFromSite,
      vehicleNumber: pickupVehicle || null,
      db,
    });
  }

  if (!remote) {
    const doc = await persistEwayBill(customerId, invoiceId, {
      required: true,
      status: autoGenerate ? 'pending' : 'missing',
      partnerId: partnerId || existing?.partnerId || null,
      lrNumber: transporterDocumentNumber || existing?.lrNumber || null,
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

  if (autoGenerate && isCustomerPickup && pickupVehicle) {
    if (!shippingContext?.shipFromAddress) {
      shippingContext = await resolveEwayShippingContext(db, {
        bookingId,
        customerId,
        invoiceId,
        invoice,
        shipFromSite: invoice.customerPickup?.shipFromSite,
      });
    }
    if (!shippingContext?.shipFromAddress) {
      throw new Error(
        'Ship-from address is missing on this shipment. '
        + 'Apply the site address from Logistics settings, then retry e-way bill generation.',
      );
    }
    const { fromPlace, fromState } = ewayVehicleOriginFromAddress(shippingContext.shipFromAddress);
    try {
      await addZohoEwayBillVehicle(accessToken, organizationId, mapped.zohoEwaybillId, {
        vehicleNumber: pickupVehicle,
        fromPlace,
        fromState,
        reason: 'first_time',
        remarks: 'Customer pickup',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already|exist|duplicate/i.test(message)) throw err;
    }
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
    requiredBecause: forceRequired ? 'clubbed_lr' : 'invoice_total',
    pdfStoragePath,
    partnerId: partnerId || existing?.partnerId || null,
    lrNumber: transporterDocumentNumber || existing?.lrNumber || null,
    ...(pickupVehicle ? { vehicleNumber: pickupVehicle } : {}),
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

function formatEwayBillCancelError(message) {
  const text = String(message ?? '').trim();
  if (/api access is not available/i.test(text)) {
    return (
      'Zoho could not reach the GST e-way bill portal (API access is not available). '
      + 'Cancel the e-way bill in Zoho Inventory → E-Way Bills → Actions → Cancel, '
      + 'or fix GSP/API credentials under E-Way Bill Portal settings in Zoho. '
      + 'You can also clear it locally here to retest logistics — the GST record may still be active.'
    );
  }
  if (/24 hour|verified during transit|cannot be cancel/i.test(text)) {
    return `${text} Cancel from Zoho Inventory within 24 hours of generation if still allowed.`;
  }
  return text || 'Could not cancel e-way bill on the GST portal.';
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
 *   localOnly?: boolean;
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

  const localOnly = input.localOnly === true;
  let mapped = {};

  if (localOnly) {
    if (existing?.pdfStoragePath) {
      await deletePdfFromStorage(existing.pdfStoragePath);
    }
    const saved = await persistEwayBill(customerId, invoiceId, {
      ...existing,
      zohoEwaybillId,
      required: true,
      status: 'cancelled',
      ewaybillNumber: existing?.ewaybillNumber ?? null,
      pdfStoragePath: null,
      error: 'Cancelled locally — GST portal may still show this e-way bill as active.',
      cancelReason: String(input.reason ?? ''),
      cancelRemarks: String(input.remarks ?? '').trim() || null,
    }, bookingId);
    return {
      ok: true,
      status: saved.status || 'cancelled',
      ewaybillNumber: saved.ewaybillNumber ?? null,
      localOnly: true,
      message: 'E-way bill cleared locally for retest. Cancel it in Zoho Inventory if the GST portal still shows it active.',
    };
  }

  try {
    const remote = await cancelZohoEwayBill(accessToken, organizationId, zohoEwaybillId, {
      reason: input.reason,
      remarks: input.remarks ?? null,
    });
    mapped = mapZohoEwayBillRecord(remote) ?? {};
  } catch (err) {
    throw new Error(formatEwayBillCancelError(err instanceof Error ? err.message : String(err)));
  }

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

/**
 * Generate (or fetch) e-way bill for customer pickup, then update Part B with vehicle number.
 * @param {object} secrets
 * @param {string} orgId
 * @param {{
 *   customerId: string;
 *   invoiceId: string;
 *   shipFromSite?: string | null;
 *   vehicleNumber: string;
 * }} input
 */
export async function ensureInvoiceEwayBillForCustomerPickup(secrets, orgId, input) {
  const customerId = String(input.customerId ?? '').trim();
  const invoiceId = String(input.invoiceId ?? '').trim();
  const shipFromSite = String(input.shipFromSite ?? 'cochin').trim() || 'cochin';
  const vehicleNumber = normalizeVehicleNumber(input.vehicleNumber);
  if (!vehicleNumber) {
    throw new Error('Vehicle number is required to generate e-way bill Part B for customer pickup.');
  }

  const db = getFirestore();
  const invoice = await loadInvoiceMirror(customerId, invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found in portal. Sync invoices from Zoho first.');
  }

  const invoiceTotal = Number(invoice.total ?? 0);
  if (!isEwayBillRequired(invoiceTotal)) {
    return {
      required: false,
      status: 'not_required',
      ewaybillNumber: null,
      message: `E-way bill is not required for invoice totals incl. GST of ₹${EWAY_BILL_THRESHOLD_INR.toLocaleString('en-IN')} or below.`,
    };
  }

  const shippingContext = await resolveEwayShippingContext(db, {
    customerId,
    invoiceId,
    invoice,
    shipFromSite,
  });
  if (!shippingContext?.shipFromAddress) {
    throw new Error(
      'Ship-from address is missing. Apply the site address from Logistics settings, then retry.',
    );
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const partnerId = PICKUP_PARTNER_ID;

  let remote = await findZohoEwayBillForInvoice(accessToken, organizationId, invoiceId);
  if (mapZohoEwayBillRecord(remote)?.status === 'cancelled') remote = null;
  if (!remote) {
    const { transporterId } = await resolveTransporterForPartner(
      accessToken,
      organizationId,
      db,
      partnerId,
    );
    remote = await createZohoEwayBillForInvoice(accessToken, organizationId, {
      invoiceId,
      transporterId,
      lrNumber: null,
      shipFromAddress: shippingContext.shipFromAddress,
      deliveryAddress: shippingContext.deliveryAddress || invoice.shippingAddress || null,
      shipFromSite: shippingContext.shipFromSite,
      vehicleNumber,
      db,
    });
  }

  const mapped = mapZohoEwayBillRecord(remote);
  if (!mapped?.zohoEwaybillId) {
    throw new Error('Zoho returned an invalid e-way bill record.');
  }
  if (mapped.status === 'cancelled') {
    throw new Error(
      'The latest e-way bill on this invoice is cancelled. '
      + 'Generate a new e-way bill in Zoho with vehicle '
      + `${vehicleNumber} (Part B), then tap E way bill here again.`,
    );
  }

  const { fromPlace, fromState } = ewayVehicleOriginFromAddress(shippingContext.shipFromAddress);
  try {
    await addZohoEwayBillVehicle(accessToken, organizationId, mapped.zohoEwaybillId, {
      vehicleNumber,
      fromPlace,
      fromState,
      reason: 'first_time',
      remarks: 'Customer pickup',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already|exist|duplicate|API access|cancel/i.test(message)) throw err;
  }

  const refreshed = await findZohoEwayBillForInvoice(accessToken, organizationId, invoiceId);
  const finalMapped = mapZohoEwayBillRecord(refreshed) ?? mapped;

  let pdfStoragePath = null;
  let mimeType = 'application/pdf';
  let extension = 'pdf';
  let buffer = null;

  if (finalMapped.pdfPrintAllowed !== false) {
    const printed = await fetchZohoEwayBillPdf(accessToken, organizationId, finalMapped.zohoEwaybillId);
    buffer = printed.buffer;
    mimeType = printed.mimeType;
    extension = printed.extension;
    const printText = mimeType.includes('html') || mimeType.includes('text')
      ? buffer.toString('utf8')
      : '';
    if (/e-?way bill status[\s\S]{0,120}cancell/i.test(printText)) {
      await persistEwayBill(customerId, invoiceId, {
        ...finalMapped,
        required: true,
        status: 'cancelled',
        pdfStoragePath: null,
        partnerId,
        error: 'GST copy is cancelled.',
      }, null);
      throw new Error(
        'Zoho returned a cancelled e-way bill copy. '
        + `Generate a new e-way bill in Zoho with vehicle ${vehicleNumber} (Part B), `
        + 'then tap E way bill here again.',
      );
    }
    pdfStoragePath = await uploadPdfToStorage(
      ewayBillPdfPath(customerId, invoiceId, extension),
      buffer,
      mimeType,
    );
  }

  const saved = await persistEwayBill(customerId, invoiceId, {
    ...finalMapped,
    required: true,
    pdfStoragePath,
    partnerId,
    lrNumber: null,
    vehicleNumber,
    partBUpdatedAt: new Date().toISOString(),
    error: null,
  }, null);

  if (!buffer) {
    return {
      required: true,
      status: saved.status,
      ewaybillNumber: saved.ewaybillNumber,
      message: 'E-way bill Part B updated; printable copy is not available yet.',
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

export { isEwayBillRequired };
