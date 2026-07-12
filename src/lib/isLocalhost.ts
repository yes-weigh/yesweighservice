/** Developer-only UI: visible when running on localhost / 127.0.0.1. */
export function isLocalhostDev(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
