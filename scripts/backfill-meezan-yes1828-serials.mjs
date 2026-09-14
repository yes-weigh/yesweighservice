/**
 * Replace YES/26-27/1828 serials with MY2501–MY2525, update Zoho,
 * and push Meezan RC serials + quota to YesGATC.
 *
 *   node scripts/backfill-meezan-yes1828-serials.mjs
 *   node scripts/backfill-meezan-yes1828-serials.mjs --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { clientId as firebaseCliClientId, clientSecret as firebaseCliClientSecret } from 'firebase-tools/lib/api.js';
import { applySerialsToLine } from '../functions/lib/non-gatc-serial-allot.js';
import { YESGATC_RC_OV_QUOTA } from '../functions/lib/yesgatc-sold-push.js';
import { YESGATC_SERIAL_ALLOTTED, YESGATC_SERIAL_UPDATED } from '../functions/lib/yesgatc-serial-push.js';

const APPLY = process.argv.includes('--apply');
const CUSTOMER_ID = '99381000000112170';
const INVOICE_ID = '99381000032308997';
const INVOICE_NUMBER = 'YES/26-27/1828';
const FROM = 'MY2501';
const TO = 'MY2525';
const SERIALS = Array.from({ length: 25 }, (_, i) => `MY${2501 + i}`);
const ACTOR = 'YESWEIGH Meezan YES1828 backfill';
const PROJECT = 'yesweigh-service';
const LINE_ID = '99381000032315002';
const ITEM_ID = '99381000027934052';
const ORG_ID = '60001225303';
const RC = {
  rcId: 'RrATBmrZNugRwhndFOpLJE2TmcE2',
  rcCode: 'MZN',
  rcName: 'Meezan electronic scales pvt ltd',
  dealerId: CUSTOMER_ID,
  dealerName: 'MEEZAN ELECTRONIC SCALES PRIVATE LIMITED',
  place: 'Malappuram',
};

const tokensPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');

async function googleAccessToken() {
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8')).tokens;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: firebaseCliClientId(),
      client_secret: firebaseCliClientSecret(),
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await res.json();
  if (!payload.access_token) throw new Error(payload.error_description || 'Google token failed');
  return payload.access_token;
}

function decodeValue(value) {
  if (!value) return null;
  if (value.stringValue != null) return value.stringValue;
  if (value.integerValue != null) return Number(value.integerValue);
  if (value.doubleValue != null) return value.doubleValue;
  if (value.booleanValue != null) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) {
    const out = {};
    for (const [key, nested] of Object.entries(value.mapValue.fields || {})) {
      out[key] = decodeValue(nested);
    }
    return out;
  }
  return null;
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      fields[key] = encodeValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function encodeFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

async function firestore(token, pathname, { method = 'GET', body } = {}) {
  const url = pathname.startsWith('http')
    ? pathname
    : `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `Firestore ${method} ${pathname} failed (${res.status})`);
  }
  return json;
}

async function getDocument(token, docPath) {
  const json = await firestore(token, `documents/${docPath}`);
  return decodeValue({ mapValue: { fields: json.fields } }) || {};
}

async function accessSecret(token, name) {
  const res = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${name}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Secret ${name} failed`);
  return Buffer.from(json.payload.data, 'base64').toString('utf8').trim();
}

async function zohoToken(secrets) {
  const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
      refresh_token: secrets.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(json.error || 'Zoho token failed');
  return json.access_token;
}

async function zohoJson(accessToken, pathname, { method = 'GET', body } = {}) {
  const url = new URL(`https://www.zohoapis.in/inventory/v1${pathname}`);
  url.searchParams.set('organization_id', ORG_ID);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(json.message || `Zoho ${method} ${pathname} failed`);
  }
  return json;
}

async function postYesGatc(url, secret, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(secret ? {
        'x-yesgatc-secret': secret,
        'x-yesweigh-secret': secret,
        'x-webhook-secret': secret,
        authorization: `Bearer ${secret}`,
      } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json?.message || json?.error || text || `YesGATC HTTP ${res.status}`);
  return json;
}

function withSerialDescription(description, serials) {
  const base = String(description || '').replace(/\n*Serial Numbers:\s*[^\n]*/gi, '').replace(/\s+$/g, '');
  const block = `Serial Numbers: ${serials.join(', ')}`;
  return base ? `${base}\n${block}` : block;
}

