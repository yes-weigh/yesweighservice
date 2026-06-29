import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  ZOHO_API_BASE,
  authHeaders,
  getAccessToken,
  resolveOrganizationId,
} from './zoho.js';
import {
  recordZohoApiResponse,
  recordZohoApiFailure,
  classifyZohoHttpError,
} from './zoho-api-usage.js';

const CATALOG_META_ZOHO = 'catalogMeta/zoho';

/** @typedef {{ rack: string; row: number; bin: number; qty: number; location: string; partLabel: string | null; linkMode: string }} StoreLocationEntry */

export function formatYesStoreLocationLabel(rackId, rowNumber, binNumber) {
  const rack = String(rackId ?? '').trim().toUpperCase();
  const row = Number(rowNumber);
  const bin = Number(binNumber);
  return `${rack} · ${row} · ${bin}`;
}

/**
 * Build store-location rows from linked yesStoreItems docs.
 * @param {Array<Record<string, unknown>>} items
 * @returns {StoreLocationEntry[]}
 */
export function buildStoreLocationEntries(items) {
  return items
    .map(item => {
      const rack = String(item.rackId ?? '').trim().toUpperCase();
      const row = Number(item.rowNumber);
      const bin = Number(item.binNumber);
      const qty = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
      if (!rack || !Number.isFinite(row) || !Number.isFinite(bin)) return null;

      const linkMode = item.catalogLinkMode === 'part' ? 'part' : 'unit';
      const partLabel = linkMode === 'part' ? String(item.partLabel ?? '').trim() || null : null;

      return {
        rack,
        row,
        bin,
        qty,
        location: formatYesStoreLocationLabel(rack, row, bin),
        partLabel,
        linkMode,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.location.localeCompare(b.location));
}

/**
 * JSON payload stored in Zoho custom field (string value).
 * @param {StoreLocationEntry[]} locations
 */
export function serializeStoreLocationsForZoho(locations) {
  const summary = locations.length
    ? locations.map(entry => `${entry.rack}-${entry.row}-${entry.bin} ×${entry.qty}`).join(' | ')
    : '';

  return JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    summary,
    locations,
  });
}

