import type { CatalogInventorySite } from './catalog-site-inventory';

export const MAX_NC_PHOTOS_PER_LINE = 2;

export const NC_REASON_OPTIONS = [
  { key: 'display_issue', label: 'Display issue' },
  { key: 'missing_part', label: 'Missing part / incomplete' },
  { key: 'physical_damage', label: 'Physical damage' },
  { key: 'wrong_item', label: 'Wrong / mismatched item' },
  { key: 'packaging_damaged', label: 'Packaging damaged' },
  { key: 'water_corrosion', label: 'Water / corrosion' },
  { key: 'other', label: 'Other' },
] as const;

export type NcReasonCode = typeof NC_REASON_OPTIONS[number]['key'];

export const NC_RESOLVE_OUTCOMES = [
  { key: 'repaired', label: 'Repaired' },
  { key: 'returned', label: 'Return to vendor' },
  { key: 'scrapped', label: 'Scrapped' },
  { key: 'restored', label: 'Back to good stock' },
] as const;

export type NcResolveOutcome = typeof NC_RESOLVE_OUTCOMES[number]['key'];

export type NcLineStatus = 'open' | NcResolveOutcome;

export interface CatalogNcPhoto {
  id: string;
  url: string;
  storagePath: string;
  fileName: string;
  uploadedAt: string;
}

export interface CatalogNcLocationKey {
  site: CatalogInventorySite;
  /** Cochin warehouse */
  zoneId?: string | null;
  zoneRowNumber?: number | null;
  /** Head Office store room */
  rackId?: string | null;
  rowNumber?: number | null;
  binNumber?: number | null;
}

export interface CatalogNcLine {
  id: string;
  qty: number;
  reasonCode: NcReasonCode;
  reasonText: string | null;
  photos: CatalogNcPhoto[];
  status: NcLineStatus;
  createdAt: string;
  createdByUid: string | null;
  createdByName: string | null;
  resolvedAt: string | null;
  resolvedByUid: string | null;
  resolvedByName: string | null;
  resolveNote: string | null;
}

export interface CatalogNcLocation extends CatalogNcLocationKey {
  id: string;
  openNcQty: number;
  lines: CatalogNcLine[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogNcEvent {
  id: string;
  type:
    | 'location_added'
    | 'line_added'
    | 'line_updated'
    | 'photos_updated'
    | 'line_resolved'
    | 'line_split_resolved';
  at: string;
  byUid: string | null;
  byName: string | null;
  locationId: string | null;
  lineId: string | null;
  summary: string;
  qty?: number | null;
  outcome?: NcResolveOutcome | null;
}

export interface CatalogNcDoc {
  id: string;
  catalogProductId: string;
  site: CatalogInventorySite;
  openNcQty: number;
  locations: CatalogNcLocation[];
  events: CatalogNcEvent[];
  updatedAt: string;
  updatedByUid: string | null;
  updatedByName: string | null;
}

export function ncReasonLabel(code: NcReasonCode, reasonText?: string | null): string {
  if (code === 'other' && reasonText?.trim()) return reasonText.trim();
  return NC_REASON_OPTIONS.find(option => option.key === code)?.label ?? code;
}

export function formatNcLocationLabel(location: CatalogNcLocationKey): string {
  if (location.site === 'cochin') {
    const zone = (location.zoneId ?? '').trim().toUpperCase() || '?';
    const row = location.zoneRowNumber ?? '?';
    return `Zone ${zone} · Row ${row}`;
  }
  const rack = (location.rackId ?? '').trim().toUpperCase() || '?';
  const row = location.rowNumber ?? '?';
  const bin = location.binNumber ?? '?';
  return `Rack ${rack} · Row ${row} · Bin ${bin}`;
}

export function ncLocationKey(location: CatalogNcLocationKey): string {
  if (location.site === 'cochin') {
    return `cochin:${(location.zoneId ?? '').trim().toLowerCase()}:${location.zoneRowNumber ?? 0}`;
  }
  return [
    'head_office',
    (location.rackId ?? '').trim().toLowerCase(),
    location.rowNumber ?? 0,
    location.binNumber ?? 0,
  ].join(':');
}
