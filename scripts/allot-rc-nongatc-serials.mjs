/**
 * Allot unused non-GATC serials (G0001…) onto RC invoices after 1 Feb 2026.
 *
 *   node scripts/allot-rc-nongatc-serials.mjs
 *   node scripts/allot-rc-nongatc-serials.mjs --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientId as firebaseCliClientId, clientSecret as firebaseCliClientSecret } from 'firebase-tools/lib/api.js';
import {
  applyRcNonGatcSerialBackfill,
  initRcBackfillAdmin,
  planRcNonGatcSerialBackfill,
} from '../functions/lib/rc-nongatc-serial-backfill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECT = 'yesweigh-service';
const APPLY = process.argv.includes('--apply');

function resolveCredentialsPath() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const adc = path.join(ROOT, 'functions', '.firebase-adc.json');
  if (adc && fs.existsSync(adc)) return adc;
  const secretsDir = path.join(ROOT, 'secrets');
  if (fs.existsSync(secretsDir)) {
    const sa = fs.readdirSync(secretsDir)
      .filter(name => name.endsWith('.json') && name.includes('firebase-adminsdk'))
      .sort()[0];
    if (sa) return path.join(secretsDir, sa);
  }
  return null;
}

function readFirebaseCliTokens() {
  const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens || null;
}

async function firebaseCliAccessToken() {
  const tokens = readFirebaseCliTokens();
  if (tokens?.access_token && Number(tokens.expires_at) > Date.now() + 60_000) {
    return tokens.access_token;
  }
  if (!tokens?.refresh_token) {
    throw new Error('Firebase CLI is not logged in. Run firebase login, then retry.');
  }
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
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Could not refresh Firebase CLI access token.');
  }
  return payload.access_token;
}

async function initAdmin() {
  const credentialsPath = resolveCredentialsPath();
  if (credentialsPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    const { cert } = await import('firebase-admin/app');
    const sa = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    initRcBackfillAdmin(cert(sa));
    console.log(`Using credentials: ${path.relative(ROOT, credentialsPath)}`);
    return;
  }
  const accessToken = await firebaseCliAccessToken();
  initRcBackfillAdmin({
    getAccessToken: async () => ({ access_token: accessToken, expires_in: 3500 }),
  });
  console.log('Using Firebase CLI user credentials.');
}

function printPlan(plan) {
  console.log(`\nPool ${plan.poolSize} · unused ${plan.available} · will use ${plan.used} · leftover ${plan.leftover}`);
  console.log(`Min date ${plan.minDate}\n`);
  for (const rc of plan.rcs) {
    console.log(
      `${rc.rcCode.padEnd(4)} ${String(rc.rcName).slice(0, 28).padEnd(28)} `
      + `need ${String(rc.seatNeed).padStart(4)}  allot ${String(rc.allotted).padStart(4)}  `
      + `invoices ${rc.assignments.length}`,
    );
    for (const row of rc.assignments) {
      console.log(
        `     ${row.date}  ${row.invoiceNumber.padEnd(22)}  +${row.allotted}  `
        + row.lines.map(line => `${line.sku || line.name}:${line.serials[0]}–${line.serials[line.serials.length - 1]}`).join(' '),
      );
    }
  }
}

await initAdmin();
const started = Date.now();
if (!APPLY) {
  const plan = await planRcNonGatcSerialBackfill();
  printPlan(plan);
  console.log(`\nDry run ${((Date.now() - started) / 1000).toFixed(1)}s. Re-run with --apply to write Firebase and push YesGATC.`);
  process.exit(0);
}

const result = await applyRcNonGatcSerialBackfill({ actorName: 'YESWEIGH RC backfill' });
console.log(JSON.stringify({
  used: result.used,
  leftover: result.leftover,
  invoices: result.invoices,
  rangePush: result.rangePush,
  sample: result.results.slice(0, 8),
}, null, 2));
console.log(`Applied ${result.invoices} invoices in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
