import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

const functions = getFunctions(app, 'asia-south1');

export interface SyncCatalogAuditImagesResult {
  uploadedCount: number;
  linkedItemCount?: number;
  photoCount?: number;
  primaryUpdated?: boolean;
  skipped?: boolean;
  reason?: string;
  syncedKeys?: string[];
}

export interface ReconcileCatalogAuditImagesResult {
  skipped?: boolean;
  reason?: string;
  reconciled?: boolean;
  removedAll?: boolean;
  deletedGalleryCount?: number;
  uploadedCount?: number;
  linkedItemCount?: number;
  photoCount?: number;
  primaryRemoved?: boolean;
  primaryRefreshed?: boolean;
}

function syncErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return 'Could not sync audit photos to Zoho.';
}

export async function syncCatalogAuditImagesToZoho(
  catalogProductId: string,
): Promise<SyncCatalogAuditImagesResult> {
  const callable = httpsCallable<
    { catalogProductId: string },
    SyncCatalogAuditImagesResult
  >(functions, 'syncCatalogAuditImagesToZoho', { timeout: 300_000 });

  try {
    const result = await callable({ catalogProductId });
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}

export async function reconcileCatalogAuditImagesOnZoho(
  catalogProductId: string,
): Promise<ReconcileCatalogAuditImagesResult> {
  const callable = httpsCallable<
    { catalogProductId: string },
    ReconcileCatalogAuditImagesResult
  >(functions, 'reconcileCatalogAuditImagesOnZoho', { timeout: 300_000 });

  try {
    const result = await callable({ catalogProductId });
    return result.data;
  } catch (err) {
    throw new Error(syncErrorMessage(err));
  }
}
