/**
 * Upsert Zoho Books export CSVs into Firestore (no Zoho API).
 *
 * Usage:
 *   set GOOGLE_APPLICATION_CREDENTIALS=...   (optional; falls back to Firebase CLI ADC)
 *   node scripts/backfill-zoho-export-csv.mjs
 *   node scripts/backfill-zoho-export-csv.mjs --dry-run
 *   node scripts/backfill-zoho-export-csv.mjs --only=items,purchaseOrders
 *   node scripts/backfill-zoho-export-csv.mjs --only=invoices --limit=50
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  classifyInvoiceFromLineItems,
  sumNonFreightQuantity,
} from '../functions/lib/invoice-category.js';
import { getStockStatus } from '../functions/lib/zoho.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'INTERWEIGHING PVT LTD_2026-07-26');
const ORG_ID = '60001225303';
const BATCH_LIMIT = 400;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const onlyArg = [...args].find(a => a.startsWith('--only='));
const limitArg = [...args].find(a => a.startsWith('--limit='));
const only = onlyArg
  ? new Set(onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean))
  : null;
const docLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : null;

function shouldRun(entity) {
  return !only || only.has(entity);
}

function initFirebase() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    const parsed = JSON.parse(
      fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'),
    );
    if (parsed.private_key && parsed.client_email) {
      initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || 'yesweigh-service',
      });
      return;
    }
  }

  const firebaseAdc = path.join(
    process.env.APPDATA || '',
    'firebase',
    'mhdfazalvs_gmail_com_application_default_credentials.json',
  );
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(firebaseAdc)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = firebaseAdc;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId: 'yesweigh-service',
  });
}

function num(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const cleaned = String(value).replace(/^[A-Z]{3}\s+/i, '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function str(value) {
  if (value == null) return '';
  return String(value).trim();
}

function nullable(value) {
  const s = str(value);
  return s || null;
}

function lowerStatus(value, fallback = 'draft') {
  const s = str(value).toLowerCase();
  return s || fallback;
}

function parseSerials(value) {
  if (!value) return [];
  return [...new Set(
    String(value)
      .split(/[\n;,|]+/)
      .map(v => v.trim())
      .filter(Boolean),
  )];
}

function buildSearchBlob(parts) {
  return parts
    .filter(Boolean)
    .map(v => String(v))
    .join(' ')
    .toLowerCase();
}

async function* iterateCsv(file) {
  const parser = fs.createReadStream(file).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    }),
  );
  for await (const row of parser) {
    yield row;
  }
}

async function loadCsvGrouped(files, idCol, { limit = null } = {}) {
  const groups = new Map();
  for (const file of files) {
    for await (const row of iterateCsv(file)) {
      const id = str(row[idCol]);
      if (!id) continue;
      let group = groups.get(id);
      if (!group) {
        if (limit != null && groups.size >= limit) continue;
        group = { id, rows: [] };
        groups.set(id, group);
      }
      group.rows.push(row);
    }
  }
  return groups;
}

class BatchWriter {
  constructor(db, { dryRun = false } = {}) {
    this.db = db;
    this.dryRun = dryRun;
    this.batch = db.batch();
    this.count = 0;
    this.committed = 0;
    this.ops = 0;
  }

  set(ref, data, options) {
    this.ops += 1;
    if (this.dryRun) return;
    this.batch.set(ref, data, options);
    this.count += 1;
    if (this.count >= BATCH_LIMIT) {
      return this.flush();
    }
    return Promise.resolve();
  }

  async flush() {
    if (this.dryRun || this.count === 0) {
      this.count = 0;
      return;
    }
    await this.batch.commit();
    this.committed += this.count;
    this.batch = this.db.batch();
    this.count = 0;
  }
}

async function loadCatalogMeta(db) {
  const snap = await db.collection('catalogProducts').select(
    'imageUrl',
    'hsn',
    'categoryId',
    'categoryName',
    'packageInfo',
    'mrpOverride',
    'modelNumber',
    'approvalNumber',
    'suppressZohoImageImport',
    'displayOrder',
    'hiddenFromCatalog',
    'hiddenFromCatalogAt',
    'hiddenFromCatalogByUid',
    'auditSnapshot',
    'warehouses',
  ).get();
  const map = new Map();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.data() || {});
  }
  return map;
}

async function loadCategoryNameMap(db) {
  const snap = await db.collection('catalogCategories').select('name').get();
  const map = new Map();
  for (const doc of snap.docs) {
    const name = str(doc.data()?.name).toLowerCase();
    if (name) map.set(name, doc.id);
  }
  return map;
}

async function loadSalespersonNameMap(db) {
  const snap = await db.collection('users')
    .where('zohoSalespersonName', '!=', null)
    .select('zohoSalespersonId', 'zohoSalespersonName')
    .get()
    .catch(async () => db.collection('users').select('zohoSalespersonId', 'zohoSalespersonName').get());

  const map = new Map();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const name = str(data.zohoSalespersonName).toLowerCase();
    const id = str(data.zohoSalespersonId);
    if (name && id) map.set(name, id);
  }
  return map;
}

async function loadVendorNameMap() {
  const file = path.join(BASE, 'Vendors.csv');
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for await (const row of iterateCsv(file)) {
    const id = str(row['Contact ID']);
    if (!id) continue;
    for (const key of ['Display Name', 'Contact Name', 'Company Name']) {
      const name = str(row[key]).toLowerCase();
      if (name && !map.has(name)) map.set(name, id);
    }
  }
  return map;
}

function mapLineItem(row, index, catalogMeta, {
  nameCol = 'Item Name',
  descCol = 'Item Desc',
  qtyCol = 'Quantity',
  rateCol = 'Item Price',
  totalCol = 'Item Total',
  productCol = 'Product ID',
} = {}) {
  const itemId = nullable(row[productCol]);
  const meta = itemId ? catalogMeta.get(itemId) : null;
  const quantity = num(row[qtyCol], 0);
  const rate = num(row[rateCol], 0);
  const totalRaw = row[totalCol];
  const total = totalRaw === '' || totalRaw == null ? quantity * rate : num(totalRaw, 0);
  const hsn = nullable(row['HSN/SAC']) ?? (meta?.hsn != null ? String(meta.hsn) : null);
  const serialNumbers = parseSerials(row['Serial Numbers']);
  const name = str(row[nameCol]) || str(row[descCol]).split('\n')[0] || 'Item';
  return {
    id: itemId || `csv-${index + 1}`,
    itemId,
    name,
    description: nullable(row[descCol]),
    sku: nullable(row.SKU),
    quantity,
    rate,
    total,
    imageUrl: meta?.imageUrl != null ? String(meta.imageUrl) : null,
    hsn,
    serialNumbers,
  };
}

function resolveSalesperson(row, nameMap) {
  const name = nullable(row['Sales person']);
  const idFromCsv = nullable(
    row['Sales Person ID']
    ?? row['Salesperson ID']
    ?? row.salesperson_id,
  );
  const id = idFromCsv || (name ? (nameMap.get(name.toLowerCase()) ?? null) : null);
  return { salespersonId: id, salespersonName: name };
}

async function backfillItems(db, writer, { catalogMeta, categoryNameMap, limit }) {
  const file = path.join(BASE, 'Item.csv');
  console.log('\n[items] reading', file);
  const groups = await loadCsvGrouped([file], 'Item ID', { limit });
  console.log(`[items] ${groups.size} unique items`);

  let written = 0;
  for (const [id, group] of groups) {
    const row = group.rows[0];
    const existing = catalogMeta.get(id) || {};
    const name = str(row['Item Name']) || existing.name || 'Unnamed product';
    const sku = nullable(row.SKU);
    const description = nullable(row.Description) ?? nullable(row['Item Description']);
    const unit = str(row['Usage unit'] || row['Unit Name'] || existing.unit || 'pcs') || 'pcs';
    const rate = num(row.Rate, Number(existing.rate ?? 0));
    const stock = num(row['Stock On Hand'], Number(existing.stock ?? 0));
    const reorderLevel = num(row['Reorder Point'], Number(existing.reorderLevel ?? 0));
    const categoryName = nullable(row['Category Name']);
    const categoryId = categoryName
      ? (categoryNameMap.get(categoryName.toLowerCase()) ?? existing.categoryId ?? null)
      : (existing.categoryId ?? null);
    const status = lowerStatus(row.Status, existing.status || 'active');
    const hsn = nullable(row['HSN/SAC']);
    const taxName = nullable(row['Intra State Tax Name']) ?? nullable(row['Inter State Tax Name']);
    const taxPercentage = num(
      row['Intra State Tax Rate'] || row['Inter State Tax Rate'],
      Number(existing.taxPercentage ?? 0),
    );

    const doc = {
      id,
      name,
      sku,
      description,
      unit,
      rate,
      stock,
      stockStatus: getStockStatus(stock, reorderLevel),
      imageUrl: existing.imageUrl ?? null,
      categoryId: categoryId != null ? String(categoryId) : null,
      categoryName: categoryName ?? (existing.categoryName ?? null),
      status,
      hsn,
      taxName,
      taxPercentage,
      reorderLevel,
      warehouses: Array.isArray(existing.warehouses) ? existing.warehouses : [],
      syncedAt: new Date().toISOString(),
      organizationId: ORG_ID,
      contentFingerprint: `csv-export|${id}|${Date.now()}`,
    };

    if (existing.suppressZohoImageImport && !doc.imageUrl) {
      doc.suppressZohoImageImport = true;
    }
    if (existing.packageInfo) doc.packageInfo = existing.packageInfo;
    if (Number.isFinite(Number(existing.mrpOverride)) && Number(existing.mrpOverride) > 0) {
      doc.mrpOverride = Number(existing.mrpOverride);
    }
    if (existing.modelNumber) doc.modelNumber = existing.modelNumber;
    if (existing.approvalNumber) doc.approvalNumber = existing.approvalNumber;
    if (Number.isFinite(existing.displayOrder)) doc.displayOrder = existing.displayOrder;
    if (existing.hiddenFromCatalog === true) {
      doc.hiddenFromCatalog = true;
      if (existing.hiddenFromCatalogAt) doc.hiddenFromCatalogAt = existing.hiddenFromCatalogAt;
      if (existing.hiddenFromCatalogByUid) {
        doc.hiddenFromCatalogByUid = existing.hiddenFromCatalogByUid;
      }
    }
    if (existing.auditSnapshot) doc.auditSnapshot = existing.auditSnapshot;

    await writer.set(db.collection('catalogProducts').doc(id), doc, { merge: true });
    written += 1;
    if (written % 200 === 0) console.log(`[items] queued ${written}/${groups.size}`);
  }
  await writer.flush();
  console.log(`[items] done — ${written} upserts (${dryRun ? 'dry-run' : 'written'})`);
  return { entity: 'items', unique: groups.size, written };
}

async function backfillPurchaseOrders(db, writer, {
  catalogMeta,
  vendorNameMap,
  limit,
}) {
  const file = path.join(BASE, 'Purchase_Order.csv');
  console.log('\n[purchaseOrders] reading', file);
  const groups = await loadCsvGrouped([file], 'Purchase Order ID', { limit });
  console.log(`[purchaseOrders] ${groups.size} unique POs`);

  let written = 0;
  let missingVendor = 0;
  for (const [id, group] of groups) {
    const header = group.rows[0];
    const lineItems = group.rows
      .filter(r =>
        str(r['Item Name'])
        || str(r['Product ID'])
        || str(r.SKU)
        || num(r.QuantityOrdered, 0) !== 0
        || num(r['Item Total'], 0) !== 0
        || num(r['Item Price'], 0) !== 0
      )
      .map((r, i) => mapLineItem(r, i, catalogMeta, {
        qtyCol: 'QuantityOrdered',
      }));

    const vendorName = nullable(header['Vendor Name']);
    const vendorId = vendorName
      ? (vendorNameMap.get(vendorName.toLowerCase()) ?? '')
      : '';
    if (vendorName && !vendorId) missingVendor += 1;

    const catalogByItemId = new Map();
    for (const line of lineItems) {
      if (!line.itemId) continue;
      const meta = catalogMeta.get(line.itemId);
      if (meta) {
        catalogByItemId.set(line.itemId, {
          hsn: meta.hsn ?? null,
          categoryId: meta.categoryId ?? null,
          categoryName: meta.categoryName ?? null,
        });
      }
    }

    const mapped = {
      id,
      purchaseOrderNumber: str(header['Purchase Order Number']),
      date: nullable(header['Purchase Order Date']),
      deliveryDate: nullable(header['Delivery Date']) ?? nullable(header['Expected Arrival Date']),
      status: lowerStatus(header['Purchase Order Status'], 'draft'),
      total: num(header.Total, 0),
      balance: num(header.Balance, num(header.Total, 0)),
      referenceNumber: nullable(header['Reference#'] || header['Reference No']),
      currencyCode: str(header['Currency Code']) || 'INR',
      vendorId,
      vendorName,
      subtotal: num(header.SubTotal, 0),
      taxTotal: group.rows.reduce((sum, r) => sum + num(r['Item Tax Amount'], 0), 0),
      notes: nullable(header['Delivery Instructions']),
      lineItems,
    };

    const doc = {
      ...mapped,
      searchBlob: buildSearchBlob([
        mapped.purchaseOrderNumber,
        mapped.vendorName,
        mapped.vendorId,
        mapped.referenceNumber,
        mapped.status,
        ...lineItems.flatMap(l => [l.name, l.sku]),
      ]),
      purchaseOrderCategory: classifyInvoiceFromLineItems(lineItems, catalogByItemId),
      itemQuantity: sumNonFreightQuantity(lineItems),
      syncedAt: FieldValue.serverTimestamp(),
      contentFingerprint: `csv-export|${id}|${lineItems.length}|${mapped.total}`,
      zohoLastModified: null,
    };

    await writer.set(db.collection('purchaseOrders').doc(id), doc, { merge: true });
    written += 1;
  }
  await writer.flush();
  console.log(
    `[purchaseOrders] done — ${written} upserts`
    + (missingVendor ? `, ${missingVendor} missing vendorId` : '')
    + (dryRun ? ' (dry-run)' : ''),
  );
  return { entity: 'purchaseOrders', unique: groups.size, written, missingVendor };
}

async function backfillSalesOrders(db, writer, {
  catalogMeta,
  salespersonNameMap,
  limit,
}) {
  const files = [
    path.join(BASE, 'Sales_Order_extracted', 'Sales_Order00.csv'),
    path.join(BASE, 'Sales_Order_extracted', 'Sales_Order01.csv'),
  ];
  console.log('\n[salesOrders] reading', files.length, 'files');
  const groups = await loadCsvGrouped(files, 'SalesOrder ID', { limit });
  console.log(`[salesOrders] ${groups.size} unique SOs`);

  let written = 0;
  for (const [id, group] of groups) {
    const header = group.rows[0];
    const lineItems = group.rows
      .filter(r =>
        str(r['Item Name'])
        || str(r['Product ID'])
        || str(r.SKU)
        || num(r.QuantityOrdered, 0) !== 0
        || num(r['Item Total'], 0) !== 0
        || num(r['Item Price'], 0) !== 0
      )
      .map((r, i) => mapLineItem(r, i, catalogMeta, {
        qtyCol: 'QuantityOrdered',
      }));

    const { salespersonId, salespersonName } = resolveSalesperson(header, salespersonNameMap);
    const catalogByItemId = new Map();
    for (const line of lineItems) {
      if (!line.itemId) continue;
      const meta = catalogMeta.get(line.itemId);
      if (meta) {
        catalogByItemId.set(line.itemId, {
          hsn: meta.hsn ?? null,
          categoryId: meta.categoryId ?? null,
          categoryName: meta.categoryName ?? null,
        });
      }
    }

    const mapped = {
      id,
      salesOrderNumber: str(header['SalesOrder Number']),
      date: nullable(header['Order Date']),
      shipmentDate: nullable(header['Expected Shipment Date']),
      status: lowerStatus(header.Status, 'draft'),
      total: num(header.Total, 0),
      balance: num(header.Balance, num(header.Total, 0)),
      referenceNumber: nullable(header['Reference#']),
      currencyCode: str(header['Currency Code']) || 'INR',
      customerId: str(header['Customer ID']),
      customerName: nullable(header['Customer Name']),
      salespersonId,
      salespersonName,
      shippingAddress: null,
      shippingAddressId: null,
      subtotal: num(header.SubTotal, 0),
      taxTotal: group.rows.reduce((sum, r) => sum + num(r['Item Tax Amount'], 0), 0),
      notes: nullable(header.Notes),
      lineItems,
    };

    const doc = {
      ...mapped,
      searchBlob: buildSearchBlob([
        mapped.salesOrderNumber,
        mapped.customerName,
        mapped.customerId,
        mapped.referenceNumber,
        mapped.status,
        mapped.salespersonName,
        ...lineItems.flatMap(l => [l.name, l.sku]),
      ]),
      salesOrderCategory: classifyInvoiceFromLineItems(lineItems, catalogByItemId),
      itemQuantity: sumNonFreightQuantity(lineItems),
      syncedAt: FieldValue.serverTimestamp(),
      contentFingerprint: `csv-export|${id}|${lineItems.length}|${mapped.total}`,
      zohoLastModified: null,
    };

    await writer.set(db.collection('salesOrders').doc(id), doc, { merge: true });
    written += 1;
    if (written % 1000 === 0) console.log(`[salesOrders] queued ${written}/${groups.size}`);
  }
  await writer.flush();
  console.log(`[salesOrders] done — ${written} upserts${dryRun ? ' (dry-run)' : ''}`);
  return { entity: 'salesOrders', unique: groups.size, written };
}

async function backfillInvoices(db, writer, {
  catalogMeta,
  salespersonNameMap,
  limit,
}) {
  const files = [
    path.join(BASE, 'Invoice_extracted', 'Invoice00.csv'),
    path.join(BASE, 'Invoice_extracted', 'Invoice01.csv'),
  ];
  console.log('\n[invoices] reading', files.length, 'files');
  const groups = await loadCsvGrouped(files, 'Invoice ID', { limit });
  console.log(`[invoices] ${groups.size} unique invoices`);

  let written = 0;
  let skipped = 0;
  for (const [id, group] of groups) {
    const header = group.rows[0];
    const customerId = str(header['Customer ID']);
    if (!customerId) {
      skipped += 1;
      continue;
    }

    const lineItems = group.rows
      .filter(r =>
        str(r['Item Name'])
        || str(r['Product ID'])
        || str(r.SKU)
        || num(r.Quantity, 0) !== 0
        || num(r['Item Total'], 0) !== 0
        || num(r['Item Price'], 0) !== 0
      )
      .map((r, i) => mapLineItem(r, i, catalogMeta, {
        qtyCol: 'Quantity',
      }));

    const { salespersonId, salespersonName } = resolveSalesperson(header, salespersonNameMap);
    const catalogByItemId = new Map();
    for (const line of lineItems) {
      if (!line.itemId) continue;
      const meta = catalogMeta.get(line.itemId);
      if (meta) {
        catalogByItemId.set(line.itemId, {
          hsn: meta.hsn ?? null,
          categoryId: meta.categoryId ?? null,
          categoryName: meta.categoryName ?? null,
        });
      }
    }

    const invoiceNumber = str(header['Invoice Number']);
    const date = nullable(header['Invoice Date']);
    const total = num(header.Total, 0);
    const mergedHeader = {
      invoiceNumber,
      date,
      dueDate: nullable(header['Due Date']),
      status: lowerStatus(header['Invoice Status'], 'sent'),
      total,
      balance: num(header.Balance, 0),
      subtotal: num(header.SubTotal, null),
      taxTotal: group.rows.reduce((sum, r) => sum + num(r['Item Tax Amount'], 0), 0),
      currencyCode: str(header['Currency Code']) || 'INR',
      customerName: nullable(header['Customer Name']),
      referenceNumber: nullable(header.PurchaseOrder) ?? nullable(header['Reference Invoice#']),
      lastPaymentDate: nullable(header['Last Payment Date']),
      salespersonId,
      salespersonName,
      invoiceUrl: null,
      salesOrderId: null,
      salesOrderNumber: nullable(header['Sales Order Number']),
      notes: nullable(header.Notes),
      invoiceCategory: classifyInvoiceFromLineItems(lineItems, catalogByItemId) || 'product',
    };

    const doc = {
      id,
      customerId,
      ...mergedHeader,
      lineItems,
      searchBlob: buildSearchBlob([
        mergedHeader.invoiceNumber,
        mergedHeader.referenceNumber,
        mergedHeader.customerName,
        mergedHeader.notes,
        mergedHeader.salespersonName,
        ...lineItems.flatMap(l => [l.name, l.description, l.sku, ...(l.serialNumbers || [])]),
      ]),
      contentFingerprint: `csv-export|${id}|${lineItems.length}|${total}`,
      syncedAt: FieldValue.serverTimestamp(),
      zohoLastModified: null,
    };

    const invRef = db.collection('zohoCustomers').doc(customerId).collection('invoices').doc(id);
    await writer.set(invRef, doc, { merge: true });
    await writer.set(
      db.collection('invoiceIndex').doc(id),
      { customerId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    written += 1;
    if (written % 1000 === 0) console.log(`[invoices] queued ${written}/${groups.size}`);
  }
  await writer.flush();
  console.log(
    `[invoices] done — ${written} upserts`
    + (skipped ? `, ${skipped} skipped (no customerId)` : '')
    + (dryRun ? ' (dry-run)' : ''),
  );
  return { entity: 'invoices', unique: groups.size, written, skipped };
}

async function main() {
  if (!fs.existsSync(BASE)) {
    console.error('Backup folder not found:', BASE);
    process.exit(1);
  }

  initFirebase();
  const db = getFirestore();
  const writer = new BatchWriter(db, { dryRun });

  console.log(`Zoho CSV backfill → yesweigh-service${dryRun ? ' (DRY RUN)' : ''}`);
  console.log('Folder:', BASE);
  if (only) console.log('Only:', [...only].join(', '));
  if (docLimit) console.log('Limit per entity:', docLimit);

  console.log('\nLoading lookup maps…');
  const [catalogMeta, categoryNameMap, salespersonNameMap, vendorNameMap] = await Promise.all([
    loadCatalogMeta(db),
    loadCategoryNameMap(db),
    loadSalespersonNameMap(db),
    loadVendorNameMap(),
  ]);
  console.log(
    `catalog=${catalogMeta.size}, categories=${categoryNameMap.size}, `
    + `salespersons=${salespersonNameMap.size}, vendors=${vendorNameMap.size}`,
  );

  const summaries = [];
  const limit = Number.isFinite(docLimit) && docLimit > 0 ? docLimit : null;

  if (shouldRun('items')) {
    summaries.push(await backfillItems(db, writer, { catalogMeta, categoryNameMap, limit }));
    // Refresh catalog meta so SO/PO/invoice lines pick up freshly written HSN/category.
    if (!dryRun) {
      const refreshed = await loadCatalogMeta(db);
      catalogMeta.clear();
      for (const [k, v] of refreshed) catalogMeta.set(k, v);
    }
  }
  if (shouldRun('purchaseOrders')) {
    summaries.push(await backfillPurchaseOrders(db, writer, {
      catalogMeta,
      vendorNameMap,
      limit,
    }));
  }
  if (shouldRun('salesOrders')) {
    summaries.push(await backfillSalesOrders(db, writer, {
      catalogMeta,
      salespersonNameMap,
      limit,
    }));
  }
  if (shouldRun('invoices')) {
    summaries.push(await backfillInvoices(db, writer, {
      catalogMeta,
      salespersonNameMap,
      limit,
    }));
  }

  await writer.flush();
  console.log('\n=== Summary ===');
  console.log(JSON.stringify({ dryRun, opsQueued: writer.ops, committed: writer.committed, summaries }, null, 2));
}

main().catch(err => {
  console.error('Backfill failed:', err?.stack || err?.message || err);
  process.exit(1);
});
