import { where, type QueryConstraint } from 'firebase/firestore';
import type { User } from '../types';
import { normalizeZohoSalespersonLinks } from './zohoSalespersonStaff';

/** Firestore `in` supports at most 30 values. */
const MAX_IN = 30;

/**
 * Staff → linked Zoho salesperson ids (may be empty).
 * Other roles → `undefined` (no salesperson filter).
 */
export function salespersonScopeForUser(user: User | null | undefined): string[] | undefined {
  if (!user || user.role !== 'staff') return undefined;
  return normalizeZohoSalespersonLinks(user).map(link => link.id);
}

export function normalizeSalespersonIdFilter(
  salespersonIds: string[] | null | undefined,
): string[] | null {
  if (salespersonIds == null) return null;
  return [...new Set(
    salespersonIds.map(id => String(id ?? '').trim()).filter(Boolean),
  )].slice(0, MAX_IN);
}

/**
 * Appends `salespersonId in [...]` when scoped.
 * Returns `'empty'` when the scope is present but has no ids (caller should skip the query).
 */
export function appendSalespersonIdConstraint(
  constraints: QueryConstraint[],
  salespersonIds: string[] | null | undefined,
): 'ok' | 'empty' {
  const ids = normalizeSalespersonIdFilter(salespersonIds);
  if (ids == null) return 'ok';
  if (!ids.length) return 'empty';
  constraints.push(where('salespersonId', 'in', ids));
  return 'ok';
}

/** Staff may only open docs whose salespersonId is in their linked Zoho ids. */
export function staffCanAccessSalespersonDoc(
  user: User | null | undefined,
  salespersonId: string | null | undefined,
): boolean {
  if (!user || user.role !== 'staff') return true;
  const scope = salespersonScopeForUser(user) ?? [];
  const id = String(salespersonId ?? '').trim();
  return Boolean(id && scope.includes(id));
}

export function filterRowsBySalespersonScope<T extends { salespersonId?: string | null }>(
  rows: T[],
  salespersonIds: string[] | null | undefined,
): T[] {
  const ids = normalizeSalespersonIdFilter(salespersonIds);
  if (ids == null) return rows;
  if (!ids.length) return [];
  const allowed = new Set(ids);
  return rows.filter(row => {
    const id = String(row.salespersonId ?? '').trim();
    return Boolean(id && allowed.has(id));
  });
}
