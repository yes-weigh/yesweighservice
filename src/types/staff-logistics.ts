import type { CatalogInventorySite } from './catalog-site-inventory';

/** Physical logistics site for HR staff (warehouse / office). */
export type StaffLogisticsSite = CatalogInventorySite;

export const STAFF_LOGISTICS_SITES: StaffLogisticsSite[] = ['cochin', 'head_office'];

export const STAFF_LOGISTICS_SITE_LABELS: Record<StaffLogisticsSite, string> = {
  cochin: 'Cochin',
  head_office: 'Head Office',
};

export function staffLogisticsSiteLabel(
  site: StaffLogisticsSite | null | undefined,
): string {
  if (!site) return '—';
  return STAFF_LOGISTICS_SITE_LABELS[site] ?? site;
}

export function isStaffLogisticsSite(value: unknown): value is StaffLogisticsSite {
  return value === 'cochin' || value === 'head_office';
}
