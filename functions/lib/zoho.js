const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.in';
export const ZOHO_API_BASE = 'https://www.zohoapis.in/inventory/v1';

/** @type {{ token: string; expiresAt: number } | null} */
let tokenCache = null;

export function getStockStatus(stock, reorderLevel) {
  if (stock <= 0) return 'out_of_stock';
  if (reorderLevel > 0 && stock <= reorderLevel) return 'low_stock';
  return 'in_stock';
}

export function normaliseItem(raw) {
  let stockRaw = 0;
  if (raw.account_stock_on_hand != null) stockRaw = raw.account_stock_on_hand;
  else if (raw.accounting_stock != null) stockRaw = raw.accounting_stock;
  else if (raw.stock_on_hand != null) stockRaw = raw.stock_on_hand;
  else if (raw.available_stock != null) stockRaw = raw.available_stock;
  else if (raw.actual_available_stock != null) stockRaw = raw.actual_available_stock;

  const stock = Number.parseFloat(String(stockRaw)) || 0;
  const reorderLevel = Number.parseFloat(String(raw.reorder_level || 0)) || 0;

  return {
    id: String(raw.item_id ?? ''),
    name: String(raw.name ?? raw.item_name ?? 'Unnamed product'),
    sku: String(raw.sku ?? ''),
    description: String(raw.description ?? ''),
    unit: String(raw.unit ?? 'pcs'),
    rate: Number.parseFloat(String(raw.rate ?? 0)) || 0,
    stock,
    stockStatus: getStockStatus(stock, reorderLevel),
    hasImage: Boolean(raw.image_url || raw.image_document_id),
    categoryId: raw.group_id ? String(raw.group_id) : '',
    categoryName: raw.group_name ? String(raw.group_name) : '',
    status: String(raw.status ?? 'active'),
    hsn: String(raw.hsn_or_sac ?? ''),
    taxName: String(raw.tax_name ?? ''),
    taxPercentage: Number(raw.tax_percentage ?? 0),
    reorderLevel,
  };
}

export async function getAccessToken(secrets) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    refresh_token: secrets.refreshToken,
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || payload.message || 'Failed to refresh Zoho access token.');
  }

  const expiresIn = Number(payload.expires_in_sec || payload.expires_in || 3600);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return tokenCache.token;
}

export function authHeaders(accessToken, orgId) {
  return {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'X-com-zoho-inventory-organizationid': orgId,
  };
}

