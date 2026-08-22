import { getFunctions, httpsCallable } from 'firebase/functions';
import { onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { app } from '../firebase';
import { dealerCartApprovalsCollection } from './dealerSharedCart';
import { dealerOrderErrorMessage, type SubmitDealerOrderResult } from './dealerOrders';
import { shippingSelectionPayload, type ShippingSelection } from './shippingAddresses';
import type { CartItem } from '../types/cart';
import type { SubmitDealerOrderLineInput } from '../types/dealer-orders';
import type {
  DealerStaffOrderApproval,
  DealerStaffOrderApprovalStatus,
  DealerStaffOrderKind,
} from '../types/dealer-staff-orders';

const functions = getFunctions(app, 'asia-south1');

function parseApproval(
  id: string,
  data: Record<string, unknown>,
): DealerStaffOrderApproval | null {
  const dealerUid = String(data.dealerUid ?? '').trim();
  const status = data.status as DealerStaffOrderApprovalStatus;
  if (!dealerUid) return null;
  if (status !== 'pending_approval' && status !== 'placed' && status !== 'rejected') return null;
  const team = data.submittedByTeam === 'service' ? 'service' : 'sales';
  const kind = data.kind === 'service' ? 'service' : 'sales';
  return {
    id,
    dealerUid,
    status,
    submittedByUid: String(data.submittedByUid ?? '').trim(),
    submittedByName: String(data.submittedByName ?? 'Staff').trim() || 'Staff',
    submittedByTeam: team,
    kind,
    lines: Array.isArray(data.lines) ? data.lines as SubmitDealerOrderLineInput[] : [],
    displayLines: Array.isArray(data.displayLines) ? data.displayLines as CartItem[] : [],
    shipping: (data.shipping && typeof data.shipping === 'object')
      ? data.shipping as DealerStaffOrderApproval['shipping']
      : {},
    remarks: String(data.remarks ?? ''),
    courierBySite: (data.courierBySite && typeof data.courierBySite === 'object')
      ? data.courierBySite as Record<string, string>
      : null,
    freightZone: data.freightZone != null ? String(data.freightZone) : null,
    freightZoneOverrideReason: data.freightZoneOverrideReason != null
      ? String(data.freightZoneOverrideReason)
      : null,
    manualFreightAmountInr: data.manualFreightAmountInr != null
      ? Number(data.manualFreightAmountInr)
      : null,
    freightBillingMode: data.freightBillingMode === 'fod' || data.freightBillingMode === 'btc'
      ? data.freightBillingMode
      : null,
    createdAtMs: Number(data.createdAtMs) || 0,
    cartLineIds: Array.isArray(data.cartLineIds)
      ? data.cartLineIds.map(value => String(value))
      : [],
  };
}

export function subscribeDealerStaffApprovals(
  dealerUid: string,
  onData: (rows: DealerStaffOrderApproval[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    dealerCartApprovalsCollection(dealerUid),
    where('status', '==', 'pending_approval'),
  );
  return onSnapshot(
    q,
    snap => {
      const rows = snap.docs
        .map(row => parseApproval(row.id, row.data() as Record<string, unknown>))
        .filter((row): row is DealerStaffOrderApproval => Boolean(row))
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(rows);
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load approvals.')),
  );
}

export async function submitDealerStaffOrderForApproval(input: {
  lines: SubmitDealerOrderLineInput[];
  displayLines: CartItem[];
  cartLineIds: string[];
  shipping: ShippingSelection;
  remarks?: string;
  submittedByTeam: DealerStaffOrderKind;
  kind: DealerStaffOrderKind;
  courierBySite?: Partial<Record<'cochin' | 'head_office', string>>;
  freightZone?: string;
  freightZoneOverrideReason?: string;
  manualFreightAmountInr?: number;
  freightBillingMode?: 'fod' | 'btc';
}): Promise<{ approvalId: string }> {
  try {
    const payload = {
      lines: input.lines,
      displayLines: input.displayLines,
      cartLineIds: input.cartLineIds,
      shipping: shippingSelectionPayload(input.shipping),
      remarks: input.remarks?.trim() || undefined,
      submittedByTeam: input.submittedByTeam,
      kind: input.kind,
      courierBySite: input.courierBySite || undefined,
      freightZone: input.freightZone || undefined,
      freightZoneOverrideReason: input.freightZoneOverrideReason?.trim() || undefined,
      manualFreightAmountInr: input.manualFreightAmountInr,
      freightBillingMode: input.freightBillingMode,
    };
    const callable = httpsCallable<typeof payload, { approvalId: string }>(
      functions,
      'submitDealerStaffOrderForApproval',
      { timeout: 60_000 },
    );
    const result = await callable(payload);
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function approveDealerStaffOrder(
  approvalId: string,
): Promise<SubmitDealerOrderResult> {
  try {
    const callable = httpsCallable<{ approvalId: string }, SubmitDealerOrderResult>(
      functions,
      'approveDealerStaffOrder',
      { timeout: 180_000 },
    );
    const result = await callable({ approvalId });
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function rejectDealerStaffOrder(approvalId: string): Promise<{ ok: boolean }> {
  try {
    const callable = httpsCallable<{ approvalId: string }, { ok: boolean }>(
      functions,
      'rejectDealerStaffOrder',
      { timeout: 60_000 },
    );
    const result = await callable({ approvalId });
    return result.data;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}
