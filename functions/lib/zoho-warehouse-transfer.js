/**
 * Move Zoho inventory stock between Cochin and Head Office warehouses.
 * Does NOT touch auditSnapshot / auditLogs — only Zoho + catalog product warehouses[].
 */
import { getFirestore } from 'firebase-admin/firestore';
import {
  getAccessToken,
  resolveOrganizationId,
  authHeaders,
  ZOHO_API_BASE,
  getStockStatus,
  fetchProductDetail,
} from './zoho.js';

const PRODUCTS = 'catalogProducts';
const PRIMARY_WAREHOUSE_NAMES = ['cochin', 'head office'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function matchWarehouseName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function isPrimaryWarehouse(name) {
  return PRIMARY_WAREHOUSE_NAMES.includes(matchWarehouseName(name));
}

async function zohoPostJson(accessToken, orgId, path, body, extraQuery = {}) {
  const url = new URL(`${ZOHO_API_BASE}${path}`);
  url.searchParams.set('organization_id', orgId);
  for (const [key, value] of Object.entries(extraQuery)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const hasBody = body != null;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken, orgId),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    const err = new Error(payload.message || `Zoho POST ${path} failed (${response.status})`);
    err.zohoCode = payload.code;
    throw err;
  }
  return payload;
}

/**
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} secrets
 * @param {string} configuredOrgId
 * @param {{
 *   catalogProductId: string,
 *   toWarehouseName: string,
 *   quantity?: number | null,
 * }} options
 */
export async function transferCatalogProductWarehouseStock(secrets, configuredOrgId, options = {}) {
  const catalogProductId = String(options.catalogProductId ?? '').trim();
  const toWarehouseName = String(options.toWarehouseName ?? '').trim();
  if (!catalogProductId) throw new Error('catalogProductId is required.');
  if (!toWarehouseName) throw new Error('toWarehouseName is required.');
  if (!isPrimaryWarehouse(toWarehouseName)) {
    throw new Error('Destination must be Cochin or Head Office.');
  }

  const accessToken = await getAccessToken(secrets);
  const organizationId = await resolveOrganizationId(accessToken, configuredOrgId);
  const detail = await fetchProductDetail(accessToken, organizationId, catalogProductId);
  const warehouses = Array.isArray(detail.warehouses) ? detail.warehouses : [];

  const destination = warehouses.find(
    w => matchWarehouseName(w.warehouseName) === matchWarehouseName(toWarehouseName),
  );
  if (!destination?.warehouseId) {
    throw new Error(`Zoho warehouse “${toWarehouseName}” not found on this item.`);
  }

  const sources = warehouses.filter(w => {
    if (!w.warehouseId) return false;
    if (w.warehouseId === destination.warehouseId) return false;
    if (!isPrimaryWarehouse(w.warehouseName)) return false;
    return Number(w.stock ?? 0) > 0;
  });

  if (!sources.length) {
    const err = new Error(
      `No stock to move — already at ${destination.warehouseName} (or source warehouse is empty).`,
    );
    err.code = 'failed-precondition';
    throw err;
  }

  const requestedQty = options.quantity != null ? Number(options.quantity) : null;
  const transfers = [];

  for (const source of sources) {
    const available = Math.max(0, Math.floor(Number(source.stock ?? 0)));
    if (!available) continue;
    let qty = available;
    if (requestedQty != null && Number.isFinite(requestedQty)) {
      qty = Math.min(available, Math.floor(requestedQty));
    }
    if (qty <= 0) continue;

    const itemName = String(detail.name ?? '').trim() || catalogProductId;
    const itemUnit = String(detail.unit ?? 'pcs').trim() || 'pcs';
    const createPayload = {
      date: todayIsoDate(),
      from_warehouse_id: source.warehouseId,
      to_warehouse_id: destination.warehouseId,
      is_intransit_order: false,
      description: 'Warehouse location correction (audit unchanged)',
      line_items: [
        {
          item_id: catalogProductId,
          name: itemName,
          unit: itemUnit,
          quantity_transfer: qty,
        },
      ],
    };

    const created = await zohoPostJson(accessToken, organizationId, '/transferorders', createPayload);
    const transferOrder = created.transfer_order ?? created.transferorder ?? created;
    const transferOrderId = String(
      transferOrder?.transfer_order_id ?? transferOrder?.transferorder_id ?? '',
    ).trim();

    let status = String(transferOrder?.status ?? '').toLowerCase();
    if (transferOrderId && status !== 'transferred' && status !== 'received') {
      const marked = await zohoPostJson(
        accessToken,
        organizationId,
        `/transferorders/${encodeURIComponent(transferOrderId)}/markastransferred`,
        null,
        { date: todayIsoDate() },
      );
      const markedOrder = marked.transfer_order ?? marked.transferorder ?? marked;
      status = String(markedOrder?.status ?? 'transferred').toLowerCase();
    }

    transfers.push({
      transferOrderId: transferOrderId || null,
      fromWarehouseId: source.warehouseId,
      fromWarehouseName: source.warehouseName,
      toWarehouseId: destination.warehouseId,
      toWarehouseName: destination.warehouseName,
      quantity: qty,
      status: status || 'transferred',
    });

    // Only honour an explicit quantity for the first source with stock.
    if (requestedQty != null && Number.isFinite(requestedQty)) break;
  }

  if (!transfers.length) {
    const err = new Error('Nothing to transfer.');
    err.code = 'failed-precondition';
    throw err;
  }

  // Refresh warehouses from Zoho and patch catalog product only (never audit fields).
  const refreshed = await fetchProductDetail(accessToken, organizationId, catalogProductId);
  const nextWarehouses = Array.isArray(refreshed.warehouses) ? refreshed.warehouses : [];
  const nextStock = Number(refreshed.stock ?? 0);
  const reorderLevel = Number(refreshed.reorderLevel ?? 0);

  const productRef = getFirestore().collection(PRODUCTS).doc(catalogProductId);
  await productRef.set(
    {
      warehouses: nextWarehouses,
      stock: nextStock,
      stockStatus: getStockStatus(nextStock, reorderLevel),
      warehouseLocationCorrectedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return {
    catalogProductId,
    transfers,
    warehouses: nextWarehouses,
    stock: nextStock,
  };
}
