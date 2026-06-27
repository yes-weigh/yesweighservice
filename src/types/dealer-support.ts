import { FIRM_NAME } from '../constants/brand';

export type SupportRequestType = 'service' | 'return' | 'complaint' | 'chat';

export type SupportLifecycle = 'draft' | 'open' | 'resolved' | 'cancelled';

export type SupportOpenStage =
  | 'submitted'
  | 'under_review'
  | 'awaiting_dealer'
  | 'awaiting_product'
  | 'in_transit'
  | 'in_workshop';

/** @deprecated Legacy flat status — mapped from Firestore `status` when `lifecycle` is absent. */
export type SupportRequestStatus =
  | 'draft'
  | 'pending'
  | 'awaiting_product'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface SupportProductRef {
  lineItemId: string | null;
  itemId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  serialNumber: string | null;
}

export interface DealerSupportRequest {
  id: string;
  type: SupportRequestType;
  requestNumber: string;
  lifecycle: SupportLifecycle;
  openStage: SupportOpenStage | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  salesOrderNumber: string | null;
  product: SupportProductRef | null;
  category: string;
  subject: string | null;
  description: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdByUid: string;
  createdByName: string;
  dealerId: string;
  dealerName: string | null;
  assignedToUid: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
  courierTracking: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  resolvedAt: string | null;
  resolutionSummary: string | null;
}

export type SupportAttachmentKind = 'image' | 'video' | 'audio' | 'document';

export interface SupportAttachment {
  id: string;
  kind: SupportAttachmentKind;
  url: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  posterUrl?: string | null;
}

export type SupportMessageReceiptStatus = 'sent' | 'delivered' | 'read';

export interface SupportMessage {
  id: string;
  text: string;
  attachments: SupportAttachment[];
  authorUid: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  isInitial?: boolean;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export interface SendSupportMessageInput {
  text: string;
  files?: File[];
  isInitial?: boolean;
}

export interface SupportProductDraft {
  invoiceId: string;
  invoiceNumber: string;
  salesOrderNumber: string | null;
  lineItemId: string;
  itemId: string | null;
  itemName: string;
  itemSku: string | null;
  quantity: number;
}

export interface SupportAssignee {
  uid: string;
  displayName: string;
  role: string;
}

export interface CreateSupportRequestInput {
  type: SupportRequestType;
  requestId?: string;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  salesOrderNumber?: string | null;
  lineItemId?: string | null;
  itemId?: string | null;
  itemName?: string;
  itemSku?: string | null;
  serialNumber?: string | null;
  quantity?: number;
  category: string;
  subject?: string;
  description: string;
  notes?: string;
  attachmentFiles?: File[];
}

export interface SaveSupportRequestDraftInput {
  requestId?: string;
  type: SupportRequestType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  salesOrderNumber?: string | null;
  lineItemId?: string | null;
  itemId?: string | null;
  itemName?: string;
  itemSku?: string | null;
  serialNumber?: string | null;
  quantity?: number;
  category?: string;
  subject?: string;
  description?: string;
  notes?: string;
}

export const SUPPORT_OPEN_STAGE_LABELS: Record<SupportOpenStage, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  awaiting_dealer: 'Awaiting dealer reply',
  awaiting_product: 'Awaiting product',
  in_transit: 'On transit',
  in_workshop: 'In workshop',
};

