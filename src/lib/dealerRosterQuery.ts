import type { DocumentData } from 'firebase/firestore';
import type { DealerListParams, DealerStats, ZohoContactPerson, ZohoDealer } from '../types/dealers';
import { getDealerStatusKey } from './dealerStatus';
import {
  canonicalKeralaDistrict,
  isKeralaBillingState,
  KERALA_DISTRICTS,
  UNSPECIFIED_DISTRICT,
} from './keralaDistricts';

function parseList(value: unknown): string[] {
  if (!value || value === 'all') return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCategories(categories: unknown): string[] {
  if (!categories) return [];
  if (Array.isArray(categories)) return categories.map(String);
  if (typeof categories === 'string') {
    try {
      const parsed = JSON.parse(categories);
      return Array.isArray(parsed) ? parsed.map(String) : [categories];
    } catch {
      return [categories];
    }
  }
  return [];
}

function mapPrimaryContact(value: unknown): ZohoContactPerson | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    id: asString(row.id),
    salutation: asString(row.salutation),
    firstName: asString(row.firstName),
    lastName: asString(row.lastName),
    name: asString(row.name),
    email: asString(row.email),
    phone: asString(row.phone),
    mobile: asString(row.mobile),
    designation: asString(row.designation),
    department: asString(row.department),
    isPrimary: Boolean(row.isPrimary),
    isAddedInPortal: Boolean(row.isAddedInPortal),
  };
}

export function mapZohoCustomerDoc(id: string, data: DocumentData): ZohoDealer {
  const portalUserId = asString(data.portalUserId);
  const primary = mapPrimaryContact(data.zohoPrimaryContact);
  return {
    id,
    contactName: asString(data.contactName) ?? '',
    firstName: asString(data.firstName),
    companyName: asString(data.companyName),
    email: asString(data.email),
    zohoEmail: asString(data.zohoEmail) ?? asString(data.email),
    phone: asString(data.phone),
    mobile: asString(data.mobile) ?? primary?.mobile ?? null,
    status: asString(data.status) ?? 'active',
    outstandingReceivable: asNumber(data.outstandingReceivable),
    unusedCredits: asNumber(data.unusedCredits),
    syncedAt: asString(data.syncedAt),
    isFiltered: Boolean(data.isFiltered),
    filterReason: asString(data.filterReason),
    assignedStaffUid: asString(data.assignedStaffUid),
    assignedStaffName: asString(data.assignedStaffName),
    dealerStage: asString(data.dealerStage),
    billingState: asString(data.billingState),
    district: asString(data.district),
    zipCode: asString(data.zipCode),
    categories: normalizeCategories(data.categories),
    portalUserId,
    portalUserName: asString(data.portalUserName),
    portalLoginId: asString(data.portalLoginId),
    signedIn: Boolean(portalUserId),
    designation: asString(data.designation),
    alternateMobile: asString(data.alternateMobile),
    whatsappNumber: asString(data.whatsappNumber),
    zohoPrimaryContact: primary,
  };
}

export function filterDealerRoster(dealers: ZohoDealer[], query: DealerListParams): ZohoDealer[] {
  let list = dealers;
  const stages = parseList(query.dealerStage);
  const statusKeys = parseList(query.dealerStatus);

  const q = query.q?.trim().toLowerCase() ?? '';

  if (!stages.length && !statusKeys.length) {
    list = list.filter(d => !d.isFiltered);
    if (!q) {
      list = list.filter(d => classifyStage(d.dealerStage) !== 'unstaged');
    }
  }

  if (q) {
    const qDigits = q.replace(/\D/g, '');
    list = list.filter(d => {
      const nameHit = d.contactName.toLowerCase().includes(q)
        || (d.companyName ?? '').toLowerCase().includes(q)
        || (d.email ?? '').toLowerCase().includes(q)
        || (d.firstName ?? '').toLowerCase().includes(q);
      if (nameHit) return true;
      if (qDigits.length < 4) return false;
      const phones = [d.phone, d.mobile, d.alternateMobile, d.whatsappNumber]
        .map(value => String(value ?? '').replace(/\D/g, ''))
        .filter(Boolean);
      return phones.some(phone => (
        phone.includes(qDigits)
        || (qDigits.length >= 10 && phone.slice(-10) === qDigits.slice(-10))
      ));
    });
  }

  if (query.status && query.status !== 'all') {
    list = list.filter(d => d.status === query.status);
  }

  if (query.assignment === 'unassigned') {
    list = list.filter(d => !d.assignedStaffUid);
  } else if (query.assignment === 'assigned') {
    list = list.filter(d => Boolean(d.assignedStaffUid));
  }

  const staffIds = parseList(query.assignedStaffUid).filter(id => id !== 'unassigned');
  if (staffIds.length > 0) {
    list = list.filter(d => d.assignedStaffUid && staffIds.includes(d.assignedStaffUid));
  }

  if (stages.length > 0) {
    list = list.filter(d => d.dealerStage && stages.includes(d.dealerStage));
  }

  if (statusKeys.length > 0) {
    list = list.filter(d => statusKeys.includes(getDealerStatusKey(d)));
  }

  const states = parseList(query.billingState);
  if (states.length > 0) {
    list = list.filter(d => d.billingState && states.includes(d.billingState));
  }

  const districts = parseList(query.district);
  if (districts.length > 0) {
    const wanted = new Set(districts);
    list = list.filter(d => {
      const raw = String(d.district ?? '').trim();
      if (!raw) return false;
      if (wanted.has(raw)) return true;
      const canon = canonicalKeralaDistrict(raw);
      return canon !== UNSPECIFIED_DISTRICT && wanted.has(canon);
    });
  }

  const cats = parseList(query.categories);
  if (cats.length > 0) {
    list = list.filter(d => cats.some(c => d.categories.includes(c)));
  }

  if (query.signedIn === 'true') {
    list = list.filter(d => d.signedIn);
  } else if (query.signedIn === 'false') {
    list = list.filter(d => !d.signedIn);
  }

  return list;
}

