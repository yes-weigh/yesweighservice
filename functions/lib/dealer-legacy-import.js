import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  readAllDealersFromFirestore,
  readKamsFromFirestore,
  readDealerSetting,
  writeDealerSetting,
  fetchRawCustomerDetail,
} from './zoho-customers.js';
import { fetchCrmDealerOverlay } from './crm-firestore.js';
import { getAccessToken, resolveOrganizationId } from './zoho.js';
import { normalizeStateName, normalizeDistrictName, resolveLiveZipDistrict } from './location-utils.js';

function normalizeLookupName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function buildDealerNameIndex(dealers) {
  const index = new Map();
  for (const dealer of dealers) {
    for (const field of ['contactName', 'companyName']) {
      const key = normalizeLookupName(dealer[field]);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      const ids = index.get(key);
      if (!ids.includes(dealer.id)) ids.push(dealer.id);
    }
  }
  return index;
}

function findDealerIdsByName(name, index) {
  return index.get(normalizeLookupName(name)) ?? [];
}

async function ensureKamByName(name, kamByLowerName) {
  const key = normalizeLookupName(name);
  if (!key) return null;

  if (kamByLowerName.has(key)) {
    return kamByLowerName.get(key);
  }

  const db = getFirestore();
  const ref = await db.collection('kams').add({
    name: String(name).trim(),
    phone: null,
    createdAt: new Date().toISOString(),
  });
  const kam = { id: ref.id, name: String(name).trim(), phone: null };
  kamByLowerName.set(key, kam);
  return kam;
}

async function commitBatches(updates) {
  const db = getFirestore();
  const batchSize = 400;
  let committed = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + batchSize);
    for (const { ref, data } of chunk) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
    committed += chunk.length;
  }

  return committed;
}

