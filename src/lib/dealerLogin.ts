import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { normalizePhone, isValidPhone } from './loginAuth';

const functions = getFunctions(app, 'asia-south1');

export type DealerLookupOption = {
  dealerId: string;
  displayName: string;
  hasPortalAccount: boolean;
  companyName?: string | null;
  district?: string | null;
  billingState?: string | null;
};

export type DealerLookupResult = {
  found: boolean;
  multiple?: boolean;
  dealers?: DealerLookupOption[];
  dealerId?: string;
  displayName?: string;
  hasPortalAccount?: boolean;
};

export type DealerOtpSendResult = {
  sent: boolean;
  expiresInSeconds: number;
};

export type DealerOtpVerifyResult = {
  verified: boolean;
  setupToken: string;
  displayName: string;
};

export type DealerSignupResult = {
  uid: string;
  displayName: string;
};

function parsePhone(input: string): string {
  const phone = normalizePhone(input);
  if (!isValidPhone(phone)) {
    throw new Error('Enter a valid 10-digit mobile number.');
  }
  return phone;
}

function callableError(err: unknown, fallback: string): Error {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const fbErr = err as { code?: string; message: string };
    if (fbErr.code?.startsWith('functions/') && fbErr.message) {
      return new Error(fbErr.message);
    }
  }
  return new Error(fallback);
}

export async function lookupDealerByPhone(phoneInput: string): Promise<DealerLookupResult> {
  const phone = parsePhone(phoneInput);
  const fn = httpsCallable<{ phone: string }, DealerLookupResult>(functions, 'dealerLoginLookup');
  try {
    const result = await fn({ phone });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not look up dealer.');
  }
}

export async function sendDealerLoginOtp(
  phoneInput: string,
  dealerId: string,
): Promise<DealerOtpSendResult> {
  const phone = parsePhone(phoneInput);
  const trimmedDealerId = dealerId.trim();
  if (!trimmedDealerId) {
    throw new Error('Select which dealer account to use.');
  }
  const fn = httpsCallable<{ phone: string; dealerId: string }, DealerOtpSendResult>(
    functions,
    'sendDealerLoginOtp',
  );
  try {
    const result = await fn({ phone, dealerId: trimmedDealerId });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not send OTP.');
  }
}

export async function verifyDealerLoginOtp(
  phoneInput: string,
  code: string,
): Promise<DealerOtpVerifyResult> {
  const phone = parsePhone(phoneInput);
  const fn = httpsCallable<{ phone: string; code: string }, DealerOtpVerifyResult>(
    functions,
    'verifyDealerLoginOtp',
  );
  try {
    const result = await fn({ phone, code: code.trim() });
    return result.data;
  } catch (err) {
    throw callableError(err, 'OTP verification failed.');
  }
}

export async function completeDealerSignup(
  phoneInput: string,
  setupToken: string,
  password: string,
): Promise<DealerSignupResult> {
  const phone = parsePhone(phoneInput);
  const fn = httpsCallable<
    { phone: string; setupToken: string; password: string },
    DealerSignupResult
  >(functions, 'completeDealerSignup');
  try {
    const result = await fn({ phone, setupToken, password: password.trim() });
    return result.data;
  } catch (err) {
    throw callableError(err, 'Could not complete signup.');
  }
}
