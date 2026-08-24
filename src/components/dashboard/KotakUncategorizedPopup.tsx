import React, { useEffect, useMemo } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { isKotakPayInFeed } from '../salesOrders/KotakBankFeedsSheet';
import type { KotakBankFeed } from '../../lib/kotakBankFeeds';
import kotakBankLogo from '../../assets/kotak-mahindra-bank.jpg';

export type KotakPopupPhase = 'refreshing' | 'loading' | 'ready' | 'error';

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

function formatFeedStamp(feed: KotakBankFeed): { dayMonth: string; year: string; time: string | null } {
  const raw = feed.date;
  const time = clockFromValue(feed.postedTime) || clockFromValue(raw);
  if (!raw) return { dayMonth: '—', year: '', time };
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) return { dayMonth: raw, year: '', time };
  return {
    dayMonth: parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    year: `'${String(parsed.getFullYear()).slice(-2)}`,
    time,
  };
}

function formatFeedAmount(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function formatLastFetched(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB');
}

function feedTitle(feed: KotakBankFeed): string {
  return feed.payee?.trim() || feed.description?.trim() || 'Bank transaction';
}

function feedDetail(feed: KotakBankFeed): string | null {
  const desc = feed.description?.trim();
  const title = feedTitle(feed);
  if (desc && desc !== title) return desc;
  return null;
}

export const KotakUncategorizedPopup: React.FC<{
  feeds: KotakBankFeed[];
  fetchedAt: string | null;
  lastRefreshDate: string | null;
  phase: KotakPopupPhase;
  error: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}> = ({ feeds, fetchedAt, lastRefreshDate, phase, error, onClose, onRefresh }) => {
  const busy = phase === 'refreshing' || phase === 'loading';
  const fetchedLabel = formatLastFetched(lastRefreshDate || fetchedAt);
  const inFeeds = useMemo(() => feeds.filter(isKotakPayInFeed), [feeds]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="dealers-modal-backdrop kotak-uncat-popup"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel kotak-uncat-popup__modal"
        role="dialog"
        aria-labelledby="kotak-uncat-title"
        aria-busy={busy}
        onClick={event => event.stopPropagation()}
      >
        <div className="kotak-uncat-popup__head">
          <div className="kotak-uncat-popup__brand">
            <img src={kotakBankLogo} alt="" className="kotak-uncat-popup__logo" />
            <div>
              <h2 id="kotak-uncat-title">Kotak Current Account</h2>
              <p className="kotak-uncat-popup__fetched">
                {fetchedLabel
                  ? <>Bank feeds last fetched on <strong>{fetchedLabel}</strong></>
                  : 'Bank feeds last fetched date unavailable'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="kotak-uncat-popup__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.75} />
          </button>
        </div>

        <button
          type="button"
          className={`kotak-uncat-popup__refresh${phase === 'refreshing' ? ' is-busy' : ''}`}
          onClick={() => onRefresh?.()}
          disabled={busy || !onRefresh}
        >
          <RefreshCw size={16} className={phase === 'refreshing' ? 'spin-icon' : undefined} />
          {phase === 'refreshing' ? 'Refreshing Feeds…' : 'Refresh Feeds'}
        </button>

        {error && phase !== 'refreshing' ? (
          <p className="kotak-uncat-popup__hint is-fail" role="status">{error}</p>
        ) : phase === 'loading' ? (
          <p className="kotak-uncat-popup__hint">Loading uncategorised transactions…</p>
        ) : phase === 'ready' ? (
          <p className="kotak-uncat-popup__hint">
            {inFeeds.length} uncategorised IN {inFeeds.length === 1 ? 'transaction' : 'transactions'}
          </p>
        ) : null}

        {phase === 'refreshing' ? (
          <div className="kotak-uncat-popup__loading" role="status">
            <RefreshCw size={28} className="spin-icon" />
            <p>Refreshing Feeds from Kotak…</p>
          </div>
        ) : phase === 'error' && inFeeds.length === 0 ? (
          <p className="kotak-uncat-popup__empty" role="alert">
            {error || 'Could not load Kotak transactions.'}
          </p>
        ) : phase === 'loading' && inFeeds.length === 0 ? (
          <div className="kotak-uncat-popup__loading" role="status">
            <RefreshCw size={28} className="spin-icon" />
            <p>Loading uncategorised IN transactions…</p>
          </div>
        ) : inFeeds.length === 0 ? (
          <p className="kotak-uncat-popup__empty">No uncategorised IN transactions.</p>
        ) : (
          <>
            <div className="kotak-uncat-popup__cols" aria-hidden>
              <span>Date</span>
              <span>Transaction details</span>
              <span>Amount</span>
            </div>
            <ul className="kotak-uncat-popup__list">
              {inFeeds.map(feed => {
                const stamp = formatFeedStamp(feed);
                const extra = feedDetail(feed);
                return (
                  <li key={feed.transactionId} className="kotak-uncat-popup__row">
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
                    <span className="kotak-uncat-popup__amount is-in">
                      <small>In</small>
                      ₹{formatFeedAmount(feed.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="kotak-uncat-popup__footer">
          <button type="button" className="btn btn-primary kotak-uncat-popup__close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