export async function fetchYesStoreItemsForCatalogProduct(db, catalogProductId) {
  const productId = String(catalogProductId ?? '').trim();
  if (!productId) return [];

  const snap = await db
    .collection('yesStoreItems')
    .where('catalogProductId', '==', productId)
    .limit(200)
    .get();

  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function fetchCustomFieldsForItems(accessToken, orgId) {
  const url = new URL(`${ZOHO_API_BASE}/settings/customfields`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('module', 'item');

  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  await recordZohoApiResponse(response, { operation: 'settings/customfields', source: 'store-locations' });
  const payload = await response.json();
  if (payload.code !== 0) {
    const err = classifyZohoHttpError(400, payload);
    await recordZohoApiFailure(err, { operation: 'settings/customfields', source: 'store-locations' });
    throw new Error(payload.message || 'Could not load Zoho item custom fields.');
  }

  return payload.customfields ?? payload.custom_fields ?? [];
}

const DEFAULT_STORE_LOCATIONS_CF_LABEL = 'Yes Store Locations';
const DEFAULT_STORE_LOCATIONS_CF_API_NAME = 'cf_store_location';

export async function resolveStoreLocationsCustomFieldId(
  db,
  accessToken,
  orgId,
  { configuredId, label, apiName },
) {
  const trimmedId = String(configuredId ?? '').trim();
  if (trimmedId) return trimmedId;

  const metaSnap = await db.doc(CATALOG_META_ZOHO).get();
  const cachedId = String(metaSnap.data()?.storeLocationsCustomFieldId ?? '').trim();
  if (cachedId) return cachedId;

  const targetLabel = String(label ?? DEFAULT_STORE_LOCATIONS_CF_LABEL).trim().toLowerCase();
  const targetApiName = String(apiName ?? DEFAULT_STORE_LOCATIONS_CF_API_NAME).trim().toLowerCase();
  const fields = await fetchCustomFieldsForItems(accessToken, orgId);
  const match = fields.find(field => {
    const fieldLabel = String(field.label ?? field.field_label ?? '').trim().toLowerCase();
    const fieldApiName = String(field.api_name ?? '').trim().toLowerCase();
    return fieldApiName === targetApiName
      || fieldLabel === targetLabel
      || fieldApiName === targetLabel.replace(/\s+/g, '_')
      || fieldLabel.includes('store location');
  });

  const fieldId = String(match?.customfield_id ?? match?.field_id ?? '').trim();
  if (!fieldId) {
    throw new Error(
      `Zoho item custom field "${label}" not found. Create a multiline custom field in Zoho Inventory `
      + 'or set ZOHO_ITEM_STORE_LOCATIONS_CF_ID.',
    );
  }

  await db.doc(CATALOG_META_ZOHO).set(
    {
      storeLocationsCustomFieldId: fieldId,
      storeLocationsCustomFieldLabel: match?.label ?? label,
      storeLocationsCustomFieldApiName: match?.api_name ?? apiName,
      storeLocationsCustomFieldResolvedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return fieldId;
}

async function updateItemStoreLocationsViaItemPut(
  accessToken,
  orgId,
  itemId,
  customfieldId,
  value,
) {
  const detailUrl = `${ZOHO_API_BASE}/items/${itemId}?organization_id=${orgId}`;
  const detailRes = await fetch(detailUrl, { headers: authHeaders(accessToken, orgId) });
  const detailData = await detailRes.json();
  if (detailData.code !== 0 || !detailData.item) {
    throw new Error(detailData.message || 'Zoho item fetch failed before custom field update.');
  }

  const existingFields = Array.isArray(detailData.item.custom_fields)
    ? detailData.item.custom_fields
    : [];
  const mergedFields = [
    ...existingFields.filter(field => String(field.customfield_id ?? '') !== String(customfieldId)),
    { customfield_id: customfieldId, value: String(value ?? '') },
  ];

  const putUrl = `${ZOHO_API_BASE}/items/${itemId}`;
  const params = new URLSearchParams();
  params.set('organization_id', orgId);
  params.set('JSONString', JSON.stringify({
    custom_fields: mergedFields,
    label_rate: detailData.item.label_rate ?? detailData.item.rate ?? 1,
  }));

  const response = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: params.toString(),
  });

  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho item PUT custom_fields failed.');
  }

  return payload;
}

export async function updateItemStoreLocationsCustomField(
  accessToken,
  orgId,
  itemId,
  customfieldId,
  value,
) {
  const productId = String(itemId ?? '').trim();
  const fieldId = String(customfieldId ?? '').trim();
  if (!productId || !fieldId) {
    throw new Error('itemId and customfieldId are required for Zoho store location sync.');
  }

  try {
    return await updateItemStoreLocationsCustomFieldPrimary(
      accessToken,
      orgId,
      productId,
      fieldId,
      value,
    );
  } catch (primaryErr) {
    console.warn('[store-locations] customfields endpoint failed, trying item PUT', primaryErr);
    return updateItemStoreLocationsViaItemPut(accessToken, orgId, productId, fieldId, value);
  }
}

async function updateItemStoreLocationsCustomFieldPrimary(
  accessToken,
  orgId,
  itemId,
  customfieldId,
  value,
) {
  const url = `${ZOHO_API_BASE}/items/${itemId}/customfields?organization_id=${orgId}`;
  const body = JSON.stringify({
    customfield_id: customfieldId,
    value: String(value ?? ''),
  });

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken, orgId),
      'Content-Type': 'application/json',
    },
    body,
  });

  await recordZohoApiResponse(response, {
    operation: `items/${itemId}/customfields`,
    source: 'store-locations',
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (payload?.code !== undefined && payload.code !== 0) {
    const err = classifyZohoHttpError(400, payload);
    await recordZohoApiFailure(err, {
      operation: `items/${itemId}/customfields`,
      source: 'store-locations',
    });
    throw new Error(payload.message || 'Zoho store locations custom field update failed.');
  }

  if (!response.ok) {
    throw new Error(payload?.message || `Zoho store locations update failed (${response.status}).`);
  }

  return payload ?? { ok: true };
}

export async function syncCatalogProductStoreLocationsToZoho(
  db,
  secrets,
  orgId,
  catalogProductId,
  { customFieldId, customFieldLabel, customFieldApiName },
) {
  const productId = String(catalogProductId ?? '').trim();
  if (!productId) {
    throw new Error('catalogProductId is required.');
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, orgId);
  const fieldId = await resolveStoreLocationsCustomFieldId(db, accessToken, organizationId, {
    configuredId: customFieldId,
    label: customFieldLabel,
    apiName: customFieldApiName,
  });

  const yesStoreItems = await fetchYesStoreItemsForCatalogProduct(db, productId);
  const locations = buildStoreLocationEntries(yesStoreItems);
  const zohoValue = serializeStoreLocationsForZoho(locations);

  await updateItemStoreLocationsCustomField(
    accessToken,
    organizationId,
    productId,
    fieldId,
    zohoValue,
  );

  await db.doc(`catalogProducts/${productId}`).set(
    {
      storeLocations: locations,
      storeLocationsSummary: locations.length
        ? locations.map(entry => `${entry.location} ×${entry.qty}`).join(' | ')
        : '',
      storeLocationsZohoSyncedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    ok: true,
    productId,
    locationCount: locations.length,
    customfieldId: fieldId,
  };
}
