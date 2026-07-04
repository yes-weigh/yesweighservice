export interface WarehouseZoneDoc {
  id: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseZoneRowDoc {
  id: string;
  zoneId: string;
  number: number;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export function warehouseZoneRowDocId(zoneId: string, rowNumber: number): string {
  return `${zoneId.toLowerCase()}_${rowNumber}`;
}

export function normalizeZoneId(value: string): string {
  return value.trim().toLowerCase().slice(0, 1);
}

export function isValidZoneId(value: string): boolean {
  return /^[a-z]$/.test(normalizeZoneId(value));
}
