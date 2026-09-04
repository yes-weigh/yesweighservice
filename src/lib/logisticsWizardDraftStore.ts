/**
 * Local resume snapshot for Book Courier.
 * Photos stay in IndexedDB (logisticsPhotoVault); this holds box ids, step, and form fields
 * so an APK reload / process death does not force recapturing inside photos.
 */

import type { LogisticsPartnerId } from '../constants/logisticsPartners';
import {
  isBookCourierStep,
  type BookCourierStep,
} from './logisticsBooking';
import type { LogisticsBookingDraft, ShipmentBoxDraft } from '../types/logistics-dispatch';

const STORAGE_KEY = 'yesweigh.logisticsWizardDraft.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type StoredLogisticsWizardDraft = {
  savedAt: number;
  partnerId: LogisticsPartnerId;
  step: BookCourierStep;
  dealerQuery: string;
  sessionKey: string;
  draft: LogisticsBookingDraft;
};

function stripPhotoUrl(url: string | null | undefined): string {
  const value = String(url ?? '').trim();
  if (!value || value.startsWith('data:')) return '';
  return value;
}

function stripBox(box: ShipmentBoxDraft): ShipmentBoxDraft {
  return {
    ...box,
    photos: box.photos.map(photo => ({
      id: photo.id,
      url: stripPhotoUrl(photo.url),
      storagePath: photo.storagePath ?? null,
    })),
  };
}

export function stripLogisticsDraftForStorage(draft: LogisticsBookingDraft): LogisticsBookingDraft {
  return {
    ...draft,
    boxes: draft.boxes.map(stripBox),
    finalPackagePhoto: stripPhotoUrl(draft.finalPackagePhoto) || null,
  };
}

export function saveLogisticsWizardDraft(input: {
  partnerId: LogisticsPartnerId;
  step: BookCourierStep;
  dealerQuery?: string;
  sessionKey: string;
  draft: LogisticsBookingDraft;
}): void {
  if (typeof localStorage === 'undefined') return;
  if (input.step === 'complete') {
    clearLogisticsWizardDraft();
    return;
  }
  const payload: StoredLogisticsWizardDraft = {
    savedAt: Date.now(),
    partnerId: input.partnerId,
    step: input.step,
    dealerQuery: String(input.dealerQuery ?? '').trim(),
    sessionKey: input.sessionKey,
    draft: stripLogisticsDraftForStorage({ ...input.draft, partnerId: input.partnerId }),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — vault photos still survive in IndexedDB.
  }
}

export function loadLogisticsWizardDraft(): StoredLogisticsWizardDraft | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLogisticsWizardDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!parsed.partnerId || !parsed.draft || !parsed.sessionKey) return null;
    if (!isBookCourierStep(parsed.step) || parsed.step === 'complete') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLogisticsWizardDraft(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when a new invoice/support entry should keep the in-progress capture instead of starting empty. */
export function storedWizardMatchesEntry(
  stored: StoredLogisticsWizardDraft,
  invoiceId?: string | null,
  supportRequestId?: string | null,
  partnerId?: string | null,
): boolean {
  const storedInvoice = stored.draft.invoiceId?.trim() || '';
  const incomingInvoice = invoiceId?.trim() || '';
  if (storedInvoice && incomingInvoice) return storedInvoice === incomingInvoice;
  const storedSupport = stored.draft.supportRequestId?.trim() || '';
  const incomingSupport = supportRequestId?.trim() || '';
  if (storedSupport && incomingSupport) return storedSupport === incomingSupport;
  if (storedInvoice || incomingInvoice || storedSupport || incomingSupport) return false;
  return !partnerId || stored.partnerId === partnerId;
}
