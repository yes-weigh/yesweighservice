import type { ZohoDealer } from '../types/dealers';
import { DEALER_STAGES } from '../types/dealers';

export type DealerStatusKey =
  | 'active-yes'
  | 'active-no'
  | 'non-active-yes'
  | 'non-active-no'
  | 'blacklisted-yes'
  | 'blacklisted-no'
  | 'unset-yes'
  | 'unset-no';

export interface DealerStatusMeta {
  key: DealerStatusKey;
  symbol: string;
  label: string;
  badgeClass: string;
  stage: string | null;
  signedIn: boolean;
}

function normalizeStage(stage: string | null | undefined): string | null {
  if (!stage) return null;
  if (stage === 'Black listed' || stage === 'Blacklisted') return 'Black listed';
  if (DEALER_STAGES.includes(stage as typeof DEALER_STAGES[number])) return stage;
  return stage;
}

export function getDealerStatusKey(dealer: Pick<ZohoDealer, 'dealerStage' | 'signedIn'>): DealerStatusKey {
  const stage = normalizeStage(dealer.dealerStage);
  const signed = Boolean(dealer.signedIn);

  if (stage === 'Active') return signed ? 'active-yes' : 'active-no';
  if (stage === 'Non Active') return signed ? 'non-active-yes' : 'non-active-no';
  if (stage === 'Black listed') return signed ? 'blacklisted-yes' : 'blacklisted-no';
  return signed ? 'unset-yes' : 'unset-no';
}

const STATUS_META: Record<DealerStatusKey, Omit<DealerStatusMeta, 'key' | 'stage' | 'signedIn'>> = {
  'active-yes': {
    symbol: '◉',
    label: 'Active · Signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--active-yes',
  },
  'active-no': {
    symbol: '○',
    label: 'Active · Not signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--active-no',
  },
  'non-active-yes': {
    symbol: '◐',
    label: 'Non Active · Signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--non-active-yes',
  },
  'non-active-no': {
    symbol: '◔',
    label: 'Non Active · Not signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--non-active-no',
  },
  'blacklisted-yes': {
    symbol: '⊗',
    label: 'Blacklisted · Signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--blacklisted-yes',
  },
  'blacklisted-no': {
    symbol: '⊘',
    label: 'Blacklisted · Not signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--blacklisted-no',
  },
  'unset-yes': {
    symbol: '◎',
    label: 'Unset · Signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--unset-yes',
  },
  'unset-no': {
    symbol: '◌',
    label: 'Unset · Not signed in',
    badgeClass: 'dealers-status-badge dealers-status-badge--unset-no',
  },
};

export const DEALER_STATUS_LEGEND: DealerStatusMeta[] = (
  Object.entries(STATUS_META) as [DealerStatusKey, typeof STATUS_META[DealerStatusKey]][]
).map(([key, meta]) => ({
  key,
  ...meta,
  stage: key.startsWith('active') ? 'Active'
    : key.startsWith('non-active') ? 'Non Active'
      : key.startsWith('blacklisted') ? 'Black listed'
        : null,
  signedIn: key.endsWith('-yes'),
}));

export function getDealerStatusMeta(
  dealer: Pick<ZohoDealer, 'dealerStage' | 'signedIn'>,
): DealerStatusMeta {
  const key = getDealerStatusKey(dealer);
  const meta = STATUS_META[key];
  return {
    key,
    ...meta,
    stage: normalizeStage(dealer.dealerStage),
    signedIn: Boolean(dealer.signedIn),
  };
}

export function getStatusMetaByKey(key: DealerStatusKey): DealerStatusMeta {
  const meta = STATUS_META[key];
  return {
    key,
    ...meta,
    stage: key.startsWith('active') ? 'Active'
      : key.startsWith('non-active') ? 'Non Active'
        : key.startsWith('blacklisted') ? 'Black listed'
          : null,
    signedIn: key.endsWith('-yes'),
  };
}

export function getStageOptionsForSignedIn(signedIn: boolean) {
  const keys: DealerStatusKey[] = signedIn
    ? ['unset-yes', 'active-yes', 'non-active-yes', 'blacklisted-yes']
    : ['unset-no', 'active-no', 'non-active-no', 'blacklisted-no'];

  return keys.map(key => {
    const meta = getStatusMetaByKey(key);
    return {
      key,
      meta,
      value: meta.stage ?? '',
      label: meta.symbol,
      title: meta.label,
    };
  });
}
