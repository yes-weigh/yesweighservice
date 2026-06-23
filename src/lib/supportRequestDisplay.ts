import type { DealerSupportRequest } from '../types/dealer-support';
import { SUPPORT_DEALER_STATUS_LABELS } from './supportStatus';

export type SupportStatusTab =
  | 'all'
  | 'pending'
  | 'in_progress'
  | 'awaiting_product'
  | 'resolved'
  | 'closed';

export type SupportSortOption = 'newest' | 'oldest';

export type SupportTypeFilter = 'all' | import('../types/dealer-support').SupportRequestType;

export const SUPPORT_STATUS_TABS: Array<{ value: SupportStatusTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'awaiting_product', label: 'Awaiting Product' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const SLA_DAYS = 3;

export function supportRequestStatusTab(request: DealerSupportRequest): SupportStatusTab | null {
  if (request.status === 'draft') return null;
  if (request.status === 'cancelled') return 'closed';
  if (request.status === 'completed') return 'resolved';
  if (request.status === 'awaiting_product') return 'awaiting_product';
  if (request.status === 'in_progress') return 'in_progress';
  if (request.status === 'pending') return 'pending';
  return 'pending';
}

export function supportRequestStatusLabel(request: DealerSupportRequest): string {
  return SUPPORT_DEALER_STATUS_LABELS[request.status].toUpperCase();
}

export function supportRequestStatusTone(
  request: DealerSupportRequest,
): 'amber' | 'blue' | 'purple' | 'green' | 'muted' | 'draft' {
  if (request.status === 'draft') return 'draft';
  if (request.status === 'pending') return 'amber';
  if (request.status === 'in_progress') return 'blue';
  if (request.status === 'awaiting_product') return 'purple';
  if (request.status === 'completed') return 'green';
  return 'muted';
}

export function countSupportRequestsByTab(
  requests: DealerSupportRequest[],
): Record<SupportStatusTab, number> {
  const counts: Record<SupportStatusTab, number> = {
    all: requests.length,
    pending: 0,
    in_progress: 0,
    awaiting_product: 0,
    resolved: 0,
    closed: 0,
  };
  for (const request of requests) {
    const tab = supportRequestStatusTab(request);
    if (tab) counts[tab] += 1;
  }
  return counts;
}

export function filterSupportRequests(
  requests: DealerSupportRequest[],
  statusTab: SupportStatusTab,
  typeFilter: SupportTypeFilter,
): DealerSupportRequest[] {
  return requests.filter(request => {
    if (typeFilter !== 'all' && request.type !== typeFilter) return false;
    if (statusTab === 'all') return true;
    const tab = supportRequestStatusTab(request);
    return tab === statusTab;
  });
}

export function sortSupportRequests(
  requests: DealerSupportRequest[],
  sort: SupportSortOption,
): DealerSupportRequest[] {
  const sorted = [...requests];
  sorted.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt) || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt) || 0;
    return sort === 'newest' ? bTime - aTime : aTime - bTime;
  });
  return sorted;
}

export function supportRequestDueDate(request: DealerSupportRequest): Date | null {
  if (
    request.status === 'completed'
    || request.status === 'cancelled'
    || request.status === 'draft'
  ) {
    return null;
  }
  const created = Date.parse(request.createdAt);
  if (Number.isNaN(created)) return null;
  const due = new Date(created);
  due.setDate(due.getDate() + SLA_DAYS);
  return due;
}

export function formatSupportDueCountdown(dueDate: Date): {
  prefix: string;
  value: string;
  tone: 'amber' | 'blue' | 'muted';
} {
  const diffDays = Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) {
    return { prefix: 'Overdue by', value: `${Math.abs(diffDays)} Days`, tone: 'muted' };
  }
  if (diffDays === 0) {
    return { prefix: 'Due', value: 'Today', tone: 'amber' };
  }
  if (diffDays === 1) {
    return { prefix: 'Due in', value: '1 Day', tone: 'blue' };
  }
  return {
    prefix: 'Due in',
    value: `${diffDays} Days`,
    tone: diffDays <= 2 ? 'amber' : 'blue',
  };
}

export function formatSupportDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const d = new Date(parsed);
  const date = d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} • ${time}`;
}

export function supportRequestIssueSummary(request: DealerSupportRequest): string {
  if (request.status === 'draft') {
    return request.description || 'Draft — tap to continue and submit';
  }
  const category = request.category?.trim();
  const preview = request.lastMessagePreview?.trim() || request.description?.trim();
  if (category && preview) return `${category} — ${preview}`;
  return preview || category || 'No description yet';
}
