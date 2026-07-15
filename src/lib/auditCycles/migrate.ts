import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

const functions = getFunctions(app, 'asia-south1');

export interface MigrateAuditsIntoCyclesSummary {
  dryRun: boolean;
  force: boolean;
  headOfficeCycle: { id: string | null; created: boolean; name: string } | null;
  cochinCycle: { id: string | null; created: boolean; name: string } | null;
  backfill?: {
    created?: number;
    skippedHasSnapshot?: number;
    candidates?: number;
  } | null;
  productsScanned: number;
  stampedHeadOffice: number;
  stampedCochin: number;
  skippedAlreadyStamped: number;
  skippedNoSnapshot: number;
  skippedNoSiteEvidence: number;
  errors: Array<{ productId: string; message: string }>;
  samples: Array<Record<string, unknown>>;
}

export async function migrateAuditsIntoCycles(options: {
  dryRun?: boolean;
  force?: boolean;
} = {}): Promise<MigrateAuditsIntoCyclesSummary> {
  const callable = httpsCallable<
    { dryRun?: boolean; force?: boolean },
    MigrateAuditsIntoCyclesSummary
  >(functions, 'migrateAuditsIntoCyclesFn', { timeout: 540_000 });

  const result = await callable({
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
  });
  return result.data;
}
