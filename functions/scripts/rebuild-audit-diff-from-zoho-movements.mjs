/**
 * Rebuild locked Diff for audited catalog products from Zoho stock movements.
 *
 * zohoAtAudit = currentZoho − sum(movements after auditTime)
 * baselineDifference = warehouseQty − zohoAtAudit
 * physicalQtyAtAudit = currentZoho + baselineDifference
 *
 * Usage (from functions/):
 *   set GOOGLE_APPLICATION_CREDENTIALS=%APPDATA%\firebase\…_application_default_credentials.json
 *   node scripts/rebuild-audit-diff-from-zoho-movements.mjs
 *   node scripts/rebuild-audit-diff-from-zoho-movements.mjs --apply
 *   node scripts/rebuild-audit-diff-from-zoho-movements.mjs --product-id=99381000027664507 --apply
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'yesweigh-service';
const PRODUCTS = 'catalogProducts';
const YES_STORE_ITEMS = 'yesStoreItems';
const CATALOG_SITE_INVENTORY = 'catalogSiteInventory';
const ZOHO_ACCOUNTS = 'https://accounts.zoho.in/oauth/v2/token';
const ZOHO_API = 'https://www.zohoapis.in/inventory/v1';

const BULK_STAMP_PREFIX = '2026-07-15T11:10';
const REBUILD_BY = 'Rebuild Diff from Zoho movements';
const REQUEST_GAP_MS = 250;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply;
const productIdArg = args.find(a => a.startsWith('--product-id='))?.slice('--product-id='.length)?.trim()
  || null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readEnvFile() {
  const path = join(__dirname, '..', '.env.yesweigh-service');
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

function gcloudSecret(name) {
  try {
    return execFileSync(
      'gcloud',
      ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${PROJECT_ID}`],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

async function loadZohoSecrets(projectId) {
  const fromEnv = {
    clientId: process.env.ZOHO_CLIENT_ID?.trim() || '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET?.trim() || '',
    refreshToken: process.env.ZOHO_REFRESH_TOKEN?.trim() || '',
  };
  if (fromEnv.clientId && fromEnv.clientSecret && fromEnv.refreshToken) return fromEnv;

  try {
    const client = new SecretManagerServiceClient();
    async function readSecret(name) {
      const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${name}/versions/latest`,
      });
      return version.payload?.data?.toString('utf8')?.trim() ?? '';
    }
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      readSecret('ZOHO_CLIENT_ID'),
      readSecret('ZOHO_CLIENT_SECRET'),
      readSecret('ZOHO_REFRESH_TOKEN'),
    ]);
    if (clientId && clientSecret && refreshToken) {
      return { clientId, clientSecret, refreshToken };
    }
  } catch (err) {
    console.warn('Secret Manager unavailable:', err?.message ?? err);
  }

  const viaGcloud = {
    clientId: gcloudSecret('ZOHO_CLIENT_ID'),
    clientSecret: gcloudSecret('ZOHO_CLIENT_SECRET'),
    refreshToken: gcloudSecret('ZOHO_REFRESH_TOKEN'),
  };
  if (!viaGcloud.clientId || !viaGcloud.clientSecret || !viaGcloud.refreshToken) {
    throw new Error('Could not load Zoho secrets (env, Secret Manager, or gcloud).');
  }
  return viaGcloud;
}

async function getAccessToken(secrets) {
  const body = new URLSearchParams({
    refresh_token: secrets.refreshToken,
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(ZOHO_ACCOUNTS, { method: 'POST', body });
  const payload = await res.json();
  if (!payload.access_token) {
    throw new Error(payload.error || payload.message || 'Failed to refresh Zoho token.');
  }
  return payload.access_token;
}

/** Zoho created_time like 2026-07-10T14:10:00+0530 → ISO UTC */
function zohoTimeToIso(zohoTime) {
  if (!zohoTime) return null;
  const m = String(zohoTime).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{4})$/,
  );
  if (!m) {
    const parsed = Date.parse(zohoTime);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const sign = m[3][0] === '-' ? -1 : 1;
  const offH = Number(m[3].slice(1, 3));
  const offM = Number(m[3].slice(3, 5));
  const utcMs = Date.parse(`${m[1]}T${m[2]}Z`) - sign * (offH * 60 + offM) * 60_000;
  return new Date(utcMs).toISOString();
}

