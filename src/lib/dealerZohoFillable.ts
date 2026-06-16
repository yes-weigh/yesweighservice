import type { ZohoDealer } from '../types/dealers';
import { normField, type ZohoPushableFields, zohoPushableFromDraft } from './dealerZohoPush';

export type ZohoFillableFieldKey =
  | 'zohoEmail'
  | 'mobile'
  | 'zohoContactPhone'
  | 'zohoWebsite'
  | 'zohoGstNo'
  | 'zohoGstTreatment'
  | 'zohoPanNo'
  | 'zohoNotes'
  | 'zohoBillingAddress'
  | 'zohoShippingAddress';

export interface ZohoFillableFieldDef {
  key: ZohoFillableFieldKey;
  label: string;
  pushKey: string;
  multiline?: boolean;
  full?: boolean;
  getValue: (dealer: ZohoDealer) => string | null | undefined;
  getDraftValue: (draft: ZohoFillableDraft) => string | null | undefined;
}

export type ZohoFillableDraft = {
  zohoEmail?: string | null;
  mobile?: string | null;
  zohoContactPhone?: string | null;
  zohoWebsite?: string | null;
  zohoGstNo?: string | null;
  zohoGstTreatment?: string | null;
  zohoPanNo?: string | null;
  zohoNotes?: string | null;
  zohoBillingAddress?: string | null;
  zohoShippingAddress?: string | null;
};

export const ZOHO_FILLABLE_FIELDS: ZohoFillableFieldDef[] = [
  {
    key: 'zohoEmail',
    label: 'Email',
    pushKey: 'zoho_email',
    getValue: d => d.zohoEmail,
    getDraftValue: d => d.zohoEmail,
  },
  {
    key: 'mobile',
    label: 'Mobile',
    pushKey: 'mobile',
    getValue: d => d.mobile,
    getDraftValue: d => d.mobile,
  },
  {
    key: 'zohoContactPhone',
    label: 'Phone',
    pushKey: 'zoho_phone',
    getValue: d => d.zohoPrimaryContact?.phone ?? null,
    getDraftValue: d => d.zohoContactPhone,
  },
  {
    key: 'zohoWebsite',
    label: 'Website',
    pushKey: 'website',
    getValue: d => d.zohoWebsite,
    getDraftValue: d => d.zohoWebsite,
  },
  {
    key: 'zohoGstNo',
    label: 'GST number',
    pushKey: 'gst_no',
    getValue: d => d.zohoGstNo,
    getDraftValue: d => d.zohoGstNo,
  },
  {
    key: 'zohoGstTreatment',
    label: 'GST treatment',
    pushKey: 'gst_treatment',
    getValue: d => d.zohoGstTreatment,
    getDraftValue: d => d.zohoGstTreatment,
  },
  {
    key: 'zohoPanNo',
    label: 'PAN',
    pushKey: 'pan_no',
    getValue: d => d.zohoPanNo,
    getDraftValue: d => d.zohoPanNo,
  },
  {
    key: 'zohoNotes',
    label: 'Notes',
    pushKey: 'notes',
    full: true,
    multiline: true,
    getValue: d => d.zohoNotes,
    getDraftValue: d => d.zohoNotes,
  },
  {
    key: 'zohoBillingAddress',
    label: 'Billing address',
    pushKey: 'billing_address',
    full: true,
    multiline: true,
    getValue: d => d.zohoBillingAddress,
    getDraftValue: d => d.zohoBillingAddress,
  },
  {
    key: 'zohoShippingAddress',
    label: 'Shipping address',
    pushKey: 'shipping_address',
    full: true,
    multiline: true,
    getValue: d => d.zohoShippingAddress,
    getDraftValue: d => d.zohoShippingAddress,
  },
];

export const TOP_ZOHO_CONTACT_FIELD_KEYS: ZohoFillableFieldKey[] = ['mobile', 'zohoContactPhone'];

export function topZohoEmailField(): ZohoFillableFieldDef | undefined {
  return ZOHO_FILLABLE_FIELDS.find(field => field.key === 'zohoEmail');
}

export function zohoAddressesMatch(dealer: ZohoDealer): boolean {
  const billing = normField(dealer.zohoBillingAddress);
  const shipping = normField(dealer.zohoShippingAddress);
  if (!billing || !shipping) return false;
  return billing === shipping;
}

export function visibleFillableFields(dealer: ZohoDealer): ZohoFillableFieldDef[] {
  const sameAddress = zohoAddressesMatch(dealer);
  return ZOHO_FILLABLE_FIELDS.flatMap(field => {
    if (TOP_ZOHO_CONTACT_FIELD_KEYS.includes(field.key) || field.key === 'zohoEmail') return [];
    if (field.key === 'zohoShippingAddress' && sameAddress) return [];
    if (field.key === 'zohoBillingAddress' && sameAddress) {
      return [{ ...field, label: 'Billing & shipping address' }];
    }
    return [field];
  });
}

export function topZohoContactFields(): ZohoFillableFieldDef[] {
  return TOP_ZOHO_CONTACT_FIELD_KEYS
    .map(key => ZOHO_FILLABLE_FIELDS.find(field => field.key === key))
    .filter((field): field is ZohoFillableFieldDef => Boolean(field));
}

export function isZohoFieldBlank(value: string | null | undefined): boolean {
  return normField(value) == null;
}

export function blankFillableFieldKeys(dealer: ZohoDealer): ZohoFillableFieldKey[] {
  return ZOHO_FILLABLE_FIELDS
    .filter(field => isZohoFieldBlank(field.getValue(dealer)))
    .map(field => field.key);
}

export function fillableFieldsToDraft(dealer: ZohoDealer): ZohoFillableDraft {
  const draft: ZohoFillableDraft = {};
  for (const field of ZOHO_FILLABLE_FIELDS) {
    draft[field.key] = normField(field.getValue(dealer));
  }
  return draft;
}

export function isFillableFieldDirty(
  draft: ZohoFillableDraft,
  dealer: ZohoDealer,
  blankKeys: ZohoFillableFieldKey[],
): boolean {
  return blankKeys.some(key => {
    const field = ZOHO_FILLABLE_FIELDS.find(f => f.key === key);
    if (!field) return false;
    return normField(field.getDraftValue(draft)) !== normField(field.getValue(dealer));
  });
}

export type ZohoPushPayload = Record<string, string | null | undefined>;

export function buildZohoPushPayload(
  draft: ZohoFillableDraft & Parameters<typeof zohoPushableFromDraft>[0],
  dealer: ZohoDealer,
  zohoBaseline: ZohoPushableFields,
  blankFillableKeys: ZohoFillableFieldKey[],
): ZohoPushPayload {
  const payload: ZohoPushPayload = {};

  const updatable = zohoPushableFromDraft(draft);
  for (const key of Object.keys(updatable) as (keyof ZohoPushableFields)[]) {
    if (updatable[key] !== zohoBaseline[key]) {
      payload[key] = updatable[key];
    }
  }

  for (const key of blankFillableKeys) {
    const field = ZOHO_FILLABLE_FIELDS.find(f => f.key === key);
    if (!field) continue;
    const current = normField(field.getDraftValue(draft));
    const baseline = normField(field.getValue(dealer));
    if (current !== baseline && current != null) {
      payload[field.pushKey] = current;
    }
  }

  return payload;
}

export function hasZohoPushChanges(payload: ZohoPushPayload): boolean {
  return Object.keys(payload).length > 0;
}