const token = await googleAccessToken();
const invoice = await getDocument(token, `zohoCustomers/${CUSTOMER_ID}/invoices/${INVOICE_ID}`);
const lines = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
const currentSerials = lines.flatMap(line => Array.isArray(line.serialNumbers) ? line.serialNumbers : []);
const allotDoc = await getDocument(token, 'appSettings/serialNumberAllotment');
const webhookSettings = await getDocument(token, 'appSettings/yesgatcWebhook');
const existingRange = (allotDoc.allotments || []).find(row => (
  String(row.from || '').toUpperCase() === FROM && String(row.to || '').toUpperCase() === TO
));

console.log(JSON.stringify({
  apply: APPLY,
  invoiceNumber: invoice.invoiceNumber,
  invoiceId: INVOICE_ID,
  customerId: CUSTOMER_ID,
  status: invoice.status,
  listStatus: invoice.listStatus,
  rc: { code: invoice.yesgatcRcCode || RC.rcCode, name: invoice.yesgatcRcName || RC.rcName },
  currentSerials,
  currentCount: currentSerials.length,
  yesgatcLinks: (invoice.yesgatcLinks || []).length,
  alreadyPushedAt: invoice.yesgatcRcPushedAt || null,
  desiredSerials: SERIALS,
  rangeExists: Boolean(existingRange),
}, null, 2));

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to replace serials and push Zoho + YesGATC.');
  process.exit(0);
}

const now = new Date().toISOString();
const nextLine = applySerialsToLine(lines.find(line => String(line.id) === LINE_ID) || {
  id: LINE_ID,
  itemId: ITEM_ID,
  name: 'WEIGHING SCALE PARTS',
  sku: 'PCSLEC',
  quantity: 25,
  hsn: '84238190',
}, SERIALS);
const nextLines = lines.map(line => (String(line.id) === LINE_ID ? nextLine : line));
const yesgatcLinks = SERIALS.map(serial => ({
  serial,
  serialNumber: serial,
  rcCode: RC.rcCode,
  rcName: RC.rcName,
}));

const allotments = Array.isArray(allotDoc.allotments) ? [...allotDoc.allotments] : [];
let range = existingRange;
if (!range) {
  range = {
    id: randomUUID(),
    series: 'non_gatc',
    from: FROM,
    to: TO,
    missing: [],
    count: 25,
    createdAt: now,
    createdBy: ACTOR,
    pushedAt: now,
    pushError: null,
    sku: 'PCSLEC',
    productName: 'WEIGHING SCALE PARTS',
    productId: ITEM_ID,
    invoiceLinks: [{
      rcCode: RC.rcCode,
      rcName: RC.rcName,
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      invoiceDate: String(invoice.date || '').slice(0, 10),
      qty: 25,
      startNumber: FROM,
      endNumber: TO,
      serialNumbers: SERIALS,
    }],
  };
  allotments.push(range);
} else {
  range = {
    ...range,
    invoiceLinks: [{
      rcCode: RC.rcCode,
      rcName: RC.rcName,
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      invoiceDate: String(invoice.date || '').slice(0, 10),
      qty: 25,
      startNumber: FROM,
      endNumber: TO,
      serialNumbers: SERIALS,
    }],
    pushedAt: now,
    pushError: null,
  };
  const idx = allotments.findIndex(row => row.id === range.id);
  if (idx >= 0) allotments[idx] = range;
}

