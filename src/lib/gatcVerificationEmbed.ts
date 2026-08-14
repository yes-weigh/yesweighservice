import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const functions = getFunctions(app, 'asia-south1');

export const GATC_VERIFICATION_EMBED_FALLBACK = 'https://yesgatc.in/rc/verification?embed=1';

export async function getGatcVerificationEmbedSrc(): Promise<string> {
  const fn = httpsCallable<{ }, { src?: string }>(functions, 'getGatcVerificationEmbedToken');
  const result = await fn();
  const src = String(result.data?.src ?? '').trim();
  return src || GATC_VERIFICATION_EMBED_FALLBACK;
}
