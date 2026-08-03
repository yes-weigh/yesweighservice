import React, { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { APP_NAME, FIRM_NAME } from '../../constants/brand';
import {
  isSoShareCode,
  loadSoShareLink,
  type SoShareLinkRecord,
} from '../../lib/soShareLinks';

export const SalesOrderPublicSharePage: React.FC = () => {
  const { shareCode = '' } = useParams<{ shareCode: string }>();
  const [share, setShare] = useState<SoShareLinkRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSoShareCode(shareCode)) {
      setLoading(false);
      setShare(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadSoShareLink(shareCode)
      .then(row => {
        if (cancelled) return;
        setShare(row);
        if (!row) setError('This order link is invalid or has expired.');
      })
      .catch(() => {
        if (cancelled) return;
        setShare(null);
        setError('Could not load this order link.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [shareCode]);

  if (!isSoShareCode(shareCode)) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="so-public-share">
      <header className="so-public-share__header">
        <div>
          <p className="so-public-share__brand">{APP_NAME}</p>
          <h1 className="so-public-share__title">
            {share?.salesOrderNumber || 'Sales order'}
          </h1>
          {share?.dateLabel ? (
            <p className="so-public-share__meta">{share.dateLabel}</p>
          ) : null}
        </div>
        <p className="so-public-share__firm">{FIRM_NAME}</p>
      </header>

      <main className="so-public-share__main">
        {loading ? (
          <p className="so-public-share__status">Loading order…</p>
        ) : error || !share ? (
          <div className="so-public-share__status so-public-share__status--error">
            <p>{error || 'Order not found.'}</p>
            <Link to="/login" className="so-public-share__login">Sign in</Link>
          </div>
        ) : (
          <figure className="so-public-share__figure">
            <img
              className="so-public-share__image"
              src={share.imageUrl}
              alt={share.salesOrderNumber || 'Sales order'}
            />
          </figure>
        )}
      </main>
    </div>
  );
};
