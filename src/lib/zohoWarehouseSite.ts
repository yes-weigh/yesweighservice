import type { StaffLogisticsSite } from '../types/staff-logistics';
import { isStaffLogisticsSite } from '../types/staff-logistics';

/** Map Zoho warehouse id/name to portal ship-from site (Cochin / Head Office). */
export function staffSiteFromZohoWarehouse(input: {
  warehouseId?: string | null;
  warehouseName?: string | null;
}): StaffLogisticsSite | null {
  const name = String(input.warehouseName ?? '').trim().toLowerCase();
  if (name) {
    if (name === 'head office' || (name.includes('head') && name.includes('office'))) {
      return 'head_office';
    }
    if (name === 'cochin' || name.includes('cochin')) {
      return 'cochin';
    }
  }
  return null;
}

export function normalizeStaffLogisticsSite(
  value: string | null | undefined,
  fallback: StaffLogisticsSite = 'cochin',
): StaffLogisticsSite {
  const trimmed = String(value ?? '').trim();
  if (isStaffLogisticsSite(trimmed)) return trimmed;
  return fallback;
}