function dateOnly(iso) {
  return String(iso).slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d.toISOString());
}

function isBulkOrRestoreStamp(snapshot) {
  const at = String(snapshot?.lastPhysicalAuditedAt ?? snapshot?.lastAuditedAt ?? '');
  const by = String(snapshot?.lastPhysicalAuditedByName ?? snapshot?.lastAuditedByName ?? '');
  if (at.startsWith(BULK_STAMP_PREFIX)) return true;
  if (/bulk/i.test(by)) return true;
  if (/restore/i.test(by)) return true;
  if (/rebuild diff/i.test(by)) return false;
  return false;
}

function warehouseQtyFromSnapshot(snapshot) {
  const ho = Number(snapshot?.headOfficeQtyAtAudit ?? 0);
  const cochin = Number(snapshot?.cochinQtyAtAudit ?? 0);
  if (Number.isFinite(ho) || Number.isFinite(cochin)) return ho + cochin;
  return Number(snapshot?.physicalQtyAtAudit ?? 0);
}

async function resolveWarehouseEvidenceTime(db, productId) {
  let best = '';

  const cochinSnap = await db.collection(CATALOG_SITE_INVENTORY).doc(`${productId}_cochin`).get();
  if (cochinSnap.exists) {
    const at = String(cochinSnap.data()?.updatedAt ?? '').trim();
    if (at > best) best = at;
  }
  const hoSite = await db.collection(CATALOG_SITE_INVENTORY).doc(`${productId}_head_office`).get();
  if (hoSite.exists) {
    const at = String(hoSite.data()?.updatedAt ?? '').trim();
    if (at > best) best = at;
  }

  const itemsSnap = await db.collection(YES_STORE_ITEMS)
    .where('catalogProductId', '==', productId)
    .limit(200)
    .get();
  for (const doc of itemsSnap.docs) {
    const data = doc.data() ?? {};
    for (const key of ['countedAt', 'updatedAt', 'createdAt']) {
      const at = String(data[key] ?? '').trim();
      if (at > best) best = at;
    }
  }

  return best || null;
}

async function resolveAuditTime(db, productId, snapshot) {
  if (isBulkOrRestoreStamp(snapshot)) {
    const evidence = await resolveWarehouseEvidenceTime(db, productId);
    if (evidence) {
      return { auditTime: evidence, auditTimeSource: 'warehouse_evidence' };
    }
  }

  const fromSnap = String(snapshot?.lastPhysicalAuditedAt ?? snapshot?.lastAuditedAt ?? '').trim();
  if (fromSnap) {
    return { auditTime: fromSnap, auditTimeSource: 'snapshot_last_physical' };
  }

  const logs = await db.collection(PRODUCTS).doc(productId)
    .collection('auditLogs')
    .orderBy('auditedAt', 'desc')
    .limit(20)
    .get();
  for (const doc of logs.docs) {
    const row = doc.data() ?? {};
    if (row.trigger === 'zoho_sync') continue;
    const at = String(row.auditedAt ?? '').trim();
    if (at) return { auditTime: at, auditTimeSource: 'audit_log' };
  }

  return { auditTime: null, auditTimeSource: 'none' };
}

