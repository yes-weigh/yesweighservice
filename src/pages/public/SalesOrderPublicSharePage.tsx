import React, { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { APP_NAME, FIRM_NAME } from '../../constants/brand';
import {
  isSoShareCode,
  subscribeSoShareLink,
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
    setLoading(true);
    setError('');
    const unsub = subscribeSoShareLink(shareCode, row => {
      setShare(row);
      setLoading(false);
      if (!row) setError('This order link is invalid or has expired.');
      else setError('');
    });
    return unsub;
  }, [shareCode]);

  if (!isSoShareCode(shareCode)) {
    return <Navigate to="/login" replace />;
  }

  const doc = share?.document;

  return (
    <div className="so-public-share">
      <header className="so-public-share__header">
        <div>
          <p className="so-public-share__brand">{APP_NAME}</p>
          <h1 className="so-public-share__title">
            {doc?.salesOrderNumber || 'Sales order'}
          </h1>
          {doc?.dateLabel ? (
            <p className="so-public-share__meta">{doc.dateLabel}</p>
          ) : null}
        </div>
        <p className="so-public-share__firm">{FIRM_NAME}</p>
      </header>

      <main className="so-public-share__main so-public-share__main--html">
        {loading ? (
          <p className="so-public-share__status">Loading order…</p>
        ) : error || !doc ? (
          <div className="so-public-share__status so-public-share__status--error">
            <p>{error || 'Order not found.'}</p>
            <Link to="/login" className="so-public-share__login">Sign in</Link>
          </div>
        ) : (
          <div className="so-public-share__doc">
            <DocumentPartyBlock
              className="so-public-share__party"
              customerName={doc.customerName || null}
              address={doc.shippingAddress || null}
              emptyAddressLabel="No address on file"
            />
            <InvoiceDocumentBody
              invoice={{
                subtotal: doc.subtotal,
                taxTotal: doc.taxTotal,
                total: doc.total,
                lineItems: doc.lineItems,
              }}
              currencyCode={doc.currencyCode}
              totalsAfterItems
            />
            {doc.notes ? (
              <section className="so-public-share__notes panel glass">
                <h3>Notes</h3>
                <p>{doc.notes}</p>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
};
