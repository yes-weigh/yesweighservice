import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');
const LONG_TIMEOUT_MS = 3_600_000;

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (message) return message;
  }
  return 'Invoice operation failed.';
}

export interface InvoiceCategoryBackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  unchanged?: number;
  byCategory?: Partial<Record<'product' | 'spare' | 'service' | 'software_key' | 'gatc', number>>;
  category?: string;
}

/**
 * Reclassify existing Firestore invoices from lineItems.itemId → catalogProducts.
 * No Zoho API calls.
 */
export async function reclassifyInvoiceCategoriesFromCatalog(
  options?: { onlyMissing?: boolean },
): Promise<InvoiceCategoryBackfillResult> {
  const callable = httpsCallable<{ onlyMissing?: boolean }, InvoiceCategoryBackfillResult>(
    functions,
    'reclassifyInvoiceCategoriesFromCatalogFn',
    { timeout: LONG_TIMEOUT_MS },
  );
  try {
    const result = await callable({
      onlyMissing: options?.onlyMissing === true,
    });
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}
