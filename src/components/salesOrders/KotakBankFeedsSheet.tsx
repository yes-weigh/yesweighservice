import React, { useEffect, useMemo, useState } from 'react';
import { Check, Landmark, X } from 'lucide-react';
import type { KotakBankFeed } from '../../lib/kotakBankFeeds';
import { VerifyInvoiceClock } from './VerifyInvoiceClock';

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
  const text = `${feed.description || ''} ${feed.payee || ''} ${feed.referenceNumber || ''} ${feed.postedTime || ''}`;
  const match = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?(?:[^\d]|$)/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return formatClock(hours, minutes);
}

function formatFeedStamp(feed: KotakBankFeed): { dayMonth: string; year: string; time: string | null } {
  const raw = feed.date;
  const time = clockFromValue(feed.postedTime)
    || clockFromValue(raw)
    || clockFromNarration(feed);
  if (!raw) {
    return { dayMonth: '—', year: '', time };
  }
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) {
    return { dayMonth: raw, year: '', time };
  }
  const dayMonth = parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const year = `'${String(parsed.getFullYear()).slice(-2)}`;
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

const AMOUNT_MATCH_WINDOW = 500;

function amountsMatch(amount: number, due: number): boolean {
  return Math.abs(Number(amount) - due) < 0.009;
}

function amountDelta(amount: number, due: number): number {
  return Math.abs(Number(amount) - due);
}

function isAmountNearDue(amount: number, due: number): boolean {
  return amountDelta(amount, due) <= AMOUNT_MATCH_WINDOW + 0.009;
}