export const SUPPORT_LIFECYCLE_LABELS: Record<SupportLifecycle, string> = {
  draft: 'Draft',
  open: 'Open',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const SUPPORT_TYPE_LABELS: Record<SupportRequestType, string> = {
  service: 'Service / Repair',
  return: 'Replacement',
  complaint: 'Complaint',
  chat: 'Chat',
};

export const SUPPORT_CHAT_OPTION = {
  title: 'Chat with Interweighing',
  description: 'Ask a question or discuss anything. Product and invoice details can be added later if needed.',
  hint: 'Opens a live chat — no ticket form required.',
} as const;

export const DEALER_COURIER_NOTICE =
  `For repair and replacement, courier the product to ${FIRM_NAME} after your request is approved. This is the standard process for all dealers.`;

export const SUPPORT_INTENT_OPTIONS: Array<{
  value: SupportRequestType;
  title: string;
  description: string;
  hint: string;
}> = [
  {
    value: 'service',
    title: 'Repair / Technical Support',
    description: 'Product is faulty, needs calibration, spare parts, or warranty repair.',
    hint: 'Our workshop will diagnose and repair it.',
  },
  {
    value: 'return',
    title: 'Full Product Replacement',
    description: 'Unit must be swapped under warranty — dead on arrival, beyond repair, or wrong item.',
    hint: `Courier the unit to ${FIRM_NAME}.`,
  },
  {
    value: 'complaint',
    title: 'Other / Non-Product Complaint',
    description: 'General support for logistics, billing, orders, portal access, and other non-product matters.',
    hint: 'Pick a category and describe your issue — no invoice or product required.',
  },
];

export const SERVICE_ISSUE_OPTIONS = [
  { value: 'repair', label: 'Not working / needs repair' },
  { value: 'calibration', label: 'Calibration or stamping' },
  { value: 'configuration', label: 'Setup or configuration issue' },
  { value: 'spare_parts', label: 'Spare parts required' },
  { value: 'warranty', label: 'Warranty repair' },
  { value: 'other', label: 'Other technical issue' },
] as const;

export const RETURN_REASON_OPTIONS = [
  { value: 'doa', label: 'Dead on arrival — never worked' },
  { value: 'beyond_repair', label: 'Faulty and cannot be repaired' },
  { value: 'wrong_item', label: 'Wrong product delivered' },
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'warranty_swap', label: 'Warranty replacement' },
  { value: 'other', label: 'Other replacement reason' },
] as const;

export const COMPLAINT_CATEGORY_OPTIONS = [
  { value: 'logistics_delivery', label: 'Logistics & Delivery', emoji: '📦' },
  { value: 'verification_stamping', label: 'Verification & Stamping', emoji: '⚖️' },
  { value: 'orders_billing', label: 'Orders & Billing', emoji: '🧾' },
  { value: 'spare_parts', label: 'Spare Parts', emoji: '🔩' },
  { value: 'payments_accounts', label: 'Payments & Accounts', emoji: '💳' },
  { value: 'service_experience', label: 'Service Experience', emoji: '👨‍🔧' },
  { value: 'dealer_account', label: 'Dealer Account', emoji: '👤' },
  { value: 'app_portal', label: 'App & Portal Support', emoji: '📱' },
  { value: 'documents_certificates', label: 'Documents & Certificates', emoji: '📄' },
  { value: 'marketing_media', label: 'Marketing & Media', emoji: '📢' },
  { value: 'general_inquiry', label: 'General Inquiry', emoji: '💬' },
  { value: 'other', label: 'Other', emoji: '❓' },
] as const;

export function complaintCategoryDisplayLabel(value: string): string {
  const match = COMPLAINT_CATEGORY_OPTIONS.find(
    option => option.value === value || option.label === value,
  );
  if (match) return `${match.emoji} ${match.label}`;
  return value;
}

export function complaintCategoryEmoji(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const trimmed = stored.trim();

  const match = COMPLAINT_CATEGORY_OPTIONS.find(
    option =>
      option.value === trimmed
      || option.label === trimmed
      || trimmed === `${option.emoji} ${option.label}`
      || trimmed.startsWith(`${option.emoji} `)
      || trimmed.includes(option.label),
  );
  if (match) return match.emoji;

  const leading = [...trimmed][0];
  if (leading && /\p{Extended_Pictographic}/u.test(leading)) {
    return leading;
  }

  return null;
}

export function supportCategoryValueFromStored(
  type: SupportRequestType,
  stored: string,
): string {
  const options =
    type === 'return'
      ? RETURN_REASON_OPTIONS
      : type === 'complaint'
        ? COMPLAINT_CATEGORY_OPTIONS
        : type === 'chat'
          ? [{ value: 'general', label: 'General chat' }]
          : SERVICE_ISSUE_OPTIONS;
  const match = options.find(option => option.label === stored || option.value === stored);
  if (match) return match.value;
  if (type === 'complaint') {
    const legacy = COMPLAINT_CATEGORY_OPTIONS.find(
      option => stored.includes(option.label),
    );
    if (legacy) return legacy.value;
  }
  return options[0].value;
}
