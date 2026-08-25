import { hydrateCatalogCacheFromDisk } from './catalog-cache';
import { hydrateDealersCacheFromDisk } from './dealer-cache';

/** Load last catalog / dealer tables from phone storage before the first screen paints. */
export async function hydrateAppDisplayCaches(): Promise<void> {
  await Promise.all([
    hydrateCatalogCacheFromDisk(),
    hydrateDealersCacheFromDisk(),
  ]);
}