const writes = [
  {
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/appSettings/serialNumberAllotment`,
      fields: encodeFields({
        allotments,
        updatedAt: now,
        updatedBy: ACTOR,
      }),
    },
    updateMask: { fieldPaths: ['allotments', 'updatedAt', 'updatedBy'] },
  },
  {
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/zohoCustomers/${CUSTOMER_ID}/invoices/${INVOICE_ID}`,
      fields: encodeFields({
        lineItems: nextLines,
        nonGatcAllocatedSerials: SERIALS,
        nonGatcSerialAllottedAt: now,
        nonGatcSerialAllottedBy: ACTOR,
        yesgatcLinks,
        yesgatcRcCode: RC.rcCode,
        yesgatcRcName: RC.rcName,
        yesgatcRcPushedAt: now,
        yesgatcRcPushedBy: ACTOR,
        yesgatcRcPushError: null,
      }),
    },
    updateMask: {
      fieldPaths: [
        'lineItems',
        'nonGatcAllocatedSerials',
        'nonGatcSerialAllottedAt',
        'nonGatcSerialAllottedBy',
        'yesgatcLinks',
        'yesgatcRcCode',
        'yesgatcRcName',
        'yesgatcRcPushedAt',
        'yesgatcRcPushedBy',
        'yesgatcRcPushError',
      ],
    },
  },
];

for (const serial of SERIALS) {
  writes.push({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/serialUnits/${serial}`,
      fields: encodeFields({
        serial,
        series: 'non_gatc',
        sku: 'PCSLEC',
        productId: ITEM_ID,
        productName: 'WEIGHING SCALE PARTS',
        status: 'invoiced',
        invoiceId: INVOICE_ID,
        invoiceNumber: INVOICE_NUMBER,
        customerId: CUSTOMER_ID,
        lineId: LINE_ID,
        rcCode: RC.rcCode,
        rcName: RC.rcName,
        allotmentId: range.id,
        updatedAt: now,
        createdAt: now,
      }),
    },
  });
  writes.push({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/nonGatcSerialAllocations/${serial}`,
      fields: encodeFields({
        serial,
        invoiceId: INVOICE_ID,
        invoiceNumber: INVOICE_NUMBER,
        customerId: CUSTOMER_ID,
        lineId: LINE_ID,
        rcCode: RC.rcCode,
        rcName: RC.rcName,
        allottedAt: now,
        allottedBy: ACTOR,
      }),
    },
  });
}

for (let i = 0; i < writes.length; i += 40) {
  await firestore(token, 'documents:commit', {
    method: 'POST',
    body: { writes: writes.slice(i, i + 40) },
  });
}
console.log('Firestore updated:', SERIALS.length, 'serials');

const secrets = {
  clientId: await accessSecret(token, 'ZOHO_CLIENT_ID'),
  clientSecret: await accessSecret(token, 'ZOHO_CLIENT_SECRET'),
  refreshToken: await accessSecret(token, 'ZOHO_REFRESH_TOKEN'),
};
const zToken = await zohoToken(secrets);
const zohoInvoice = (await zohoJson(zToken, `/invoices/${INVOICE_ID}`)).invoice;
const zohoLines = (zohoInvoice.line_items || []).map(item => {
  const line = {
    item_id: item.item_id,
    name: item.name,
    rate: item.rate,
    quantity: item.quantity,
    unit: item.unit || 'pcs',
    line_item_id: item.line_item_id,
    hsn_or_sac: item.hsn_or_sac,
    tax_id: item.tax_id,
    warehouse_id: item.warehouse_id,
    description: String(item.line_item_id) === LINE_ID
      ? withSerialDescription(item.description, SERIALS)
      : item.description,
  };
  return Object.fromEntries(Object.entries(line).filter(([, v]) => v != null && v !== ''));
});
await zohoJson(zToken, `/invoices/${INVOICE_ID}`, {
  method: 'PUT',
  body: {
    customer_id: zohoInvoice.customer_id,
    date: zohoInvoice.date,
    line_items: zohoLines,
  },
});
console.log('Zoho invoice updated');

const webhookUrl = String(allotDoc.webhookUrl || '').trim();
const webhookSecret = String(webhookSettings.secret || '').trim();
if (!webhookUrl) throw new Error('YesGATC webhook URL is missing in Serial numbers settings.');

