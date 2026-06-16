import type { ZohoDealer } from '../types/dealers';

export type DealerFieldSource = 'zoho' | 'overlay' | 'computed' | 'system';

export interface DealerFieldDefinition {
  key: string;
  label: string;
  source: DealerFieldSource;
  getValue: (dealer: ZohoDealer) => unknown;
}

export const DEALER_FIELD_SOURCE_LABELS: Record<DealerFieldSource, string> = {
  zoho: 'Zoho',
  overlay: 'Overlay',
  computed: 'Computed',
  system: 'System',
};

export const DEALER_FIELD_SECTIONS: { id: DealerFieldSource; title: string; hint: string }[] = [
  {
    id: 'zoho',
    title: 'Zoho (synced)',
    hint: 'Pulled from Zoho Inventory on sync',
  },
  {
    id: 'overlay',
    title: 'CRM overlay & local edits',
    hint: 'Imported from yesweighmomentumhub or edited in this app',
  },
  {
    id: 'computed',
    title: 'Derived',
    hint: 'Resolved from linked records',
  },
  {
    id: 'system',
    title: 'System metadata',
    hint: 'Firestore timestamps and internal flags',
  },
];

export const DEALER_FIELD_DEFINITIONS: DealerFieldDefinition[] = [
  { key: 'id', label: 'Zoho contact ID', source: 'zoho', getValue: d => d.id },
  { key: 'contactName', label: 'Contact name', source: 'zoho', getValue: d => d.contactName },
  { key: 'companyName', label: 'Company name', source: 'zoho', getValue: d => d.companyName },
  { key: 'email', label: 'Email', source: 'zoho', getValue: d => d.email },
  { key: 'mobile', label: 'Mobile', source: 'zoho', getValue: d => d.mobile },
  { key: 'status', label: 'Zoho status', source: 'zoho', getValue: d => d.status },
  {
    key: 'outstandingReceivable',
    label: 'Outstanding receivable',
    source: 'zoho',
    getValue: d => d.outstandingReceivable,
  },
  {
    key: 'unusedCredits',
    label: 'Unused credits',
    source: 'zoho',
    getValue: d => d.unusedCredits,
  },
  { key: 'syncedAt', label: 'Last Zoho sync', source: 'zoho', getValue: d => d.syncedAt },

  { key: 'firstName', label: 'Contact first name', source: 'overlay', getValue: d => d.firstName },
  { key: 'phone', label: 'Phone', source: 'overlay', getValue: d => d.phone },
  { key: 'kamId', label: 'KAM ID', source: 'overlay', getValue: d => d.kamId },
  { key: 'dealerStage', label: 'Dealer stage', source: 'overlay', getValue: d => d.dealerStage },
  { key: 'billingState', label: 'Billing state', source: 'overlay', getValue: d => d.billingState },
  { key: 'district', label: 'District', source: 'overlay', getValue: d => d.district },
  { key: 'zipCode', label: 'Pincode', source: 'overlay', getValue: d => d.zipCode },
  { key: 'categories', label: 'Categories', source: 'overlay', getValue: d => d.categories },
  { key: 'isFiltered', label: 'Filtered / hidden', source: 'overlay', getValue: d => d.isFiltered },
  { key: 'filterReason', label: 'Filter reason', source: 'overlay', getValue: d => d.filterReason },
  { key: 'portalUserId', label: 'Portal user ID', source: 'overlay', getValue: d => d.portalUserId },

  { key: 'kamName', label: 'KAM name', source: 'computed', getValue: d => d.kamName },
  { key: 'portalUserName', label: 'Portal user name', source: 'computed', getValue: d => d.portalUserName },
  { key: 'signedIn', label: 'Signed in to portal', source: 'computed', getValue: d => d.signedIn },

  { key: 'createdAt', label: 'Created at', source: 'system', getValue: d => d.createdAt ?? null },
  { key: 'updatedAt', label: 'Updated at', source: 'system', getValue: d => d.updatedAt ?? null },
];

export function formatDealerFieldValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString('en-IN') : '—';
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    }
    return value;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function fieldsForSource(source: DealerFieldSource): DealerFieldDefinition[] {
  return DEALER_FIELD_DEFINITIONS.filter(field => field.source === source);
}
