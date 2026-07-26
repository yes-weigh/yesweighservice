/** Copy text to the clipboard; works after async gaps (Firestore, etc.). */
export async function copyTextToClipboard(text: string): Promise<void> {
  const value = text.trim();
  if (!value) throw new Error('Nothing to copy.');

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through — user activation often expires after await.
  }

  const el = document.createElement('textarea');
  el.value = value;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, value.length);
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  if (!ok) throw new Error('Could not copy to clipboard.');
}
