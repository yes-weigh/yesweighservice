import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { app, db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { isDealerPortalUser, resolveDealerAccountUid } from './dealerAccess';

const functions = getFunctions(app, 'asia-south1');

export function dealerCatalogMrpDocPath(dealerUid: string, productId: string) {
  return `dealerCatalogMrp/${dealerUid}/products/${productId}`;
}

export function parseDealerCatalogMrp(raw: unknown): number | null {
  const mrp = Number(raw);
  if (!Number.isFinite(mrp) || mrp <= 0) return null;
  return Math.round(mrp * 100) / 100;
}

export async function saveDealerCatalogMrp(
  productId: string,
  mrp: number | null,
): Promise<number | null> {
  const fn = httpsCallable<{ productId: string; mrp: number | null }, { mrp: number | null }>(
    functions,
    'setDealerCatalogMrpFn',
  );
  const result = await fn({ productId, mrp });
  return parseDealerCatalogMrp(result.data?.mrp);
}

export function dealerCatalogMrpErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: string }).code) : '';
    const message = 'message' in err ? String((err as { message: string }).message) : '';
    if (code === 'functions/not-found' || message.includes('not-found')) {
      return 'Could not save MRP. Deploy Cloud Functions, then try again.';
    }
    if (message) return message.replace(/^FirebaseError:\s*/i, '');
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Could not save MRP.';
}

/** Live custom MRP for the signed-in dealer on one catalog product. */
export function useDealerCatalogMrp(productId: string | null | undefined): {
  mrp: number | null;
  ready: boolean;
} {
  const { user } = useAuth();
  const dealerUid = isDealerPortalUser(user) ? resolveDealerAccountUid(user) : null;
  const [mrp, setMrp] = useState<number | null>(null);
  const [ready, setReady] = useState(!productId || !dealerUid);

  useEffect(() => {
    const id = productId?.trim() ?? '';
    if (!dealerUid || !id) {
      setMrp(null);
      setReady(true);
      return;
    }
    setReady(false);
    const unsub = onSnapshot(
      doc(db, 'dealerCatalogMrp', dealerUid, 'products', id),
      snap => {
        setMrp(parseDealerCatalogMrp(snap.data()?.mrp));
        setReady(true);
      },
      () => {
        setMrp(null);
        setReady(true);
      },
    );
    return unsub;
  }, [dealerUid, productId]);

  return { mrp, ready };
}
