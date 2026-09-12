import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export type ZohoApiUsageStatus = 'ok' | 'low' | 'daily_limit' | 'throttled' | string;

export type ZohoApiUsage = {
  source?: string;
  callsToday: number;
  dailyLimit: number;
  remaining: number;
  usagePct: number;
  status: ZohoApiUsageStatus;
  lastError?: string | null;
  fetchedAt?: string | null;
  updatedAt?: string | null;
};

export function zohoUsageBlocksDaytime(usage: ZohoApiUsage | null, minRemaining = 80): boolean {
  if (!usage) return false;
  if (usage.status === 'daily_limit') return true;
  return Number(usage.remaining) <= minRemaining;
}

export function subscribeZohoApiUsage(onNext: (usage: ZohoApiUsage | null) => void): () => void {
  return onSnapshot(
    doc(db, 'zohoMeta', 'apiUsage'),
    snap => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }
      const data = snap.data() || {};
      onNext({
        source: typeof data.source === 'string' ? data.source : undefined,
        callsToday: Number(data.callsToday ?? 0),
        dailyLimit: Number(data.dailyLimit ?? 10_000),
        remaining: Number(data.remaining ?? 0),
        usagePct: Number(data.usagePct ?? 0),
        status: String(data.status ?? 'ok'),
        lastError: typeof data.lastError === 'string' ? data.lastError : null,
        fetchedAt: data.fetchedAt?.toDate?.()?.toISOString?.()
          ?? (typeof data.fetchedAt === 'string' ? data.fetchedAt : null),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.()
          ?? (typeof data.updatedAt === 'string' ? data.updatedAt : null),
      });
    },
    () => onNext(null),
  );
}

export async function refreshZohoApiUsage(): Promise<ZohoApiUsage> {
  const callable = httpsCallable<{ forceRefresh: boolean }, ZohoApiUsage>(
    functions,
    'getZohoApiUsageFn',
  );
  const result = await callable({ forceRefresh: true });
  return result.data;
}

export type ZohoWebhookSettings = {
  secret: string;
  enforceSignature: boolean;
  envSecretConfigured: boolean;
  urls: {
    salesorder: string;
    invoice: string;
    purchaseorder: string;
    goodsreceipt: string;
    item: string;
    customer: string;
  };
};

export async function loadZohoWebhookSettings(): Promise<ZohoWebhookSettings> {
  const callable = httpsCallable<void, ZohoWebhookSettings>(functions, 'getZohoWebhookSettingsFn');
  const result = await callable();
  return result.data;
}

export async function setZohoWebhookEnforce(enforce: boolean): Promise<{
  secret: string;
  enforceSignature: boolean;
}> {
  const callable = httpsCallable<{ enforce: boolean }, { secret: string; enforceSignature: boolean }>(
    functions,
    'setZohoWebhookEnforceFn',
  );
  const result = await callable({ enforce });
  return result.data;
}
