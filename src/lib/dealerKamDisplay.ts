import type { ZohoDealer } from '../types/dealers';
import type { LogisticsBooking } from '../types/logistics-dispatch';

/** Super-admin names that must not appear in dealer KAM pickers. */
export function isHiddenKamName(name: string | null | undefined): boolean {
  return /\bshibin\b/i.test(String(name ?? ''));
}

const PORTAL_KAM_KEEP = new Set([
  'biju b',
  'safna',
  'visakh b',
  'supriya',
  'namratha',
  'sarita solanki',
  'saritha solanki',
]);

const SALESPERSON_NAME_MERGE: Record<string, string> = {
  'visakh inside kerala': 'Visakh B',
  'visakh spares': 'Visakh B',
  'visakh oem': 'Visakh B',
  'visakh outside kerala': 'Visakh B',
  'visak b': 'Visakh B',
  'safna directors': 'Safna',
  'safana': 'Safna',
  'biju spare': 'Biju B',
  'biju oem': 'Biju B',
  'biju directors': 'Biju B',
  'biju inside kerala': 'Biju B',
  'biju outside kerala': 'Biju B',
  'namrata oem': 'Namratha',
  'namratha spare': 'Namratha',
  'namratha inside kerala': 'Namratha',
  'namratha outside kerala': 'Namratha',
};

function normalizeSalespersonNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()[\]]+/g, ' ')
    .replace(/[-_/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True for the six KAMs shown in portal pickers / GATC filters. */
export function isPortalVisibleKamName(name: string | null | undefined): boolean {
  const canonical = canonicalSalespersonName(name);
  if (!canonical || isHiddenKamName(canonical)) return false;
  return PORTAL_KAM_KEEP.has(normalizeSalespersonNameKey(canonical));
}

/** Collapse legacy Zoho salesperson labels onto the current KAM name. */
export function canonicalSalespersonName(name: string | null | undefined): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  return SALESPERSON_NAME_MERGE[normalizeSalespersonNameKey(raw)] || raw;
}

export function portalKamKey(name: string | null | undefined): string {
  return normalizeSalespersonNameKey(canonicalSalespersonName(name));
}

/** One option per portal KAM — aliases share the original’s id/name. */
export function collapseToPortalKamOptions(
  rows: Array<{ id: string; name: string; active?: boolean }>,
): Array<{ id: string; name: string }> {
  const keepers = new Map<string, { id: string; name: string; exact: boolean }>();
  for (const row of rows) {
    if (row.active === false) continue;
    if (!isPortalVisibleKamName(row.name)) continue;
    const name = canonicalSalespersonName(row.name);
    if (!name) continue;
    const exact = row.name.trim() === name;
    const current = keepers.get(name);
    if (!current || (exact && !current.exact)) {
      keepers.set(name, { id: row.id, name, exact });
    }
  }
  return [...keepers.values()]
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function portalKamIdForSalesperson(
  salespersonId: string | null | undefined,
  salespersonName: string | null | undefined,
  options: Array<{ id: string; name: string }>,
): string {
  const id = String(salespersonId ?? '').trim();
  if (id && options.some(row => row.id === id)) return id;
  const name = canonicalSalespersonName(salespersonName);
  if (name) {
    const match = options.find(row => row.name === name);
    if (match) return match.id;
  }
  return '';
}

export function buildDealerStaffNameMap(dealers: ZohoDealer[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const dealer of dealers) {
    const name = dealer.assignedStaffName?.trim();
    if (name) next[dealer.id] = name;
  }
  return next;
}

export function resolveDealerKamName(input: {
  zohoCustomerId?: string | null;
  documentSalespersonName?: string | null;
  dealerStaffById: Record<string, string>;
  snapshotAssignedStaffName?: string | null;
}): string {
  const snap = input.snapshotAssignedStaffName?.trim();
  if (snap) return snap;
  const id = input.zohoCustomerId?.trim();
  if (id) {
    const assigned = input.dealerStaffById[id]?.trim();
    if (assigned) return assigned;
  }
  return input.documentSalespersonName?.trim() || '';
}

export function bookingStaffName(
  booking: LogisticsBooking,
  dealerStaffById: Record<string, string>,
  invoiceSalespersonName?: string | null,
): string {
  return resolveDealerKamName({
    zohoCustomerId: booking.dealer.zohoCustomerId,
    documentSalespersonName: invoiceSalespersonName,
    dealerStaffById,
    snapshotAssignedStaffName: booking.dealer.assignedStaffName,
  });
}
