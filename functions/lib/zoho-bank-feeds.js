/**
 * Kotak uncategorised bank feeds from Zoho Books/Inventory banking.
 * Stored at kotakBankFeeds/{transactionId}.
 */
import { getFirestore } from 'firebase-admin/firestore';
import {
  getAccessToken,
  resolveOrganizationId,
  authHeaders,
  ZOHO_API_BASE,
  hasZohoJsonBody,
} from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

const ZOHO_BOOKS_API_BASE = 'https://www.zohoapis.in/books/v3';
const COLLECTION = 'kotakBankFeeds';
const META_DOC = 'kotakBankFeedMeta/latest';

function isKotakName(...parts) {
  return parts.some(part => /kotak/i.test(String(part ?? '')));
}

async function zohoBankJson(accessToken, orgId, path, {
  method = 'GET',
  body,
  query = {},
  apiBase,
} = {}) {
  const url = new URL(`${apiBase}${path}`);
  if (!url.searchParams.has('organization_id')) {
    url.searchParams.set('organization_id', orgId);
  }
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const sendBody = hasZohoJsonBody(body);
  const init = {
    method,
    headers: {
      ...authHeaders(accessToken, orgId),
      'X-com-zoho-books-organizationid': orgId,
      ...(sendBody ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (sendBody) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    recordZohoApiFailure(err);
    throw err;
  }

  const payload = await res.json().catch(() => ({}));
  recordZohoApiResponse(res.status, path);

  if (!res.ok) {
    const classified = classifyZohoHttpError(res.status, payload);
    const message = String(payload?.message ?? classified?.message ?? `Zoho banking request failed (${res.status}).`);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(String(payload.message || 'Zoho banking API error.'));
  }
  return payload;
}

async function zohoBankJsonWithFallback(accessToken, orgId, path, options = {}) {
  try {
    return await zohoBankJson(accessToken, orgId, path, {
      ...options,
      apiBase: ZOHO_BOOKS_API_BASE,
    });
  } catch (err) {
    const status = Number(err?.status) || 0;
    const msg = String(err?.message || '');
    if (status !== 404 && !/invalid url|unknown url|not found/i.test(msg)) {
      throw err;
    }
    return zohoBankJson(accessToken, orgId, path, {
      ...options,
      apiBase: ZOHO_API_BASE,
    });
  }
}

function valueHasClock(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /T\d{2}:\d{2}/.test(text)
    || /^\d{1,2}:\d{2}/.test(text)
    || /\s\d{1,2}:\d{2}/.test(text);
}

function pickPostedTime(raw, keyHint = '') {
  if (raw == null) return null;
  if (typeof raw !== 'object') {
    if (/last_modified|created_time|updated_time/i.test(keyHint)) return null;
    return valueHasClock(raw) ? String(raw).trim() : null;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = pickPostedTime(item);
      if (found) return found;
    }
    return null;
  }
  const preferred = [
    raw.time,
    raw.transaction_time,
    raw.entry_time,
    raw.posted_time,
    raw.value_time,
    raw.txn_time,
    raw.date,
  ];
  for (const candidate of preferred) {
    if (valueHasClock(candidate)) return String(candidate).trim();
  }
  for (const [key, value] of Object.entries(raw)) {
    if (/last_modified|created_time|updated_time/i.test(key)) continue;
    const found = pickPostedTime(value, key);
    if (found) return found;
  }
  return null;
}

function mapFeed(raw, account) {
  const transactionId = String(raw?.transaction_id ?? raw?.imported_transaction_id ?? '').trim();
  const amount = Number(raw?.amount ?? 0);
  const debitOrCredit = String(raw?.debit_or_credit ?? '').trim().toLowerCase() || null;
  return {
    transactionId,
    date: raw?.date ? String(raw.date) : null,
    postedTime: pickPostedTime(raw),
    amount: Number.isFinite(amount) ? amount : 0,
    debitOrCredit,
    transactionType: raw?.transaction_type != null
      ? String(raw.transaction_type).trim().toLowerCase()
      : null,
    payee: raw?.payee != null ? String(raw.payee) : null,
    description: raw?.description != null ? String(raw.description) : null,
    referenceNumber: raw?.reference_number != null ? String(raw.reference_number) : null,
    status: String(raw?.status ?? 'uncategorized'),
    accountId: String(raw?.account_id ?? account?.accountId ?? ''),
    accountName: String(raw?.account_name ?? account?.accountName ?? ''),
    bankName: String(account?.bankName ?? ''),
    importedTransactionId: raw?.imported_transaction_id != null
      ? String(raw.imported_transaction_id)
      : null,
  };
}

async function listKotakAccounts(accessToken, orgId) {
  const payload = await zohoBankJsonWithFallback(accessToken, orgId, '/bankaccounts', {
    query: { filter_by: 'Status.Active' },
  });
  const rows = Array.isArray(payload.bankaccounts) ? payload.bankaccounts : [];
  return rows
    .filter(row => isKotakName(row.bank_name, row.account_name, row.account_code))
    .map(row => ({
      accountId: String(row.account_id ?? ''),
      accountName: String(row.account_name ?? ''),
      bankName: String(row.bank_name ?? 'Kotak'),
      uncategorizedCount: Number(row.uncategorized_transactions ?? 0),
    }))
    .filter(row => row.accountId);
}

async function refreshAccountFeeds(accessToken, orgId, accountId) {
  try {
    await zohoBankJsonWithFallback(accessToken, orgId, `/bankaccounts/${accountId}/feeds`, {
      method: 'POST',
    });
  } catch {
    // Refresh is not always exposed on the API; listing uncategorised still works.
  }
}

async function listUncategorizedForAccount(accessToken, orgId, account) {
  const feeds = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 20) {
    const payload = await zohoBankJsonWithFallback(accessToken, orgId, '/banktransactions', {
      query: {
        account_id: account.accountId,
        filter_by: 'Status.Uncategorized',
        per_page: 200,
        page,
        sort_column: 'date',
      },
    });
    const rows = Array.isArray(payload.banktransactions) ? payload.banktransactions : [];
    for (const row of rows) {
      const mapped = mapFeed(row, account);
      if (mapped.transactionId) feeds.push(mapped);
    }
    const ctx = payload.page_context || {};
    hasMore = Boolean(ctx.has_more_page);
    page += 1;
  }
  return feeds;
}

