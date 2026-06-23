export function formatStorageUploadError(
  err: unknown,
  fallback: string,
  unauthorizedMessage = 'Upload blocked. Sign out, sign back in, and try again.',
): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (message.includes('storage/unauthorized') || message.includes('storage/unauthenticated')) {
    return unauthorizedMessage;
  }
  if (message.includes('storage/quota-exceeded')) {
    return 'Storage quota exceeded. Contact your administrator.';
  }
  if (message.includes('storage/canceled')) {
    return 'Upload was canceled.';
  }
  return message || fallback;
}