export async function fetchOrganizations(accessToken) {
  const response = await fetch(`${ZOHO_API_BASE}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(payload.message || 'Failed to load Zoho organizations.');
  }
  return payload.organizations ?? [];
}

export async function resolveOrganizationId(accessToken, configuredOrgId) {
  const configured = String(configuredOrgId ?? '').trim();
  if (configured) return configured;

  const orgs = await fetchOrganizations(accessToken);
  if (!orgs.length) {
    throw new Error('No Zoho Inventory organization found. Set ZOHO_ORGANIZATION_ID.');
  }
  return String(orgs[0].organization_id);
}

export async function fetchAllItemGroups(accessToken, orgId, page = 1, perPage = 200) {
  const url = new URL(`${ZOHO_API_BASE}/itemgroups`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));

  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho item groups API error');
  }

  const groups = (payload.itemgroups ?? []).map(raw => ({
    id: String(raw.group_id ?? raw.itemgroup_id ?? ''),
    name: String(raw.group_name ?? raw.name ?? 'Category'),
    productCount: Number(raw.product_count ?? raw.item_count ?? 0),
  })).filter(g => g.id);

  const hasMore = Boolean(payload.page_context?.has_more_page);
  if (hasMore) {
    const next = await fetchAllItemGroups(accessToken, orgId, page + 1, perPage);
    return [...groups, ...next];
  }

  return groups;
}

export async function fetchItemsByGroup(accessToken, orgId, groupId, page = 1, perPage = 200) {
  const url = new URL(`${ZOHO_API_BASE}/items`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('group_id', groupId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('sort_column', 'item_name');
  url.searchParams.set('sort_order', 'A');

  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || `Zoho items API error for group ${groupId}`);
  }

  const items = (payload.items ?? []).map(raw => ({
    id: String(raw.item_id ?? ''),
    status: String(raw.status ?? 'active'),
  })).filter(item => item.id);

  const hasMore = Boolean(payload.page_context?.has_more_page);
  if (hasMore) {
    const next = await fetchItemsByGroup(accessToken, orgId, groupId, page + 1, perPage);
    return [...items, ...next];
  }

  return items;
}

/** Bulk item details — fills in group_id when the list endpoint omits it. */
export async function fetchBulkItemDetails(accessToken, orgId, itemIds) {
  if (!itemIds.length) return [];

  const url = new URL(`${ZOHO_API_BASE}/itemdetails`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('item_ids', itemIds.join(','));

  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho bulk item details error');
  }

  return (payload.items ?? []).map(raw => ({
    id: String(raw.item_id ?? ''),
    categoryId: raw.group_id ? String(raw.group_id) : null,
    categoryName: raw.group_name ? String(raw.group_name) : null,
    status: String(raw.status ?? 'active'),
  })).filter(item => item.id);
}

export async function fetchAllProducts(accessToken, orgId, page = 1, perPage = 200) {
  const url = new URL(`${ZOHO_API_BASE}/items`);
  url.searchParams.set('organization_id', orgId);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('sort_column', 'item_name');
  url.searchParams.set('sort_order', 'A');

  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho items API error');
  }

  const items = (payload.items ?? []).map(normaliseItem);
  const hasMore = Boolean(payload.page_context?.has_more_page);
  if (hasMore) {
    const next = await fetchAllProducts(accessToken, orgId, page + 1, perPage);
    return [...items, ...next];
  }
  return items;
}

export async function fetchProductDetail(accessToken, orgId, itemId) {
  const url = `${ZOHO_API_BASE}/items/${itemId}?organization_id=${orgId}`;
  const response = await fetch(url, { headers: authHeaders(accessToken, orgId) });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho product detail error');
  }

  const item = payload.item;
  if (!item) throw new Error('Product not found in Zoho response');

  const stock = Number(
    item.account_stock_on_hand
    ?? item.accounting_stock
    ?? item.stock_on_hand
    ?? item.available_stock
    ?? 0,
  );
  const reorderLevel = Number(item.reorder_level ?? 0);

  const warehouses = (item.warehouses ?? [])
    .filter(w => w.warehouse_name || w.name)
    .map(w => ({
      warehouseId: String(w.warehouse_id ?? ''),
      warehouseName: String(w.warehouse_name ?? w.name ?? ''),
      stock: Number(
        w.warehouse_accounting_stock_on_hand
        ?? w.warehouse_accounting_available_for_sale_stock
        ?? w.warehouse_stock_accounting
        ?? w.warehouse_stock_on_hand
        ?? w.stock
        ?? 0,
      ),
    }));

  return {
    id: String(item.item_id ?? itemId),
    name: String(item.name ?? ''),
    sku: item.sku || null,
    description: item.description || null,
    unit: String(item.unit ?? 'pcs'),
    rate: Number(item.rate ?? 0),
    stock,
    stockStatus: getStockStatus(stock, reorderLevel),
    categoryId: item.group_id ? String(item.group_id) : null,
    categoryName: item.group_name || null,
    status: String(item.status ?? 'active'),
    hsn: item.hsn_or_sac || null,
    taxName: item.tax_name || null,
    taxPercentage: item.tax_percentage != null ? Number(item.tax_percentage) : null,
    reorderLevel,
    preferredVendor: item.preferred_vendor?.vendor_name || null,
    warehouses,
  };
}

export async function downloadProductImage(accessToken, orgId, itemId, retryCount = 0) {
  const url = `${ZOHO_API_BASE}/items/${itemId}/image?organization_id=${orgId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (response.status === 404) return null;

  if (response.status === 429) {
    if (retryCount < 2) {
      const delay = 2 ** (retryCount + 1) * 1000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return downloadProductImage(accessToken, orgId, itemId, retryCount + 1);
    }
    return 'RATE_LIMITED';
  }

  if (!response.ok) return null;

  const arrayBuf = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.split('/')[1]?.split(';')[0]?.trim() || 'jpg';

  return {
    buffer: Buffer.from(arrayBuf),
    contentType,
    ext,
  };
}

/** Upload or replace the primary item image in Zoho Inventory. */
export async function uploadProductImageToZoho(accessToken, orgId, itemId, buffer, contentType) {
  const url = `${ZOHO_API_BASE}/items/${itemId}/image?organization_id=${orgId}`;
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : 'jpg';
  const filename = `product-${itemId}.${ext}`;

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), filename);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    body: form,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.message || 'Zoho image upload failed.');
  }
  if (!response.ok) {
    throw new Error(payload?.message || `Zoho image upload failed (${response.status}).`);
  }

  return payload ?? { ok: true };
}

/**
 * Zoho internal API — move item to a different item group.
 * PUT /inventory/v1/items/move/{itemId}
 */
export async function moveProductToCategory(accessToken, orgId, itemId, categoryId) {
  const url = `${ZOHO_API_BASE}/items/move/${itemId}`;
  const params = new URLSearchParams();
  params.set('organization_id', orgId);
  params.set('JSONString', JSON.stringify({ group_id: categoryId }));

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: params.toString(),
  });

  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || 'Zoho category move failed');
  }
}
