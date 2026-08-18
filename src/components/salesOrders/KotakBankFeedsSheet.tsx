import React from 'react';
import { Landmark, X } from 'lucide-react';
import { formatCurrency } from '../../lib/catalog';
import type { KotakBankFeed } from '../../lib/kotakBankFeeds';

function feedLabel(feed: KotakBankFeed): string {
  return feed.payee?.trim()
    || feed.description?.trim()
    || feed.referenceNumber?.trim()
    || 'Kotak feed';
}

export const KotakBankFeedsSheet: React.FC<{
  feeds: KotakBankFeed[];
  fetchedAt: string | null;
  matchAmount?: number | null;
  onClose: () => void;
}> = ({ feeds, fetchedAt, matchAmount, onClose }) => {
  const due = Number(matchAmount);
  const hasDue = Number.isFinite(due) && due > 0;

  return (
    <div className="dealers-modal-backdrop kotak-feeds-sheet" onClick={onClose}>
      <div
        className="dealers-modal panel glass kotak-feeds-sheet__modal"
        role="dialog"
        aria-labelledby="kotak-feeds-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="dealers-modal__header">
          <div>
            <h2 id="kotak-feeds-title">
              <Landmark size={18} aria-hidden />
              Uncategorised Kotak feeds
            </h2>
            <p className="text-muted text-sm mb-0">
              {feeds.length === 0
                ? 'No uncategorised Kotak bank feeds in Zoho.'
                : `${feeds.length} uncategorised ${feeds.length === 1 ? 'feed' : 'feeds'}`}
              {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleString('en-IN')}` : ''}
            </p>
          </div>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {feeds.length > 0 ? (
          <ul className="kotak-feeds-sheet__list">
            {feeds.map(feed => {
              const credit = feed.debitOrCredit === 'credit';
              const matchesDue = hasDue && Math.abs(feed.amount - due) < 0.009;
              return (
                <li
                  key={feed.transactionId}
                  className={`kotak-feeds-sheet__row${matchesDue ? ' kotak-feeds-sheet__row--match' : ''}`}
                >
                  <div>
                    <strong>{feedLabel(feed)}</strong>
                    <span className="text-muted text-sm">
                      {feed.date || '—'}
                      {feed.accountName ? ` · ${feed.accountName}` : ''}
                      {credit ? ' · credit' : feed.debitOrCredit ? ` · ${feed.debitOrCredit}` : ''}
                    </span>
                  </div>
                  <strong className={credit ? 'kotak-feeds-sheet__credit' : ''}>
                    {formatCurrency(feed.amount, 'INR')}
                  </strong>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
};