async function persistFeeds(feeds, source) {
  const db = getFirestore();
  const col = db.collection(COLLECTION);
  const existing = await col.get();
  const keep = new Set(feeds.map(feed => feed.transactionId));
  const fetchedAt = new Date().toISOString();

  const writes = [];
  for (const feed of feeds) {
    writes.push({
      ref: col.doc(feed.transactionId),
      data: {
        ...feed,
        fetchedAt,
        source,
      },
    });
  }
  const deletes = existing.docs.filter(doc => !keep.has(doc.id));

  const commitChunk = async (ops) => {
    const batch = db.batch();
    for (const op of ops) {
      if (op.delete) batch.delete(op.ref);
      else batch.set(op.ref, op.data, { merge: true });
    }
    await batch.commit();
  };

  const chunkSize = 400;
  for (let i = 0; i < writes.length; i += chunkSize) {
    await commitChunk(writes.slice(i, i + chunkSize).map(row => ({ ref: row.ref, data: row.data })));
  }
  for (let i = 0; i < deletes.length; i += chunkSize) {
    await commitChunk(deletes.slice(i, i + chunkSize).map(doc => ({ ref: doc.ref, delete: true })));
  }

  await db.doc(META_DOC).set({
    lastSyncedAt: fetchedAt,
    source,
    count: feeds.length,
    accountNames: [...new Set(feeds.map(feed => feed.accountName).filter(Boolean))],
  }, { merge: true });

  return { fetchedAt, count: feeds.length };
}

/**
 * Pull Kotak uncategorised bank feeds from Zoho and store them in Firestore.
 * @returns {{ feeds: object[], fetchedAt: string, count: number, accountNames: string[] }}
 */
export async function syncKotakUncategorizedFeeds(secrets, orgId, { source = 'manual' } = {}) {
  if (!secrets) {
    throw new Error('Zoho credentials are not configured.');
  }
  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const accounts = await listKotakAccounts(accessToken, organizationId);
  if (accounts.length === 0) {
    throw new Error('No Kotak bank account found in Zoho Banking.');
  }

  await Promise.all(accounts.map(account => (
    refreshAccountFeeds(accessToken, organizationId, account.accountId)
  )));

  const feeds = [];
  for (const account of accounts) {
    const rows = await listUncategorizedForAccount(accessToken, organizationId, account);
    feeds.push(...rows);
  }

  const unique = [];
  const seen = new Set();
  for (const feed of feeds) {
    if (seen.has(feed.transactionId)) continue;
    seen.add(feed.transactionId);
    unique.push(feed);
  }
  unique.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const persisted = await persistFeeds(unique, source);
  const withReservations = await overlayFeedReservations(unique);
  return {
    feeds: withReservations,
    fetchedAt: persisted.fetchedAt,
    count: withReservations.length,
    accountNames: accounts.map(account => account.accountName),
  };
}

