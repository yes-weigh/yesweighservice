import type { CatalogInventorySite } from './catalog-site-inventory';

export type AuditCycleStatus = 'scheduled' | 'open' | 'closed';

export type AuditCycleSite = CatalogInventorySite;

export interface AuditCycleDoc {
  id: string;
  site: AuditCycleSite;
  name: string;
  status: AuditCycleStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  createdByUid: string | null;
  createdByName: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export function auditCycleSiteLabel(site: AuditCycleSite): string {
  return site === 'head_office' ? 'Head Office' : 'Cochin';
}
