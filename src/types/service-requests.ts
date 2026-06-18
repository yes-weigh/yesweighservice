export type ServiceRequestStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface ServiceRequestItemRef {
  lineItemId: string;
  itemId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
}

export interface ServiceRequest {
  id: string;
  requestNumber: string;
  status: ServiceRequestStatus;
  invoiceId: string;
  invoiceNumber: string;
  salesOrderNumber: string | null;
  item: ServiceRequestItemRef;
  issue: string;
  notes: string | null;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  dealerId: string;
}

export interface CreateServiceRequestInput {
  invoiceId: string;
  invoiceNumber: string;
  salesOrderNumber?: string | null;
  lineItemId: string;
  itemId?: string | null;
  itemName: string;
  itemSku?: string | null;
  quantity: number;
  issue: string;
  notes?: string;
}

export interface ServiceRequestDraft {
  invoiceId: string;
  invoiceNumber: string;
  salesOrderNumber: string | null;
  lineItemId: string;
  itemId: string | null;
  itemName: string;
  itemSku: string | null;
  quantity: number;
}

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const SERVICE_ISSUE_OPTIONS = [
  { value: 'repair', label: 'Repair / not working' },
  { value: 'calibration', label: 'Calibration / stamping' },
  { value: 'installation', label: 'Installation support' },
  { value: 'spare_parts', label: 'Spare parts required' },
  { value: 'warranty', label: 'Warranty claim' },
  { value: 'other', label: 'Other' },
] as const;
