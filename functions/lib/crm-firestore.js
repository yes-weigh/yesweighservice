import { initializeApp, applicationDefault, getApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const CRM_FIREBASE_PROJECT = 'yesweighmomentumhub';
const CRM_APP_NAME = 'yesweigh-crm-source';

export function getCrmFirestore() {
  if (!getApps().some(app => app.name === CRM_APP_NAME)) {
    initializeApp({
      credential: applicationDefault(),
      projectId: CRM_FIREBASE_PROJECT,
    }, CRM_APP_NAME);
  }
  return getFirestore(getApp(CRM_APP_NAME));
}

const OVERRIDE_SKIP_KEYS = new Set([
  'items',
  'dealer_stages',
  'dealer_categories',
  'stage_images',
  'category_images',
  'reports',
  'updatedAt',
  'createdAt',
]);

function extractZipCodes(docData = {}) {
  const zipCodes = {};
  for (const [key, value] of Object.entries(docData)) {
    if (/^\d{6}$/.test(key) && typeof value === 'string' && value.trim()) {
      zipCodes[key] = value.trim();
    }
  }
  return zipCodes;
}

function extractDealerOverrides(docData = {}) {
  const overrides = {};
  for (const [key, value] of Object.entries(docData)) {
    if (OVERRIDE_SKIP_KEYS.has(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    overrides[key] = value;
  }
  return overrides;
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

/** Read live dealer overlay from yesweighmomentumhub Firestore `settings` collection. */
export async function fetchCrmDealerOverlay() {
  const db = getCrmFirestore();
  const settingsRef = db.collection('settings');

  const [deactivatedSnap, overridesSnap, zipSnap, generalSnap] = await Promise.all([
    settingsRef.doc('deactivated_dealers').get(),
    settingsRef.doc('dealer_overrides').get(),
    settingsRef.doc('zip_codes').get(),
    settingsRef.doc('general').get(),
  ]);

  const deactivated = deactivatedSnap.exists
    ? normalizeStringList(deactivatedSnap.data()?.items)
    : [];

  const overrides = overridesSnap.exists
    ? extractDealerOverrides(overridesSnap.data())
    : {};

  const zipCodes = zipSnap.exists
    ? extractZipCodes(zipSnap.data())
    : {};

  const general = generalSnap.exists ? (generalSnap.data() ?? {}) : {};
  const dealerStages = normalizeStringList(general.dealer_stages);
  const dealerCategories = normalizeStringList(general.dealer_categories);

  return {
    sourceProject: CRM_FIREBASE_PROJECT,
    deactivated,
    overrides,
    zipCodes,
    dealerStages,
    dealerCategories,
  };
}
