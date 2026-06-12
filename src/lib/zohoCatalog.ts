import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { app } from '../firebase';
import type { ZohoCatalogResponse } from '../types/zoho';

const functions = getFunctions(app, 'asia-south1');

function callableErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unable to load products from Zoho Inventory.';
}

export async function fetchZohoCatalog(): Promise<ZohoCatalogResponse> {
  const callable = httpsCallable<undefined, ZohoCatalogResponse>(functions, 'getZohoCatalog');
  try {
    const result = await callable();
    return result.data;
  } catch (error) {
    throw new Error(callableErrorMessage(error), { cause: error });
  }
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}
