import type { FirestoreUserDoc, LoginIdType } from '../types';
import {
  isValidAadhar,
  isValidEmail,
  isValidPhone,
  normalizeAadhar,
  normalizeEmail,
  normalizePhone,
  type ParsedLoginId,
} from './loginAuth';

export function resolveProfileLogin(data: FirestoreUserDoc): ParsedLoginId | null {
  if (data.loginId && data.loginIdType) {
    return { type: data.loginIdType, value: data.loginId };
  }

  if (data.aadhar && isValidAadhar(data.aadhar)) {
    return { type: 'aadhar', value: normalizeAadhar(data.aadhar) };
  }
  if (data.phone && isValidPhone(data.phone)) {
    return { type: 'phone', value: normalizePhone(data.phone) };
  }
  if (data.email && isValidEmail(data.email)) {
    return { type: 'email', value: normalizeEmail(data.email) };
  }
  return null;
}

export function contactFieldsForLogin(parsed: ParsedLoginId): {
  aadhar?: string;
  phone?: string;
  email?: string;
} {
  if (parsed.type === 'aadhar') return { aadhar: parsed.value };
  if (parsed.type === 'phone') return { phone: parsed.value };
  if (parsed.type === 'username') return {};
  return { email: parsed.value };
}

export function loginIdTypeFromValue(value: string): LoginIdType | null {
  if (value.includes('@')) return 'email';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits === value.replace(/\s/g, '')) return 'aadhar';
  if (digits.length === 10 && digits === value.replace(/\s/g, '')) return 'phone';
  return 'username';
}
