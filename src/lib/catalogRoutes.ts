import type { Role } from '../types';
import { homePathForRole } from '../types';

export type CatalogSection = 'products' | 'spares' | 'map' | 'unlinked';

export function catalogBaseForRole(role: Role): string {
  return `${homePathForRole(role)}/catalog`;
}

export function catalogHref(role: Role, section: CatalogSection = 'products'): string {
  const base = catalogBaseForRole(role);
  if (section === 'products') return base;
  return `${base}?section=${section}`;
}

export function parseCatalogSection(
  value: string | null,
  allowOpsSections: boolean,
): CatalogSection {
  if (value === 'spares') return 'spares';
  if (allowOpsSections && value === 'map') return 'map';
  if (allowOpsSections && value === 'unlinked') return 'unlinked';
  return 'products';
}

export function isCatalogSpareDetailPath(pathname: string): boolean {
  return /\/catalog\/spare\/[^/]+$/.test(pathname);
}

export function isCatalogMapPath(pathname: string): boolean {
  return /\/catalog\/map\/[^/]+$/.test(pathname);
}

export function isCatalogProductDetailPath(pathname: string): boolean {
  return /\/catalog\/[^/]+$/.test(pathname)
    && !isCatalogSpareDetailPath(pathname)
    && !isCatalogMapPath(pathname)
    && !pathname.endsWith('/catalog');
}

/** @deprecated legacy paths */
export function isLegacySpareDetailPath(pathname: string): boolean {
  return /\/spares\/[^/]+$/.test(pathname) && !/\/spares\/product\//.test(pathname);
}
