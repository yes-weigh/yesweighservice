export type SupportRequestType = 'service' | 'return' | 'complaint';

export type SupportRequestStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface SupportProductRef {
  lineItemId: string | null;
  itemId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
}

export interface DealerSupportRequest {
  id: string;
  type: SupportRequestType;
  requestNumber: string;
  status: SupportRequestStatus;
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
  legacyCollection?: 'serviceRequests';
}

export type SupportAttachmentKind = 'image' | 'video';

export interface SupportAttachment {
  id: string;
  kind: SupportAttachmentKind;
  url: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface SupportMessage {
  id: string;
  text: string;
  attachments: SupportAttachment[];
  authorUid: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  isInitial?: boolean;
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

export interface CreateSupportRequestInput {
  type: SupportRequestType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  salesOrderNumber?: string | null;
  lineItemId?: string | null;
  itemId?: string | null;
  itemName?: string;
  itemSku?: string | null;
  quantity?: number;
  category: string;
  subject?: string;
  description: string;
  notes?: string;
  attachmentFiles?: File[];
}

export const SUPPORT_REQUEST_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const SUPPORT_TYPE_LABELS: Record<SupportRequestType, string> = {
  service: 'Service / Repair',
  return: 'Replacement',
  complaint: 'Complaint',
};

export const DEALER_COURIER_NOTICE =
  'For repair and replacement, courier the product to YesWeigh after your request is approved. This is the standard process for all dealers.';

export const SUPPORT_INTENT_OPTIONS: Array<{
  value: SupportRequestType;
  title: string;
  description: string;
  hint: string;
}> = [
  {
    value: 'service',
    title: 'Repair or technical support',
    description: 'Product is faulty, needs calibration, spare parts, or warranty repair.',
    hint: 'Courier the unit to YesWeigh — our workshop will diagnose and repair it.',
  },
  {
    value: 'return',
    title: 'Full product replacement',
    description: 'Unit must be swapped under warranty — dead on arrival, beyond repair, or wrong item.',
    hint: 'Courier the unit to YesWeigh — we inspect and send a replacement.',
  },
  {
    value: 'complaint',
    title: 'Register a complaint',
    description: 'Issue with billing, delivery, order accuracy, or how your case was handled.',
    hint: 'No courier needed unless we ask you to send a product for review.',
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
  { value: 'billing', label: 'Billing or invoice dispute' },
  { value: 'delivery', label: 'Late or missing delivery' },
  { value: 'order', label: 'Wrong or incomplete order' },
  { value: 'support_experience', label: 'Support response or communication quality' },
  { value: 'warranty_process', label: 'Warranty or RMA process delay' },
  { value: 'other', label: 'Other complaint' },
] as const;

/** @deprecated Use SupportProductDraft */
export type ServiceRequestDraft = SupportProductDraft;
