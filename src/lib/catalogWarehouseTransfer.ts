import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { CatalogWarehouse } from '../types/catalog';
import {
  CATALOG_WAREHOUSE_COCHIN,
  CATALOG_WAREHOUSE_HEAD_OFFICE,
} from './catalogInventorySites';

const functions = getFunctions(app, 'asia-south1');

export const ZOHO_PRIMARY_WAREHOUSES = [
  CATALOG_WAREHOUSE_COCHIN,
  CATALOG_WAREHOUSE_HEAD_OFFICE,
] as const;

export type PrimaryWarehouseName =
  typeof ZOHO_PRIMARY_WAREHOUSES[number];

export interface WarehouseTransferResult {
  catalogProductId: string;
  transfers: Array<{
    transferOrderId: string | null;
    fromWarehouseId: string;
    fromWarehouseName: string;
    toWarehouseId: string;
    toWarehouseName: string;
    quantity: number;
    status: string;
  }>;
  warehouses: CatalogWarehouse[];
  stock: number;
}

export function warehouseStockForName(
  warehouses: CatalogWarehouse[] | null | undefined,
  warehouseName: string,
): number {
  const target = warehouseName.trim().toLowerCase();
  const row = (warehouses ?? []).find(
    w => w.warehouseName.trim().toLowerCase() === target,
  );
  return Math.max(0, Math.floor(Number(row?.stock ?? 0)));
}

/** Warehouse that currently holds the movable stock (for primary HO/Cochin pair). */
export function resolveCurrentZohoWarehouse(
  warehouses: CatalogWarehouse[] | null | undefined,
): PrimaryWarehouseName | null {
  let best: PrimaryWarehouseName | null = null;
  let bestQty = 0;
  for (const name of ZOHO_PRIMARY_WAREHOUSES) {
    const qty = warehouseStockForName(warehouses, name);
    if (qty > bestQty) {
      bestQty = qty;
      best = name;
    }
  }
  return best;
}

export async function transferCatalogProductWarehouseStock(
  catalogProductId: string,
  toWarehouseName: PrimaryWarehouseName,
  quantity?: number | null,
): Promise<WarehouseTransferResult> {
  const callable = httpsCallable<
    {
      catalogProductId: string;
      toWarehouseName: string;
      quantity?: number | null;
    },
    WarehouseTransferResult
  >(functions, 'transferCatalogProductWarehouseStock', { timeout: 120_000 });

  const result = await callable({
    catalogProductId: String(catalogProductId ?? '').trim(),
    toWarehouseName,
    quantity: quantity ?? null,
  });
  return result.data;
}