export function sortDealers(
  dealers: ZohoDealer[],
  sortField = 'contactName',
  sortDir: 'asc' | 'desc' = 'asc',
): ZohoDealer[] {
  const dir = sortDir === 'desc' ? -1 : 1;
  const field = sortField || 'contactName';
  return [...dealers].sort((a, b) => {
    if (field === 'phone') {
      const av = String(a.phone || a.mobile || '');
      const bv = String(b.phone || b.mobile || '');
      return av.localeCompare(bv) * dir;
    }
    const av = (a as unknown as Record<string, unknown>)[field] ?? '';
    const bv = (b as unknown as Record<string, unknown>)[field] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function paginateDealers(dealers: ZohoDealer[], page = 1, limit = 25) {
  const safePage = Math.max(1, Number(page) || 1);
  const unlimited = Number(limit) >= 99999;
  const safeLimit = unlimited
    ? Math.max(1, dealers.length || 1)
    : Math.max(1, Math.min(500, Number(limit) || 25));
  const skip = (safePage - 1) * safeLimit;
  return {
    data: dealers.slice(skip, skip + safeLimit),
    pagination: {
      total: dealers.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(dealers.length / safeLimit) || 1,
    },
  };
}

function classifyStage(stage: string | null | undefined): keyof Omit<DealerStats, 'total' | 'unassignedStaff'> {
  if (!stage) return 'unstaged';
  const normalized = stage.trim();
  if (normalized === 'Active') return 'active';
  if (normalized === 'Non Active') return 'nonActive';
  if (normalized === 'Blacklisted' || normalized === 'Black listed') return 'blacklisted';
  return 'unstaged';
}

export function computeDealerStats(dealers: ZohoDealer[]): DealerStats {
  const roster = dealers.filter(d => !d.isFiltered);
  const counts = { active: 0, nonActive: 0, blacklisted: 0, unstaged: 0 };
  for (const dealer of roster) {
    counts[classifyStage(dealer.dealerStage)] += 1;
  }
  return {
    total: counts.active + counts.nonActive + counts.blacklisted,
    active: counts.active,
    nonActive: counts.nonActive,
    blacklisted: counts.blacklisted,
    unstaged: counts.unstaged,
    unassignedStaff: roster.filter(d => !d.assignedStaffUid).length,
  };
}

export function computeDealerLocations(dealers: ZohoDealer[]): {
  states: string[];
  districtsByState: Record<string, string[]>;
} {
  const active = dealers.filter(d => !d.isFiltered);
  const states = Array.from(new Set(active.map(d => d.billingState).filter((s): s is string => Boolean(s)))).sort();
  const districtsByState: Record<string, string[]> = {};
  for (const state of states) {
    if (isKeralaBillingState(state)) {
      districtsByState[state] = [...KERALA_DISTRICTS];
      continue;
    }
    districtsByState[state] = Array.from(new Set(
      active.filter(d => d.billingState === state && d.district).map(d => d.district as string),
    )).sort((a, b) => a.localeCompare(b));
  }
  return { states, districtsByState };
}
