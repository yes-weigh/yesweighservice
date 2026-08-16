import { clearCatalogCache } from './catalog-cache';
import { clearDealerCache } from './dealer-cache';

/** Drop local caches and reload so a phone picks up the latest app and data. */
export async function refreshAppAndData(): Promise<void> {
  clearCatalogCache();
  clearDealerCache();

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(reg => reg.update().catch(() => undefined)));
  }

  window.location.reload();
}
