import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../firebase';
import { formatStorageUploadError } from './storageErrors';

/** Upload share-card PNG and return a public download URL WhatsApp can open. */
export async function uploadWhatsAppShareCard(
  blob: Blob,
  fileName: string,
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Sign in to share on WhatsApp.');
  }

  const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(0, 48) || 'share.png';
  const path = `whatsappShares/${uid}/${Date.now()}-${safe}`;
  try {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob, {
      contentType: 'image/png',
      cacheControl: 'public,max-age=86400',
    });
    return await getDownloadURL(storageRef);
  } catch (err) {
    throw new Error(formatStorageUploadError(
      err,
      'Could not prepare share image.',
      'Could not prepare share image. Sign out, sign back in, and try again.',
    ));
  }
}

/**
 * Normalize a phone or wa.me URL to international digits for WhatsApp deep links.
 * Indian 10-digit numbers become `91…`.
 */
export function whatsappPhoneDigits(
  phoneOrHref: string | null | undefined,
): string | null {
  const raw = String(phoneOrHref || '').trim();
  if (!raw) return null;

  const fromHref = /wa\.me\/(\d+)/i.exec(raw)?.[1]
    || /[?&]phone=(\d+)/i.exec(raw)?.[1];
  if (fromHref && fromHref.length >= 10) return fromHref;

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11) return digits;
  return null;
}

/** Open WhatsApp app/web directly (no system share sheet). Optional phone opens that chat. */
export function openWhatsAppWithText(
  text: string,
  phoneOrHref?: string | null,
): void {
  const encoded = encodeURIComponent(text);
  const phone = whatsappPhoneDigits(phoneOrHref);
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const waMe = phone
    ? `https://wa.me/${phone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  if (isAndroid) {
    const fallback = encodeURIComponent(waMe);
    const phonePart = phone ? `phone=${phone}&` : '';
    window.location.href =
      `intent://send?${phonePart}text=${encoded}`
      + '#Intent;scheme=whatsapp;package=com.whatsapp;'
      + `S.browser_fallback_url=${fallback};end`;
    return;
  }

  if (isIos) {
    window.location.href = phone
      ? `whatsapp://send?phone=${phone}&text=${encoded}`
      : `whatsapp://send?text=${encoded}`;
    return;
  }

  window.open(
    phone
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`,
    '_blank',
    'noopener,noreferrer',
  );
}