function nameHits(feed: KotakBankFeed, customerName: string): number {
  const text = `${feed.payee || ''} ${feed.description || ''}`.toLowerCase();
  const tokens = customerName.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 4);
  return tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function rankPayInFeeds(
  feeds: KotakBankFeed[],
  due: number,
  hasDue: boolean,
  customerName: string,
): KotakBankFeed[] {
  return [...feeds].sort((left, right) => {
    if (hasDue) {
      const delta = amountDelta(left.amount, due) - amountDelta(right.amount, due);
      if (delta !== 0) return delta;
    }
    const names = nameHits(right, customerName) - nameHits(left, customerName);
    if (names !== 0) return names;
    return String(right.date || '').localeCompare(String(left.date || ''));
  });
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

/** Money leaving the bank (vendor remittance / SENT TO / Zoho credit). */
export function isKotakPayoutFeed(feed: KotakBankFeed): boolean {
  if (isKotakPayInFeed(feed)) return false;
  const text = `${feed.payee || ''} ${feed.description || ''}`.toLowerCase();
  const side = String(feed.debitOrCredit || '').toLowerCase();
  const type = String(feed.transactionType || '').toLowerCase();
  if (side === 'credit' || side === 'cr') return true;
  if (PAYOUT_TYPES.has(type)) return true;
  return PAYOUT_NARRATION.test(text);
}

export const KotakBankFeedsSheet: React.FC<{
  feeds: KotakBankFeed[];
  fetchedAt: string | null;
  loading?: boolean;
  selecting?: boolean;
  kind?: 'payin' | 'payout';
  matchAmount?: number | null;
  matchCustomerName?: string | null;
  salesOrderId?: string | null;
  purchaseOrderId?: string | null;
  reservedTransactionId?: string | null;
  usdToInrRate?: number | null;
  onClose: () => void;
  onSelect?: (feed: KotakBankFeed) => void | Promise<void>;
  onAssociatePayout?: (feed: KotakBankFeed, usd: { amountUsd: number; usdToInrRate: number }) => void | Promise<void>;
}> = ({
  feeds,
  fetchedAt,
  loading = false,
  selecting = false,
  kind = 'payin',
  matchAmount,
  matchCustomerName,
  salesOrderId,
  purchaseOrderId,
  reservedTransactionId,
  usdToInrRate = null,
  onClose,
  onSelect,
  onAssociatePayout,
}) => {
  const due = Number(matchAmount);
  const hasDue = kind === 'payin' && Number.isFinite(due) && due > 0;
  const customerName = String(matchCustomerName || '').trim();
  const listedFeeds = useMemo(() => {
    const soId = String(salesOrderId || '').trim();
    const poId = String(purchaseOrderId || '').trim();
    const filtered = feeds.filter(feed => {
      if (kind === 'payout') {
        if (!isKotakPayoutFeed(feed)) return false;
        const reservedPo = String(feed.reservedForPurchaseOrderId || '').trim();
        if (reservedPo && reservedPo !== poId) return false;
        const reservedSo = String(feed.reservedForSalesOrderId || '').trim();
        if (reservedSo) return false;
        return true;
      }
      if (!isKotakPayInFeed(feed)) return false;
      const reservedBy = String(feed.reservedForSalesOrderId || '').trim();
      if (reservedBy && reservedBy !== soId) return false;
      if (hasDue && !isAmountNearDue(feed.amount, due) && feed.transactionId !== String(reservedTransactionId || '')) {
        return false;
      }
      return true;
    });
    if (kind === 'payout') {
      return [...filtered].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    return rankPayInFeeds(filtered, due, hasDue, customerName);
  }, [feeds, kind, salesOrderId, purchaseOrderId, due, hasDue, customerName, reservedTransactionId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState('');
  const [usdDraft, setUsdDraft] = useState('');

  useEffect(() => {
    if (loading) return;
    const reserved = String(reservedTransactionId || '').trim();
    if (reserved && listedFeeds.some(feed => feed.transactionId === reserved)) {
      setSelectedId(reserved);
      return;
    }
    setSelectedId(listedFeeds[0]?.transactionId ?? null);
  }, [loading, listedFeeds, reservedTransactionId]);

  const selected = listedFeeds.find(feed => feed.transactionId === selectedId) ?? null;
  const rate = Number(usdToInrRate);
  const hasRate = Number.isFinite(rate) && rate > 0;

  useEffect(() => {
    if (kind !== 'payout' || !selected || !hasRate) {
      if (!selected) setUsdDraft('');
      return;
    }
    setUsdDraft((selected.amount / rate).toFixed(2));
  }, [kind, selected, hasRate, rate]);

  const payoutNoun = kind === 'payout' ? 'payout' : 'pay-in';
  const title = kind === 'payout' ? 'Payout from bank' : 'Pay-in to bank';
  const usdAmount = Number(usdDraft);
  const bankCharges = kind === 'payout' && selected && hasRate && usdAmount > 0
    ? Math.max(0, Math.round((selected.amount - usdAmount * rate) * 100) / 100)
    : 0;

  return (
    <div className="dealers-modal-backdrop kotak-feeds-sheet" onClick={selecting ? undefined : onClose}>
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
              {title}
            </h2>
            <p className="text-muted text-sm mb-0">
              {loading
                ? `Fetching uncategorised Kotak ${payoutNoun}s…`
                : (listedFeeds.length === 0
                  ? (kind === 'payin' && hasDue
                    ? `No pay-in within ±${AMOUNT_MATCH_WINDOW} of the amount due.`
                    : `No uncategorised ${payoutNoun} transactions.`)
                  : `${listedFeeds.length} uncategorised ${payoutNoun} ${listedFeeds.length === 1 ? 'transaction' : 'transactions'}`)}
              {!loading && fetchedAt ? ` · ${new Date(fetchedAt).toLocaleString('en-IN')}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="kotak-feeds-sheet__close"
            onClick={onClose}
            disabled={selecting}
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
        ) : listedFeeds.length === 0 ? (
          <p className="kotak-feeds-sheet__empty">
            {kind === 'payin' && hasDue
              ? `No uncategorised pay-in matches the amount due or falls within ±${AMOUNT_MATCH_WINDOW}.`
              : `No uncategorised ${payoutNoun} transactions to show.`}
          </p>
        ) : (
          <ul className="kotak-feeds-sheet__list">
            {listedFeeds.map(feed => {
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
                      <span>{stamp.dayMonth}{stamp.year ? ` ${stamp.year}` : ''}</span>
                      {stamp.time ? (
                        <span className="kotak-feeds-sheet__time">{stamp.time}</span>
                      ) : null}
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
          {kind === 'payout' && selected ? (
            <div className="kotak-feeds-sheet__usd">
              <span className="kotak-feeds-sheet__usd-inr">
                INR {formatFeedAmount(selected.amount)}
                {hasRate ? ` · 1 USD = ₹${rate.toFixed(2)}` : ' · rate unavailable'}
                {bankCharges > 0 ? ` · bank charges ₹${formatFeedAmount(bankCharges)}` : ''}
              </span>
              <label className="kotak-feeds-sheet__usd-field">
                <span>USD</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="input-field"
                  value={usdDraft}
                  disabled={selecting}
                  onChange={e => setUsdDraft(e.target.value)}
                  aria-label="USD amount"
                />
              </label>
            </div>
          ) : null}
          {selectError ? (
            <p className="kotak-feeds-sheet__select-error mb-0">{selectError}</p>
          ) : null}
          <button
            type="button"
            className={`btn btn-primary kotak-feeds-sheet__select${selecting ? ' kotak-feeds-sheet__select--busy' : ''}`}
            disabled={!selected || loading || selecting || (kind === 'payout' && !(Number(usdDraft) > 0 && hasRate))}
            onClick={() => {
              if (!selected) return;
              setSelectError('');
              if (kind === 'payout') {
                void Promise.resolve(onAssociatePayout?.(selected, {
                  amountUsd: Math.round(Number(usdDraft) * 100) / 100,
                  usdToInrRate: rate,
                })).catch((err: unknown) => {
                  setSelectError(err instanceof Error ? err.message : 'Could not mark this payout as paid.');
                });
                return;
              }
              void Promise.resolve(onSelect?.(selected)).catch((err: unknown) => {
                setSelectError(err instanceof Error ? err.message : 'Could not invoice from this pay-in.');
              });
            }}
          >
            {selecting ? <VerifyInvoiceClock size={20} /> : null}
            {kind === 'payout'
              ? (selecting ? 'Paying…' : 'Paid')
              : (selecting ? 'Invoicing…' : 'Select & Invoice')}
          </button>
        </div>
      </div>
    </div>
  );
};