/** Pull live CRM overlay from yesweighmomentumhub and apply onto zohoCustomers. */
export async function importCrmDealerOverlay() {
  const crm = await fetchCrmDealerOverlay();
  const { deactivated, overrides, zipCodes, dealerStages, dealerCategories, sourceProject } = crm;

  const db = getFirestore();
  const dealers = await readAllDealersFromFirestore();
  if (!dealers.length) {
    throw new Error('No Zoho customers in Firestore. Run Sync from Zoho first.');
  }

  const nameIndex = buildDealerNameIndex(dealers);
  const existingKams = await readKamsFromFirestore();
  const kamByLowerName = new Map(
    existingKams.map(k => [normalizeLookupName(k.name), k]),
  );

  const updates = [];
  let deactivatedMatched = 0;
  let overridesMatched = 0;
  let overridesSkipped = 0;

  for (const name of deactivated) {
    const ids = findDealerIdsByName(name, nameIndex);
    if (!ids.length) continue;
    deactivatedMatched += 1;
    for (const id of ids) {
      updates.push({
        ref: db.collection('zohoCustomers').doc(id),
        data: {
          isFiltered: true,
          filterReason: 'Manual',
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  for (const [name, override] of Object.entries(overrides)) {
    const ids = findDealerIdsByName(name, nameIndex);
    if (!ids.length) {
      overridesSkipped += 1;
      continue;
    }

    const o = override ?? {};
    const dataToUpdate = { updatedAt: FieldValue.serverTimestamp() };

    if (o.dealer_stage) dataToUpdate.dealerStage = o.dealer_stage;
    if (o.billing_state) dataToUpdate.billingState = normalizeStateName(o.billing_state);
    if (o.district) dataToUpdate.district = normalizeDistrictName(o.district);
    if (o.billing_zipcode) dataToUpdate.zipCode = String(o.billing_zipcode).trim();
    if (o.first_name) dataToUpdate.firstName = String(o.first_name).trim();
    if (o.categories) {
      const cats = Array.isArray(o.categories)
        ? o.categories
        : String(o.categories).split(',').map(s => s.trim()).filter(Boolean);
      if (cats.length) dataToUpdate.categories = cats;
    }

    if (o.key_account_manager) {
      const kam = await ensureKamByName(o.key_account_manager, kamByLowerName);
      if (kam) dataToUpdate.kamId = kam.id;
    }

    if (Object.keys(dataToUpdate).length <= 1) continue;

    overridesMatched += 1;
    for (const id of ids) {
      updates.push({
        ref: db.collection('zohoCustomers').doc(id),
        data: dataToUpdate,
      });
    }
  }

  const updatedCount = await commitBatches(updates);

  await writeDealerSetting('crm_overlay_import_done', true);
  await writeDealerSetting('crm_overlay_source', sourceProject);
  await writeDealerSetting('crm_overlay_imported_at', new Date().toISOString());

  if (Object.keys(zipCodes).length > 0) {
    await writeDealerSetting('zip_codes', zipCodes);
  }
  if (dealerCategories.length > 0) {
    await writeDealerSetting('dealer_categories', dealerCategories);
  }
  if (dealerStages.length > 0) {
    await writeDealerSetting('dealer_stages', dealerStages);
  }

  console.info('CRM dealer overlay import complete', {
    sourceProject,
    deactivatedNames: deactivated.length,
    deactivatedMatched,
    overrideNames: Object.keys(overrides).length,
    overridesMatched,
    overridesSkipped,
    documentsUpdated: updatedCount,
    zipCodes: Object.keys(zipCodes).length,
    dealerCategories: dealerCategories.length,
    dealerStages: dealerStages.length,
  });

  return {
    sourceProject,
    deactivatedNames: deactivated.length,
    deactivatedMatched,
    overrideNames: Object.keys(overrides).length,
    overridesMatched,
    overridesSkipped,
    documentsUpdated: updatedCount,
    zipCodesStored: Object.keys(zipCodes).length,
    dealerCategoriesStored: dealerCategories.length,
    dealerStagesStored: dealerStages.length,
  };
}

export async function backfillDealerLocations(secrets, orgId) {
  const zipCodesCache = await readDealerSetting('zip_codes', {});
  const dealers = await readAllDealersFromFirestore();
  const activeDealers = dealers.filter(d => !d.isFiltered);

  const db = getFirestore();
  const updates = [];
  let offlineFixedCount = 0;

  for (const dealer of activeDealers) {
    let targetDistrict = dealer.district;
    const targetZip = dealer.zipCode;

    if (targetZip) {
      const liveDist = await resolveLiveZipDistrict(targetZip, zipCodesCache);
      if (liveDist) targetDistrict = liveDist;
    }

    const normalized = normalizeDistrictName(targetDistrict);
    if (normalized && normalized !== dealer.district) {
      updates.push({
        ref: db.collection('zohoCustomers').doc(dealer.id),
        data: {
          district: normalized,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
      offlineFixedCount += 1;
    }
  }

  if (updates.length) {
    await commitBatches(updates);
  }

  const dealersToFetch = activeDealers.filter(d =>
    !d.district || !d.zipCode || d.zipCode === '',
  );

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);

  let fetchCount = 0;
  const fetchUpdates = [];

  for (const dealer of dealersToFetch) {
    try {
      const detail = await fetchRawCustomerDetail(accessToken, organizationId, dealer.id);
      const shipping = detail?.shipping_address;
      const billing = detail?.billing_address;
      const address = (shipping && (shipping.state || shipping.city)) ? shipping : billing;

      if (address && (address.state || address.state_code || address.city)) {
        const newBillingState = normalizeStateName(address.state || address.state_code);
        const newZipCode = address.zip || billing?.zip || shipping?.zip || null;
        let newDistrict = address.city || null;

        if (newZipCode) {
          const liveDist = await resolveLiveZipDistrict(newZipCode, zipCodesCache);
          if (liveDist) newDistrict = liveDist;
        }

        newDistrict = normalizeDistrictName(newDistrict);

        fetchUpdates.push({
          ref: db.collection('zohoCustomers').doc(dealer.id),
          data: {
            billingState: newBillingState,
            district: newDistrict,
            zipCode: newZipCode,
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        fetchCount += 1;
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`Failed to backfill location for ${dealer.id}:`, err?.message ?? err);
    }
  }

  if (fetchUpdates.length) {
    await commitBatches(fetchUpdates);
  }

  await writeDealerSetting('locations_backfilled', true);

  console.info('Dealer location backfill complete', {
    offlineFixedCount,
    deepFetchCount: fetchCount,
    totalAttempted: dealersToFetch.length,
  });

  return {
    offlineFixedCount,
    deepFetchCount: fetchCount,
    totalAttempted: dealersToFetch.length,
  };
}

// Back-compat alias for older deploys / imports
export const importLegacyDealerOverrides = importCrmDealerOverlay;
