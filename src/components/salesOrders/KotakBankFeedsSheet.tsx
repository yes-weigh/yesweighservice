import React, { useEffect, useMemo, useState } from 'react';
import { Check, Landmark, X } from 'lucide-react';
import type { KotakBankFeed } from '../../lib/kotakBankFeeds';

const PAYOUT_TYPES = new Set([
  'expense',
  'owner_drawings',
  'card_payment',
  'vendor_payment',
  'sales_return',
]);

const PAYIN_TYPES = new Set([
  'deposit',
  'other_income',
  'customer_payment',
  'sales_without_invoices',
  'interest_income',
  'owner_contribution',
  'expense_refund',
]);

const PAYOUT_NARRATION = /\bsent\s*to\b|\bsentimps\b|\bsent\s*imps\b|\boutward\b|\bremittance\b|\bwithdrawal\b|\bpaid\s+to\b|\bneft[- ]?(dr|out|debit)\b|\bimps[- ]?(out|dr|debit)\b|\brtgs[- ]?(dr|out|debit)\b/i;

const PAYIN_NARRATION = /\bneft[- ]?(cr|in|credit)\b|\bimps[- ]?(cr|in|credit)\b|\brtgs[- ]?(cr|in|credit)\b|\binward\b|\breceived\b|\bby\s+transfer\b|\bupi[-/]\b|\bdeposit\b|\bcredit\s+from\b/i;

function formatClock(hours: number, minutes: number): string {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function clockFromValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const iso = value.match(/T(\d{2}):(\d{2})(?::\d{2})?/);
  if (iso) return formatClock(Number(iso[1]), Number(iso[2]));

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const spaced = value.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?(?:\s|$)/);
  if (spaced) {
    let hours = Number(spaced[1]);
    const minutes = Number(spaced[2]);
    const meridiem = spaced[3]?.toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    if (hours <= 23 && minutes <= 59) return formatClock(hours, minutes);
  }

  return null;
}

function clockFromNarration(feed: KotakBankFeed): string | null {
  const text = `${feed.description || ''} ${feed.payee || ''} ${feed.referenceNumber || ''}`;
  const match = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?(?:[^\d]|$)/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return formatClock(hours, minutes);
}

function formatFeedStamp(feed: KotakBankFeed): { dayMonth: string; year: string; time: string } {
  const raw = feed.date;
  if (!raw) {
    return {
      dayMonth: '—',
      year: '',
      time: clockFromValue(feed.postedTime) || clockFromNarration(feed) || '—',
    };
  }
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      dayMonth: raw,
      year: '',
      time: clockFromValue(feed.postedTime) || clockFromNarration(feed) || '—',
    };
  }
  const dayMonth = parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const year = `'${String(parsed.getFullYear()).slice(-2)}`;
  const time = clockFromValue(feed.postedTime)
    || clockFromValue(raw)
    || clockFromNarration(feed)
    || '—';
  return { dayMonth, year, time };
}

