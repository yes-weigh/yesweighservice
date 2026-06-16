import type { ZohoDealer } from '../types/dealers';

export type ZohoPushableFields = {
  firstName: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  alternateMobile: string | null;
};

function normField(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed || null;
}

export { normField };

export function zohoPushableFromDraft(draft: {
  firstName?: string | null;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
  alternateMobile?: string | null;
}): ZohoPushableFields {
  return {
    firstName: normField(draft.firstName),
    email: normField(draft.email),
    phone: normField(draft.phone),
    designation: normField(draft.designation),
    alternateMobile: normField(draft.alternateMobile),
  };
}

/** Last-known Zoho values used to detect unsynced edits in the updatables tile. */
export function zohoPushableBaseline(dealer: ZohoDealer): ZohoPushableFields {
  const primary = dealer.zohoPrimaryContact;
  return {
    firstName: normField(primary?.firstName ?? dealer.firstName),
    email: normField(dealer.zohoEmail ?? primary?.email),
    phone: normField(primary?.phone ?? dealer.phone),
    designation: normField(primary?.designation ?? dealer.designation),
    alternateMobile: normField(primary?.mobile ?? dealer.alternateMobile ?? dealer.mobile),
  };
}

export function isZohoPushableDirty(
  draft: Parameters<typeof zohoPushableFromDraft>[0],
  baseline: ZohoPushableFields,
): boolean {
  return JSON.stringify(zohoPushableFromDraft(draft)) !== JSON.stringify(baseline);
}
