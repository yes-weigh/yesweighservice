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

function mapFeed(raw, account) {
  const transactionId = String(raw?.transaction_id ?? raw?.imported_transaction_id ?? '').trim();
  const amount = Number(raw?.amount ?? 0);
  const debitOrCredit = String(raw?.debit_or_credit ?? '').trim().toLowerCase() || null;
  return {
    transactionId,
    date: raw?.date ? String(raw.date) : null,
    amount: Number.isFinite(amount) ? amount : 0,
    debitOrCredit,
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
  return {
    feeds: unique,
    fetchedAt: persisted.fetchedAt,
    count: unique.length,
    accountNames: accounts.map(account => account.accountName),
  };
}
