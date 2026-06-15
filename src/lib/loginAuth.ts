import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
} from 'firebase/auth';
import { secondaryAuth } from '../firebase';
import { assertLoginIndexAvailable } from './loginIndex';
import type { LoginIdType } from '../types';

/** Synthetic Firebase Auth domain for phone / Aadhaar IDs. */
export const AUTH_EMAIL_DOMAIN = 'yesweigh.auth';

export const AADHAR_REGEX = /^\d{12}$/;
export const PHONE_REGEX = /^\d{10}$/;

export interface ParsedLoginId {
  type: LoginIdType;
  value: string;
}

export function normalizeDigits(input: string): string {
  return input.replace(/\D/g, '');
}

export function normalizeAadhar(input: string): string {
  return normalizeDigits(input).slice(0, 12);
}

export function normalizePhone(input: string): string {
  return normalizeDigits(input).slice(0, 10);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function isValidAadhar(aadhar: string): boolean {
  return AADHAR_REGEX.test(normalizeAadhar(aadhar));
}

export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(normalizePhone(phone));
}

/** Parse user-entered login ID (email, 10-digit phone, or 12-digit Aadhaar). */
export function parseLoginId(input: string): ParsedLoginId | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed);
    if (!isValidEmail(email)) return null;
    return { type: 'email', value: email };
  }

  const digits = normalizeDigits(trimmed);
  if (digits.length === 12) return { type: 'aadhar', value: digits };
  if (digits.length === 10) return { type: 'phone', value: digits };
  return null;
}

export function authEmailForLoginId(type: LoginIdType, value: string): string {
  if (type === 'email') return value;
  if (type === 'phone') return `p${value}@${AUTH_EMAIL_DOMAIN}`;
  return `${value}@${AUTH_EMAIL_DOMAIN}`;
}

export function formatLoginIdDisplay(type: LoginIdType, value: string): string {
  if (type === 'aadhar' && value.length === 12) {
    return `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8)}`;
  }
  if (type === 'phone' && value.length === 10) {
    return `${value.slice(0, 5)} ${value.slice(5)}`;
  }
  return value;
}

export function loginIdTypeLabel(type: LoginIdType): string {
  if (type === 'aadhar') return 'Aadhaar';
  if (type === 'phone') return 'Phone';
  return 'Email';
}

export async function assertLoginIdAvailable(
  parsed: ParsedLoginId,
  excludeUid?: string,
): Promise<void> {
  await assertLoginIndexAvailable(parsed.type, parsed.value, excludeUid);
}

export async function createAuthUserForLoginId(parsed: ParsedLoginId, password: string) {
  const email = authEmailForLoginId(parsed.type, parsed.value);
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await secondaryAuth.signOut();
  return cred;
}

export async function syncAuthPassword(
  parsed: ParsedLoginId,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const email = authEmailForLoginId(parsed.type, parsed.value);
  const cred = await signInWithEmailAndPassword(secondaryAuth, email, currentPassword);
  await updatePassword(cred.user, newPassword);
  await secondaryAuth.signOut();
}
