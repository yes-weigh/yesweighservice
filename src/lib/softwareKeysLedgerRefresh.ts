import type { CatalogProduct } from '../types/catalog';
import type { CatalogProductStockMovementsResult } from '../types/catalog-product-audit';
import { publishCatalogLedgerClosingStock } from './catalog';
import { fetchCatalogProductLifetimeStockMovements } from './catalogProductAudit/data';
import { isBrokenStockLedger } from './catalogProductAudit/loadStockLedger';
import {
  isImplausibleSoftwareKeyLedgerQty,
  isSoftwareKeysLedgerStockProduct,
} from './softwareKeysLedgerStock';

const inFlightIds = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function ledgerLooksInvoiceOnly(result: CatalogProductStockMovementsResult): boolean {
  const movements = result.movements ?? [];
  let invoiceOut = 0;
  let creditIn = 0;
  for (const row of movements) {
    const delta = Number(row.qtyDelta) || 0;
    if (row.type === 'invoice') invoiceOut += delta;
    if (row.type === 'creditnote') creditIn += delta;
  }
  return invoiceOut < 0 && creditIn === 0;
}

export function softwareKeyNeedsLedgerRefresh(product: CatalogProduct): boolean {
  if (!isSoftwareKeysLedgerStockProduct(product)) return false;
  const qty = Number(product.ledgerClosingStock);
  if (!Number.isFinite(qty)) return true;
  return isImplausibleSoftwareKeyLedgerQty(qty);
}

async function fetchPlausibleSoftwareKeyClosing(
  productId: string,
): Promise<{ closing: number; fetchedAt: string | null } | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await sleep(800);
    const result = await fetchCatalogProductLifetimeStockMovements(productId);
    if (isBrokenStockLedger(result)) continue;
    if (result.ledgerIncomplete) continue;
    if (ledgerLooksInvoiceOnly(result)) continue;
    const closing = Number(result.netDelta);
    if (!Number.isFinite(closing) || isImplausibleSoftwareKeyLedgerQty(closing)) continue;
    return { closing, fetchedAt: result.fetchedAt ?? null };
  }
  return null;
}

/**
 * Same live ledger as the Stock tab. Writes closing onto the grid cards.
 * Used after Sync and to repair junk ~800 qty left by a bad persist.
 */
export async function refreshSoftwareKeyLedgerStocks(
  products: CatalogProduct[],
  opts?: { onlyIfMissingOrImplausible?: boolean },
): Promise<void> {
  const keys = products.filter(product => {
    if (!isSoftwareKeysLedgerStockProduct(product)) return false;
    if (inFlightIds.has(product.id)) return false;
    if (opts?.onlyIfMissingOrImplausible && !softwareKeyNeedsLedgerRefresh(product)) return false;
    return true;
  });
  if (keys.length === 0) return;

  keys.sort((a, b) => {
    const rank = (product: CatalogProduct) => (
      isImplausibleSoftwareKeyLedgerQty(product.ledgerClosingStock) ? 0
        : Number.isFinite(Number(product.ledgerClosingStock)) ? 2
          : 1
    );
    return rank(a) - rank(b);
  });

  for (const product of keys) {
    inFlightIds.add(product.id);
    try {
      const next = await fetchPlausibleSoftwareKeyClosing(product.id);
      if (next) {
        publishCatalogLedgerClosingStock(product.id, next.closing, next.fetchedAt);
      }
    } catch {
      // keep going — one Zoho miss must not block the rest
    } finally {
      inFlightIds.delete(product.id);
    }
    await sleep(400);
  }
}
