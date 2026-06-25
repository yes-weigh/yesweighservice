import type { DealerSupportRequest, SupportOpenStage } from '../types/dealer-support';
import { SUPPORT_OPEN_STAGE_LABELS } from '../types/dealer-support';
import { FIRM_NAME_SHORT } from '../constants/brand';
import {
  dealerOpenStageLabel,
  isSupportDraft,
  isSupportOpen,
  slaPausedForStage,
  supportBadgeLabel,
  supportDisplayLabel,
} from './supportStatus';

/** Dealer list filter — lifecycle buckets and each open stage. */
export type SupportStatusFilter =
  | 'all'
  | 'open'
  | SupportOpenStage
  | 'resolved'
  | 'cancelled';

/** @deprecated Use SupportStatusFilter */
export type SupportStatusTab = 'all' | 'open' | 'resolved' | 'cancelled';

export type SupportSortOption = 'newest' | 'oldest';

export type SupportTypeFilter = 'all' | import('../types/dealer-support').SupportRequestType;

export type SupportLifecycleFilter = 'all' | 'open' | 'resolved' | 'cancelled';

export const SUPPORT_LIFECYCLE_FILTERS: Array<{ value: SupportLifecycleFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

export const SUPPORT_STAGE_FILTERS: Array<{
  value: SupportOpenStage;
  label: string;
  shortLabel: string;
}> = [
  { value: 'submitted', label: SUPPORT_OPEN_STAGE_LABELS.submitted, shortLabel: 'Submitted' },
  { value: 'under_review', label: SUPPORT_OPEN_STAGE_LABELS.under_review, shortLabel: 'In review' },
  { value: 'awaiting_dealer', label: 'Awaiting reply', shortLabel: 'Await reply' },
  { value: 'awaiting_product', label: SUPPORT_OPEN_STAGE_LABELS.awaiting_product, shortLabel: 'Await item' },
  { value: 'in_transit', label: SUPPORT_OPEN_STAGE_LABELS.in_transit, shortLabel: 'Transit' },
  { value: 'in_workshop', label: SUPPORT_OPEN_STAGE_LABELS.in_workshop, shortLabel: 'Workshop' },
];

const OPEN_STAGE_VALUES = new Set<SupportOpenStage>(SUPPORT_STAGE_FILTERS.map(option => option.value));

export const SUPPORT_STATUS_FILTERS: Array<{ value: SupportStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  ...SUPPORT_STAGE_FILTERS.map(option => ({ value: option.value, label: option.shortLabel })),
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function isOpenStageFilter(filter: SupportStatusFilter): filter is SupportOpenStage {
  return OPEN_STAGE_VALUES.has(filter as SupportOpenStage);
}

export function combineStatusFilter(
  lifecycle: SupportLifecycleFilter,
  stage: SupportOpenStage | null,
): SupportStatusFilter {
  if (stage) return stage;
  return lifecycle;
}

export function splitStatusFilter(filter: SupportStatusFilter): {
  lifecycle: SupportLifecycleFilter;
  stage: SupportOpenStage | null;
} {
  if (isOpenStageFilter(filter)) {
    return { lifecycle: 'all', stage: filter };
  }
  return { lifecycle: filter, stage: null };
}

/** @deprecated Use SUPPORT_STATUS_FILTERS */
export const SUPPORT_STATUS_TABS: Array<{ value: SupportStatusTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SLA_DAYS = 3;

export function matchesSupportStatusFilter(
  request: DealerSupportRequest,
  filter: SupportStatusFilter,
): boolean {
  if (isSupportDraft(request)) return false;
  if (filter === 'all') return true;
  if (filter === 'open') return isSupportOpen(request);
  if (filter === 'resolved') return request.lifecycle === 'resolved';
  if (filter === 'cancelled') return request.lifecycle === 'cancelled';
  return isSupportOpen(request) && request.openStage === filter;
}

export function supportRequestStatusTab(request: DealerSupportRequest): SupportStatusTab | null {
  if (isSupportDraft(request)) return null;
  if (request.lifecycle === 'cancelled') return 'cancelled';
  if (request.lifecycle === 'resolved') return 'resolved';
  if (isSupportOpen(request)) return 'open';
  return null;
}

export function supportRequestStatusLabel(request: DealerSupportRequest): string {
  return supportBadgeLabel(request);
}

export function supportRequestStageSubtitle(request: DealerSupportRequest): string | null {
  if (!isSupportOpen(request) || !request.openStage) return null;
  if (request.openStage === 'submitted') {
    return 'We will review shortly';
  }
  return dealerOpenStageLabel(request.openStage);
}

export function supportDetailStatusBadge(
  request: DealerSupportRequest,
  audience: 'staff' | 'dealer' = 'dealer',
): string {
  if (request.lifecycle === 'resolved') return 'RESOLVED';
  if (request.lifecycle === 'cancelled') return 'CANCELLED';
  if (request.lifecycle === 'draft') return 'DRAFT';
  if (!request.openStage) return 'OPEN';

  const stageLabel = (
    audience === 'staff'
      ? SUPPORT_OPEN_STAGE_LABELS[request.openStage]
      : SUPPORT_OPEN_STAGE_LABELS[request.openStage]
  ).toUpperCase();
  const subtitle = supportRequestStageSubtitle(request);
  if (subtitle) return `${stageLabel} — ${subtitle.toUpperCase()}`;
  return stageLabel;
}

export function formatSupportDetailOpenedOn(value: string | null | undefined): string {
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
  return `${date}, ${time}`;
}

export function supportRequestStatusTone(
  request: DealerSupportRequest,
): 'amber' | 'blue' | 'purple' | 'green' | 'muted' | 'draft' {
  if (isSupportDraft(request)) return 'draft';
  if (request.lifecycle === 'resolved') return 'green';
  if (request.lifecycle === 'cancelled') return 'muted';
  switch (request.openStage) {
    case 'submitted':
      return 'amber';
    case 'under_review':
    case 'in_workshop':
      return 'blue';
    case 'awaiting_dealer':
    case 'awaiting_product':
    case 'in_transit':
      return 'purple';
    default:
      return 'amber';
  }
}

export function supportRequestStaffLabel(request: DealerSupportRequest): string {
  return supportDisplayLabel(request, 'staff');
}

export function countSupportRequestsByFilter(
  requests: DealerSupportRequest[],
): Record<SupportStatusFilter, number> {
  const counts = Object.fromEntries(
    SUPPORT_STATUS_FILTERS.map(option => [option.value, 0]),
  ) as Record<SupportStatusFilter, number>;

  for (const request of requests) {
    if (isSupportDraft(request)) continue;
    counts.all += 1;
    for (const option of SUPPORT_STATUS_FILTERS) {
      if (option.value === 'all') continue;
      if (matchesSupportStatusFilter(request, option.value)) {
        counts[option.value] += 1;
      }
    }
  }
  return counts;
}

/** @deprecated Use countSupportRequestsByFilter */
export function countSupportRequestsByTab(
  requests: DealerSupportRequest[],
): Record<SupportStatusTab, number> {
  const full = countSupportRequestsByFilter(requests);
  return {
    all: full.all,
    open: full.open,
    resolved: full.resolved,
    cancelled: full.cancelled,
  };
}

export function filterSupportRequests(
  requests: DealerSupportRequest[],
  statusFilter: SupportStatusFilter,
  typeFilter: SupportTypeFilter,
): DealerSupportRequest[] {
  return requests.filter(request => {
    if (typeFilter !== 'all' && request.type !== typeFilter) return false;
    return matchesSupportStatusFilter(request, statusFilter);
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

export function formatSupportDaysSinceSubmission(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return '—';

  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const days = Math.max(
    0,
    Math.floor((startOfDay(Date.now()) - startOfDay(created)) / 86_400_000),
  );

  if (days === 0) return '0 days';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/** Dealer-friendly relative age label for list cards. */
export function formatSupportDaysAgo(createdAt: string | null | undefined): string {
  const days = formatSupportDaysSinceSubmission(createdAt);
  if (days === '—') return '';
  if (days === '0 days') return 'Today';
  if (days === '1 day') return '1 day ago';
  return `${days} ago`;
}

/** Submitted date for list cards — date only, drops year when it matches the current year. */
export function formatSupportSubmittedDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const d = new Date(parsed);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Submitted time for list cards. */
export function formatSupportSubmittedTime(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function supportRequestCardTitle(request: DealerSupportRequest): string {
  if (request.type === 'chat') {
    return request.subject?.trim() || `Chat with ${FIRM_NAME_SHORT}`;
  }
  return request.product?.name?.trim()
    || request.subject?.trim()
    || request.category?.trim()
    || 'Support request';
}

export function supportRequestDueDate(request: DealerSupportRequest): Date | null {
  if (isSupportClosed(request) || isSupportDraft(request)) return null;
  if (slaPausedForStage(request.openStage)) return null;
  const created = Date.parse(request.createdAt);
  if (Number.isNaN(created)) return null;
  const due = new Date(created);
  due.setDate(due.getDate() + SLA_DAYS);
  return due;
}

function isSupportClosed(request: DealerSupportRequest): boolean {
  return request.lifecycle === 'resolved' || request.lifecycle === 'cancelled';
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

/** Invoice date on support list cards — always includes day, month, and year. */
export function formatSupportInvoiceListDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Compact invoice date for list cards — date only, drops year when it matches the current year. */
export function formatSupportInvoiceDateCompact(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const d = new Date(parsed);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Compact timestamp for list cards — drops year when it matches the current year. */
export function formatSupportDateTimeCompact(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const d = new Date(parsed);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} · ${time}`;
}

export function supportRequestIssueSummary(request: DealerSupportRequest): string {
  if (isSupportDraft(request)) {
    return request.description || 'Draft — tap to continue and submit';
  }
  if (request.type === 'chat') {
    return request.lastMessagePreview?.trim() || 'Tap to start chatting';
  }
  const category = request.category?.trim();
  const preview = request.lastMessagePreview?.trim() || request.description?.trim();
  if (category && preview) return `${category} — ${preview}`;
  return preview || category || 'No description yet';
}

export function countOpenSupportRequests(requests: DealerSupportRequest[]): number {
  return requests.filter(request => isSupportOpen(request)).length;
}

export function countActionableSupportRequests(requests: DealerSupportRequest[]): number {
  return requests.filter(request => {
    if (!isSupportOpen(request)) return false;
    return request.openStage === 'submitted'
      || request.openStage === 'awaiting_product'
      || request.openStage === 'in_transit'
      || request.openStage === 'in_workshop';
  }).length;
}
