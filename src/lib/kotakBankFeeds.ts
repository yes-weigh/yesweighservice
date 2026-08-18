import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { dealerOrderErrorMessage } from './dealerOrders';

const functions = getFunctions(app, 'asia-south1');

export interface KotakBankFeed {
  transactionId: string;
  date: string | null;
  postedTime?: string | null;
  amount: number;
  debitOrCredit: string | null;
  transactionType?: string | null;
  payee: string | null;
  description: string | null;
  referenceNumber: string | null;
  status: string;
  accountId: string;
  accountName: string;
  bankName: string;
  importedTransactionId: string | null;
}

export interface KotakBankFeedSyncResult {
  feeds: KotakBankFeed[];
  fetchedAt: string;
  count: number;
  accountNames: string[];
}

/** Fetch latest uncategorised Kotak bank feeds from Zoho and store them. */
export async function fetchKotakBankFeeds(): Promise<KotakBankFeedSyncResult> {
  try {
    const fn = httpsCallable<Record<string, never>, KotakBankFeedSyncResult>(
      functions,
      'fetchKotakBankFeedsFn',
      { timeout: 120_000 },
    );
    const result = await fn({});
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}