function createZohoClient(token, orgId) {
  let lastCall = 0;

  async function zohoGet(path) {
    const elapsed = Date.now() - lastCall;
    if (elapsed < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - elapsed);
    lastCall = Date.now();

    const url = `${ZOHO_API}${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(orgId)}`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const json = await res.json();
    if (!res.ok || (json.code != null && json.code !== 0)) {
      const msg = json.message || res.statusText || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  async function listDocs(collection, itemId, dateStart, dateEnd) {
    const path = `/${collection}?item_id=${encodeURIComponent(itemId)}`
      + `&date_start=${dateStart}&date_end=${dateEnd}&per_page=200`;
    const json = await zohoGet(path);
    return Array.isArray(json[collection]) ? json[collection] : [];
  }

  async function lineQtyForItem(collection, singular, idField, docId, itemId) {
    const json = await zohoGet(`/${collection}/${docId}`);
    const doc = json[singular];
    if (!doc) return { qty: 0, created: null, number: docId };
    let qty = 0;
    for (const line of doc.line_items || []) {
      if (String(line.item_id) === String(itemId)) qty += Number(line.quantity || 0);
    }
    return { qty, created: doc.created_time || null, number: doc[idField] || docId };
  }

  return {
    async collectMovements(itemId, auditTime) {
      const today = dateOnly(new Date().toISOString());
      const start = addDays(dateOnly(auditTime), -30);
      const movements = [];

      const invoices = await listDocs('invoices', itemId, start, today);
      for (const inv of invoices) {
        const { qty, created, number } = await lineQtyForItem(
          'invoices',
          'invoice',
          'invoice_number',
          inv.invoice_id,
          itemId,
        );
        if (qty) movements.push({ type: 'invoice', id: number, created, qty: -qty });
      }

      const bills = await listDocs('bills', itemId, start, today);
      for (const bill of bills) {
        const { qty, created, number } = await lineQtyForItem(
          'bills',
          'bill',
          'bill_number',
          bill.bill_id,
          itemId,
        );
        if (qty) movements.push({ type: 'bill', id: number, created, qty: +qty });
      }

      const creditnotes = await listDocs('creditnotes', itemId, start, today);
      for (const cn of creditnotes) {
        const { qty, created, number } = await lineQtyForItem(
          'creditnotes',
          'creditnote',
          'creditnote_number',
          cn.creditnote_id,
          itemId,
        );
        if (qty) movements.push({ type: 'creditnote', id: number, created, qty: +qty });
      }

      return movements;
    },
  };
}

function rebuildZohoAtAudit(currentZoho, auditTime, movements) {
  let deltaAfter = 0;
  let movementCount = 0;
  for (const m of movements) {
    const at = zohoTimeToIso(m.created);
    if (!at || at <= auditTime) continue;
    deltaAfter += Number(m.qty) || 0;
    movementCount += 1;
  }
  // current = zohoAtAudit + sum(movements after)  ⇒  zohoAtAudit = current − sum(after)
  const zohoAtAudit = currentZoho - deltaAfter;
  return { zohoAtAudit, deltaAfter, movementCount };
}

async function main() {
  const envFile = readEnvFile();
  const orgId = process.env.ZOHO_ORGANIZATION_ID?.trim() || envFile.ZOHO_ORGANIZATION_ID;
  if (!orgId) throw new Error('ZOHO_ORGANIZATION_ID is required.');

  if (!getApps().length) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (credPath && existsSync(credPath)) {
      try {
        const parsed = JSON.parse(readFileSync(credPath, 'utf8'));
        if (parsed.type === 'service_account' && parsed.project_id) {
          initializeApp({
            credential: cert(parsed),
            projectId: parsed.project_id,
          });
        } else {
          initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
        }
      } catch {
        initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
      }
    } else {
      initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    }
  }

  const db = getFirestore();
  const secrets = await loadZohoSecrets(PROJECT_ID);
  const token = await getAccessToken(secrets);
  const zoho = createZohoClient(token, orgId);

  let productDocs;
  if (productIdArg) {
    const doc = await db.collection(PRODUCTS).doc(productIdArg).get();
    if (!doc.exists) throw new Error(`Product not found: ${productIdArg}`);
    productDocs = [doc];
  } else {
    const snap = await db.collection(PRODUCTS).get();
    productDocs = snap.docs.filter(d => d.data()?.auditSnapshot);
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    candidates: productDocs.length,
    productIdFilter: productIdArg,
  }));

  const summary = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    skippedNoAuditTime: 0,
    errors: [],
    samples: [],
  };

  for (const doc of productDocs) {
    const productId = doc.id;
    const data = doc.data() ?? {};
    const snapshot = data.auditSnapshot;
    if (!snapshot) continue;
    summary.scanned += 1;

    try {
      const currentZoho = Number(data.stock ?? 0);
      const warehouseQty = warehouseQtyFromSnapshot(snapshot);
      const prevDiff = Number(snapshot.baselineDifference ?? 0);
      const prevZohoAt = Number(snapshot.zohoQtyAtAudit ?? 0);

      const { auditTime, auditTimeSource } = await resolveAuditTime(db, productId, snapshot);
      if (!auditTime) {
        summary.skippedNoAuditTime += 1;
        continue;
      }

      const movements = await zoho.collectMovements(productId, auditTime);
      const { zohoAtAudit, deltaAfter, movementCount } = rebuildZohoAtAudit(
        currentZoho,
        auditTime,
        movements,
      );
      const baselineDifference = warehouseQty - zohoAtAudit;
      const physicalQtyAtAudit = currentZoho + baselineDifference;

      const row = {
        productId,
        sku: data.sku ?? null,
        auditTime,
        auditTimeSource,
        warehouseQty,
        currentZoho,
        zohoAtAudit,
        deltaAfter,
        movementCount,
        prevDiff,
        nextDiff: baselineDifference,
        prevZohoAt,
        diffChanged: prevDiff !== baselineDifference || prevZohoAt !== zohoAtAudit,
      };

      if (summary.samples.length < 25 || data.sku === 'BPG50QZ2') {
        summary.samples.push(row);
      }

      if (!row.diffChanged) {
        summary.unchanged += 1;
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        continue;
      }

      const now = new Date().toISOString();
      const productRef = db.collection(PRODUCTS).doc(productId);
      const logRef = productRef.collection('auditLogs').doc();
      const prior = snapshot && typeof snapshot === 'object' ? snapshot : {};

      const log = {
        id: logRef.id,
        catalogProductId: productId,
        auditedAt: now,
        auditedByUid: null,
        auditedByName: REBUILD_BY,
        mode: prior.mode === 'bundle' ? 'bundle' : 'unit',
        headOfficeQty: Number(prior.headOfficeQtyAtAudit ?? 0),
        cochinQty: Number(prior.cochinQtyAtAudit ?? 0),
        physicalQty: physicalQtyAtAudit,
        rawPhysicalQty: null,
        zohoQtyAtAudit: zohoAtAudit,
        baselineDifference,
        trigger: 'manual',
        auditCycleId: prior.lastAuditCycleId ?? null,
        note: `Rebuilt Diff from Zoho movements at auditTime=${auditTime} (${auditTimeSource}).`,
      };

      const nextSnapshot = {
        ...prior,
        lastAuditLogId: logRef.id,
        lastAuditedAt: now,
        lastAuditedByUid: null,
        lastAuditedByName: REBUILD_BY,
        baselineDifference,
        physicalQtyAtAudit,
        zohoQtyAtAudit: zohoAtAudit,
        mode: prior.mode === 'bundle' ? 'bundle' : 'unit',
        headOfficeQtyAtAudit: Number(prior.headOfficeQtyAtAudit ?? 0),
        cochinQtyAtAudit: Number(prior.cochinQtyAtAudit ?? 0),
        lastPhysicalAuditedAt: prior.lastPhysicalAuditedAt ?? prior.lastAuditedAt ?? now,
        lastPhysicalAuditedByUid: prior.lastPhysicalAuditedByUid ?? null,
        lastPhysicalAuditedByName: prior.lastPhysicalAuditedByName ?? null,
        lastAuditCycleId: prior.lastAuditCycleId ?? null,
        lastHeadOfficeAuditCycleId: prior.lastHeadOfficeAuditCycleId ?? null,
        lastCochinAuditCycleId: prior.lastCochinAuditCycleId ?? null,
      };

      await logRef.set(log);
      await productRef.set({ auditSnapshot: nextSnapshot }, { merge: true });
      summary.updated += 1;
    } catch (err) {
      summary.errors.push({
        productId,
        sku: data.sku ?? null,
        message: err?.message ?? String(err),
      });
      console.error(`Error ${data.sku || productId}:`, err?.message ?? err);
    }
  }

  // Always surface Qz2 if present in samples or fetch it
  const qz2 = summary.samples.find(s => s.sku === 'BPG50QZ2');
  console.log(JSON.stringify({ summary: {
    scanned: summary.scanned,
    wouldUpdateOrUpdated: summary.updated,
    unchanged: summary.unchanged,
    skippedNoAuditTime: summary.skippedNoAuditTime,
    errorCount: summary.errors.length,
    qz2: qz2 || null,
    samples: summary.samples.slice(0, 15),
    errors: summary.errors.slice(0, 20),
  } }, null, 2));

  if (dryRun) {
    console.log('\nDry run only — re-run with --apply to write snapshots.');
  } else {
    console.log(`\nApply complete: ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.errors.length} error(s).`);
  }

  if (summary.errors.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
