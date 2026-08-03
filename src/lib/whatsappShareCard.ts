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

export function buildWhatsAppSendUrl(
  text: string,
  phoneOrHref?: string | null,
): string {
  const encoded = encodeURIComponent(text);
  const phone = whatsappPhoneDigits(phoneOrHref);
  if (phone) return `https://wa.me/${phone}?text=${encoded}`;
  return `https://wa.me/?text=${encoded}`;
}

/**
 * Open a blank tab synchronously (must run in the click handler before awaits)
 * so WhatsApp can still open after async capture/upload.
 */
export function prepareWhatsAppWindow(): Window | null {
  try {
    const win = window.open('about:blank', 'yw-wa-share');
    if (win) {
      try {
        win.document.title = 'Opening WhatsApp…';
        win.document.body.innerHTML =
          '<p style="font-family:sans-serif;padding:1.5rem">Opening WhatsApp…</p>';
      } catch {
        // cross-origin / opaque — ignore
      }
    }
    return win;
  } catch {
    return null;
  }
}

/** Open WhatsApp app/web directly (no system share sheet). Optional phone opens that chat. */
export function openWhatsAppWithText(
  text: string,
  phoneOrHref?: string | null,
  existingWindow?: Window | null,
): void {
  const encoded = encodeURIComponent(text);
  const phone = whatsappPhoneDigits(phoneOrHref);
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const waMe = buildWhatsAppSendUrl(text, phoneOrHref);

  const navigate = (url: string) => {
    if (existingWindow && !existingWindow.closed) {
      try {
        existingWindow.location.href = url;
        existingWindow.focus();
        return;
      } catch {
        // fall through
      }
    }
    try {
      const opened = window.open(url, 'yw-wa-share');
      if (opened) {
        opened.focus();
        return;
      }
    } catch {
      // fall through
    }
    // Last resort (works for Android intent handoff after async work).
    window.location.assign(url);
  };

  if (isAndroid) {
    const fallback = encodeURIComponent(waMe);
    const phonePart = phone ? `phone=${phone}&` : '';
    navigate(
      `intent://send?${phonePart}text=${encoded}`
      + '#Intent;scheme=whatsapp;package=com.whatsapp;'
      + `S.browser_fallback_url=${fallback};end`,
    );
    return;
  }

  if (isIos) {
    navigate(
      phone
        ? `whatsapp://send?phone=${phone}&text=${encoded}`
        : `whatsapp://send?text=${encoded}`,
    );
    return;
  }

  navigate(
    phone
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`
      : `https://web.whatsapp.com/send?text=${encoded}`,
  );
}