function formatFeedAmount(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function feedTitle(feed: KotakBankFeed): string {
  return feed.payee?.trim()
    || feed.description?.trim()
    || 'Bank transaction';
}

function feedDetail(feed: KotakBankFeed): string | null {
  const desc = feed.description?.trim();
  const title = feedTitle(feed);
  if (desc && desc !== title) return desc;
  return null;
}

function amountsMatch(amount: number, due: number): boolean {
  return Math.abs(Number(amount) - due) < 0.009;
}

/**
 * Pay-in to the bank only.
 * Zoho Books uses accounting signs: debit = money in, credit = money out.
 */
export function isKotakPayInFeed(feed: KotakBankFeed): boolean {
  const text = `${feed.payee || ''} ${feed.description || ''}`.toLowerCase();
  if (PAYOUT_NARRATION.test(text)) return false;

  const side = String(feed.debitOrCredit || '').toLowerCase();
  const type = String(feed.transactionType || '').toLowerCase();
  if (side === 'credit' || side === 'cr') return false;
  if (PAYOUT_TYPES.has(type)) return false;
  if (side === 'debit' || side === 'dr') return true;
  if (PAYIN_TYPES.has(type)) return true;
  return PAYIN_NARRATION.test(text);
}

export const KotakBankFeedsSheet: React.FC<{
  feeds: KotakBankFeed[];
  fetchedAt: string | null;
  loading?: boolean;
  matchAmount?: number | null;
  onClose: () => void;
  onSelect?: (feed: KotakBankFeed) => void;
}> = ({ feeds, fetchedAt, loading = false, matchAmount, onClose, onSelect }) => {
  const due = Number(matchAmount);
  const hasDue = Number.isFinite(due) && due > 0;
  const payInFeeds = useMemo(() => feeds.filter(isKotakPayInFeed), [feeds]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const exact = hasDue
      ? payInFeeds.find(feed => amountsMatch(feed.amount, due))
      : null;
    setSelectedId(exact?.transactionId ?? null);
  }, [loading, payInFeeds, hasDue, due]);

  const selected = payInFeeds.find(feed => feed.transactionId === selectedId) ?? null;

  return (
    <div className="dealers-modal-backdrop kotak-feeds-sheet" onClick={onClose}>
      <div
        className="dealers-modal panel glass kotak-feeds-sheet__modal"
        role="dialog"
        aria-labelledby="kotak-feeds-title"
        aria-busy={loading}
        onClick={e => e.stopPropagation()}
      >
        <div className="kotak-feeds-sheet__head">
          <div className="kotak-feeds-sheet__head-copy">
            <h2 id="kotak-feeds-title">
              <Landmark size={18} aria-hidden />
              Pay-in to bank
            </h2>
            <p className="text-muted text-sm mb-0">
              {loading
                ? 'Fetching uncategorised Kotak pay-ins…'
                : (payInFeeds.length === 0
                  ? 'No uncategorised pay-in transactions.'
                  : `${payInFeeds.length} pay-in ${payInFeeds.length === 1 ? 'transaction' : 'transactions'}`)}
              {!loading && fetchedAt ? ` · ${new Date(fetchedAt).toLocaleString('en-IN')}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="kotak-feeds-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.75} />
          </button>
        </div>

        <div className="kotak-feeds-sheet__cols" aria-hidden>
          <span>Date</span>
          <span>Transaction details</span>
          <span>Amount</span>
        </div>

        {loading ? (
          <p className="kotak-feeds-sheet__loading">Loading feeds from Zoho…</p>
        ) : payInFeeds.length === 0 ? (
          <p className="kotak-feeds-sheet__empty">No uncategorised pay-in transactions to show.</p>
        ) : (
          <ul className="kotak-feeds-sheet__list">
            {payInFeeds.map(feed => {
              const stamp = formatFeedStamp(feed);
              const exact = hasDue && amountsMatch(feed.amount, due);
              const extra = feedDetail(feed);
              const isSelected = selectedId === feed.transactionId;
              return (
                <li key={feed.transactionId}>
                  <button
                    type="button"
                    className={[
                      'kotak-feeds-sheet__row',
                      exact ? 'kotak-feeds-sheet__row--match' : '',
                      isSelected ? 'kotak-feeds-sheet__row--selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedId(feed.transactionId)}
                    aria-pressed={isSelected}
                  >
                    <div className="kotak-feeds-sheet__date">
                      <span>{stamp.dayMonth}</span>
                      {stamp.year ? <span>{stamp.year}</span> : null}
                      <span className="kotak-feeds-sheet__time">{stamp.time}</span>
                    </div>
                    <div className="kotak-feeds-sheet__details">
                      <strong>{feedTitle(feed)}</strong>
                      {extra ? <span>{extra}</span> : null}
                      <span className="kotak-feeds-sheet__ref">
                        Chq/Ref No.: {feed.referenceNumber?.trim() || feed.transactionId}
                      </span>
                    </div>
                    <span className="kotak-feeds-sheet__amount-wrap">
                      <strong className="kotak-feeds-sheet__amount">
                        {formatFeedAmount(feed.amount)}
                      </strong>
                      {isSelected ? (
                        <Check className="kotak-feeds-sheet__tick" size={14} strokeWidth={3} aria-hidden />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="kotak-feeds-sheet__footer">
          <button
            type="button"
            className="btn btn-primary kotak-feeds-sheet__select"
            disabled={!selected || loading}
            onClick={() => {
              if (!selected) return;
              onSelect?.(selected);
              onClose();
            }}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
};
