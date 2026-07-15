import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

const functions = getFunctions(app, 'asia-south1');

export interface ReconcileStaleAuditSnapshotsSummary {
  dryRun: boolean;
  openCycleId: string;
  candidates: number;
  updated: number;
  skippedInSync: number;
  skippedNoProduct: number;
  skippedNoLiveData: number;
  errors: Array<{ productId: string; message: string }>;
  samples: Array<{
    productId: string;
    sku?: string | null;
    name?: string | null;
    frozen: number | null;
    live: number;
    delta: number;
  }>;
}

export async function reconcileStaleAuditSnapshots(options: {
  dryRun?: boolean;
} = {}): Promise<ReconcileStaleAuditSnapshotsSummary> {
  const callable = httpsCallable<
    { dryRun?: boolean },
    ReconcileStaleAuditSnapshotsSummary
  >(functions, 'reconcileStaleAuditSnapshotsFn', { timeout: 540_000 });

  const result = await callable({
    dryRun: Boolean(options.dryRun),
  });
  return result.data;
}