export async function overlayFeedReservations(feeds) {
  const rows = Array.isArray(feeds) ? feeds : [];
  if (!rows.length) return rows;
  const snaps = await getFirestore().collection(COLLECTION).get();
  const reserved = new Map();
  for (const doc of snaps.docs) {
    const soId = String(doc.data()?.reservedForSalesOrderId || '').trim();
    if (soId) reserved.set(doc.id, soId);
  }
  return rows.map(feed => ({
    ...feed,
    reservedForSalesOrderId: reserved.get(feed.transactionId) || null,
  }));
}

function paymentModeFromFeed(feed) {
  const text = `${feed?.payee || ''} ${feed?.description || ''} ${feed?.referenceNumber || ''}`.toLowerCase();
  if (/\bupi\b/.test(text)) return 'UPI';
  if (/\bneft\b/.test(text)) return 'NEFT';
  if (/\brtgs\b/.test(text)) return 'RTGS';
  if (/\bimps\b/.test(text)) return 'IMPS';
  return 'Bank Transfer';
}

function feedDateYmd(feed) {
  const raw = String(feed?.date || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Categorize a reserved Kotak pay-in as a customer payment on the Zoho invoice
 * so the invoice is marked paid.
 */
export async function applyReservedKotakFeedToInvoice(secrets, orgId, {
  feed,
  customerId,
  invoiceId,
  invoiceTotal,
}) {
  const transactionId = String(feed?.transactionId || '').trim();
  const accountId = String(feed?.accountId || '').trim();
  const contactId = String(customerId || '').trim();
  const invId = String(invoiceId || '').trim();
  if (!transactionId || !accountId || !contactId || !invId) {
    throw new Error('Bank pay-in, customer, and invoice are required to mark the invoice paid.');
  }

  const amount = Number(feed?.amount);
  const total = Number(invoiceTotal);
  const payable = Number.isFinite(total) && total > 0 ? total : amount;
  const applied = Math.min(
    Number.isFinite(amount) && amount > 0 ? amount : payable,
    payable,
  );
  if (!(applied > 0)) {
    throw new Error('Bank pay-in amount is missing.');
  }

  const body = {
    customer_id: contactId,
    account_id: accountId,
    amount: Number.isFinite(amount) && amount > 0 ? amount : applied,
    date: feedDateYmd(feed),
    payment_mode: paymentModeFromFeed(feed),
    reference_number: String(feed?.referenceNumber || transactionId).slice(0, 50),
    description: String(feed?.description || feed?.payee || 'Kotak pay-in').slice(0, 250),
    invoices: [
      {
        invoice_id: invId,
        amount_applied: applied,
      },
    ],
  };

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const ids = [...new Set([
    transactionId,
    String(feed?.importedTransactionId || '').trim(),
  ].filter(Boolean))];
  const paths = ids.flatMap(id => ([
    `/banktransactions/uncategorized/${encodeURIComponent(id)}/categorize/customerpayments`,
    `/banktransactions/uncategorizeds/${encodeURIComponent(id)}/categorize/customerpayments`,
  ]));

  let lastErr = null;
  for (const path of paths) {
    try {
      await zohoBankJsonWithFallback(accessToken, organizationId, path, {
        method: 'POST',
        body,
      });
      return { amountApplied: applied, transactionId };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (/payment_mode|payment mode/i.test(msg)) {
        try {
          const withoutMode = { ...body };
          delete withoutMode.payment_mode;
          await zohoBankJsonWithFallback(accessToken, organizationId, path, {
            method: 'POST',
            body: withoutMode,
          });
          return { amountApplied: applied, transactionId };
        } catch (retryErr) {
          lastErr = retryErr;
        }
      }
    }
  }
  throw new Error(String(lastErr?.message || 'Could not associate the Kotak pay-in with this invoice in Zoho.'));
}