const serialPayload = {
  event: invoice.yesgatcRcPushedAt ? YESGATC_SERIAL_UPDATED : YESGATC_SERIAL_ALLOTTED,
  type: invoice.yesgatcRcPushedAt ? YESGATC_SERIAL_UPDATED : YESGATC_SERIAL_ALLOTTED,
  action: 'upsert',
  source: 'yesone',
  sentAt: now,
  condition: 'dismantled',
  series: 'non_gatc',
  seriesLabel: 'non GATC',
  allotments: [{
    id: range.id,
    series: 'non_gatc',
    from: FROM,
    to: TO,
    count: 25,
    qty: 25,
    serialNumbers: SERIALS,
    invoiceLinks: [{
      rcCode: RC.rcCode,
      rcName: RC.rcName,
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      invoiceDate: String(invoice.date || '').slice(0, 10),
      qty: 25,
      startNumber: FROM,
      endNumber: TO,
      serialNumbers: SERIALS,
    }],
  }],
  rc: {
    id: RC.rcId,
    name: RC.rcName,
    rcName: RC.rcName,
    code: RC.rcCode,
    rcCode: RC.rcCode,
    place: RC.place,
    dealerId: RC.dealerId,
    dealerName: RC.dealerName,
  },
  invoice: {
    id: INVOICE_ID,
    number: INVOICE_NUMBER,
    invoiceNumber: INVOICE_NUMBER,
    date: String(invoice.date || '').slice(0, 10),
    status: invoice.status || null,
    customerId: CUSTOMER_ID,
    customerName: invoice.customerName,
    qty: 25,
    serialCount: 25,
    startNumber: FROM,
    endNumber: TO,
    serialNumbers: SERIALS,
    lines: [{
      id: LINE_ID,
      name: 'WEIGHING SCALE PARTS',
      sku: 'PCSLEC',
      hsn: '84238190',
      qty: 25,
      serialNumbers: SERIALS,
    }],
  },
};
const serialResult = await postYesGatc(webhookUrl, webhookSecret, serialPayload);
console.log('YesGATC serials', serialResult?.ok ?? 'posted');

const list = await firestore(token, `documents/zohoCustomers/${CUSTOMER_ID}/invoices?pageSize=300`);
let sold = 0;
for (const doc of list.documents || []) {
  const row = decodeValue({ mapValue: { fields: doc.fields } }) || {};
  const status = String(row.status || '').toLowerCase();
  if (status === 'void' || status === 'cancelled' || status === 'canceled') continue;
  const date = String(row.date || '').slice(0, 10);
  if (!date || date < '2026-02-01') continue;
  for (const line of row.lineItems || []) {
    const hsn = String(line.hsn || '').replace(/\D/g, '');
    if (!['84238190', '84238290', '84231000'].includes(hsn)) continue;
    sold += Math.max(0, Math.round(Number(line.quantity) || 0));
  }
}

const quotaPayload = {
  event: YESGATC_RC_OV_QUOTA,
  type: YESGATC_RC_OV_QUOTA,
  source: 'yesone',
  sentAt: now,
  sentBy: ACTOR,
  rcs: [{
    rcCode: RC.rcCode,
    rcName: RC.rcName,
    dealerId: CUSTOMER_ID,
    dealerName: RC.dealerName,
    allotted: sold,
    sold,
    qty: sold,
    serialAllotted: 25,
  }],
  invoice: {
    id: INVOICE_ID,
    number: INVOICE_NUMBER,
    invoiceNumber: INVOICE_NUMBER,
    date: String(invoice.date || '').slice(0, 10),
  },
  reason: 'meezan_yes1828_serial_backfill',
  delta: 25,
  totals: { rcCount: 1, sold },
};
const quotaResult = await postYesGatc(webhookUrl, webhookSecret, quotaPayload);
console.log('YesGATC quota', { sold, posted: quotaResult?.ok ?? true });
console.log('Done', { serials: SERIALS[0] + '–' + SERIALS[SERIALS.length - 1], zoho: true, yesgatc: true });
