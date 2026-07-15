export type AuditReturnLinkFilter = 'all' | 'linked' | 'unlinked';

export interface AuditReturnFocus {
  itemId?: string;
  catalogProductId?: string;
  page?: number;
  scrollY?: number;
  rackFilter?: string | null;
  rowFilter?: number | null;
  linkFilter?: AuditReturnLinkFilter;
  /** After a successful link, prefer a filter that still shows the item. */
  afterLink?: boolean;
  savedAt: number;
}

const AUDIT_RETURN_FOCUS_KEY = 'yesweigh.inventoryAudit.returnFocus';

export function rememberAuditReturnFocus(
  focus: Omit<AuditReturnFocus, 'savedAt'>,
): void {
  try {
    const payload: AuditReturnFocus = { ...focus, savedAt: Date.now() };
    sessionStorage.setItem(AUDIT_RETURN_FOCUS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

export function peekAuditReturnFocus(maxAgeMs = 30 * 60 * 1000): AuditReturnFocus | null {
  try {
    const raw = sessionStorage.getItem(AUDIT_RETURN_FOCUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuditReturnFocus;
    if (!parsed?.itemId && !parsed?.catalogProductId) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > maxAgeMs) {
      sessionStorage.removeItem(AUDIT_RETURN_FOCUS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAuditReturnFocus(): void {
  try {
    sessionStorage.removeItem(AUDIT_RETURN_FOCUS_KEY);
  } catch {
    // ignore
  }
}

export function inventoryAuditListPath(base: string): string {
  return `${base}?section=inventory-audit`;
}
