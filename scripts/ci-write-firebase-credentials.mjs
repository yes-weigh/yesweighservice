/**
 * Write Firebase CI credentials to a temp file and verify token exchange.
 * Avoids shell echo/base64 issues with multiline service account JSON.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoogleAuth } = require('../functions/node_modules/google-auth-library');

const githubEnv = process.env.GITHUB_ENV;
const runnerTemp = process.env.RUNNER_TEMP;

if (!githubEnv || !runnerTemp) {
  console.error('::error::GITHUB_ENV or RUNNER_TEMP is not set.');
  process.exit(1);
}

const saPath = `${runnerTemp}/firebase-sa.json`;
const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64?.trim();
const firebaseToken = process.env.FIREBASE_TOKEN?.trim();

if (!rawJson && !rawB64 && !firebaseToken) {
  console.error('::error::No Firebase credentials found. Add one GitHub Actions secret:');
  console.error('::error::  FIREBASE_SERVICE_ACCOUNT — service account JSON');
  console.error('::error::  or FIREBASE_SERVICE_ACCOUNT_B64 — same JSON, base64-encoded');
  console.error('::error::  or FIREBASE_TOKEN — output of: firebase login:ci');
  process.exit(1);
}

if (rawJson || rawB64) {
  if (rawB64) {
    writeFileSync(saPath, Buffer.from(rawB64, 'base64'));
  } else {
    writeFileSync(saPath, rawJson, 'utf8');
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(saPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::Service account JSON is invalid: ${message}`);
    process.exit(1);
  }

  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    console.error('::error::Service account JSON is missing client_email, private_key, or project_id.');
    process.exit(1);
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = saPath;

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      projectId: parsed.project_id,
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      console.error('::error::Service account could not obtain a Google access token.');
      console.error('::error::Re-create FIREBASE_SERVICE_ACCOUNT from a new JSON key, or use FIREBASE_SERVICE_ACCOUNT_B64.');
      process.exit(1);
    }
    console.log(`Firebase service account verified: ${parsed.client_email}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::Service account token exchange failed: ${message}`);
    console.error('::error::If the key is valid, grant this account Firebase Admin on the project.');
    process.exit(1);
  }

  appendFileSync(githubEnv, `GOOGLE_APPLICATION_CREDENTIALS=${saPath}\n`);
  appendFileSync(githubEnv, 'FIREBASE_AUTH_MODE=sa_file\n');
  process.exit(0);
}

appendFileSync(githubEnv, `FIREBASE_TOKEN=${firebaseToken}\n`);
appendFileSync(githubEnv, 'FIREBASE_AUTH_MODE=token\n');
