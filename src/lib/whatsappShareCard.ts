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

/** Open WhatsApp app/web directly (no system share sheet). */
export function openWhatsAppWithText(text: string): void {
  const encoded = encodeURIComponent(text);
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    // Opens WhatsApp (or Business) directly; falls back to wa.me in the browser
    const fallback = encodeURIComponent(`https://wa.me/?text=${encoded}`);
    window.location.href =
      `intent://send?text=${encoded}`
      + '#Intent;scheme=whatsapp;package=com.whatsapp;'
      + `S.browser_fallback_url=${fallback};end`;
    return;
  }

  if (isIos) {
    window.location.href = `whatsapp://send?text=${encoded}`;
    return;
  }

  window.open(`https://web.whatsapp.com/send?text=${encoded}`, '_blank', 'noopener,noreferrer');
}
