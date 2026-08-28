import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  countYesGatcLifetimeOvRv,
  dedupeYesGatcRcDetails,
  isYesoneIwpRcDetail,
  listYesGatcRcDetails,
  sumYesGatcRcHsnSoldQty,
  yesGatcOvRvForRc,
  yesGatcRcGroupSiblings,
  yesGatcRcOfficeName,
  yesGatcRcPlaceDistrictLine,
  type YesGatcOvRvTotals,
  type YesGatcRcDetail,
} from '../../../lib/yesgatcRecords';

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function groupSold(
  row: YesGatcRcDetail,
  all: readonly YesGatcRcDetail[],
  soldQty: Map<string, number>,
): number {
  return Math.max(0, ...yesGatcRcGroupSiblings(row, all).map(item => soldQty.get(item.id) || 0));
}

function groupOv(
  row: YesGatcRcDetail,
  all: readonly YesGatcRcDetail[],
  ovRv: Map<string, YesGatcOvRvTotals>,
): YesGatcOvRvTotals {
  const siblings = yesGatcRcGroupSiblings(row, all);
  return {
    ov: Math.max(0, ...siblings.map(item => yesGatcOvRvForRc(ovRv, item).ov)),
    rv: Math.max(0, ...siblings.map(item => yesGatcOvRvForRc(ovRv, item).rv)),
    linked: Math.max(0, ...siblings.map(item => yesGatcOvRvForRc(ovRv, item).linked)),
  };
}

export const RcOvReportTab: React.FC = () => {
  const [rows, setRows] = useState<YesGatcRcDetail[]>([]);
  const [ovRv, setOvRv] = useState<Map<string, YesGatcOvRvTotals>>(() => new Map());
  const [ovRvReady, setOvRvReady] = useState(false);
  const [soldQty, setSoldQty] = useState<Map<string, number>>(() => new Map());
  const [soldReady, setSoldReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all = await listYesGatcRcDetails();
      setRows(all.filter(row => !isYesoneIwpRcDetail(row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load RC OV report.');
    } finally {
      setLoading(false);
    }
  }, []);

  const rcCountKey = rows.map(row => `${row.id}:${row.code}:${row.ovCount ?? ''}:${row.linkedCount ?? ''}`).join('|');
  const soldKey = rows.map(row => `${row.id}:${row.dealerId || ''}`).join('|');

  useEffect(() => {
    void load();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  useEffect(() => {
    if (loading || rows.length === 0) return;
    let cancelled = false;
    setOvRvReady(false);
    void countYesGatcLifetimeOvRv(rows)
      .then(totals => {
        if (!cancelled) setOvRv(totals);
      })
      .catch(() => {
        if (!cancelled) setOvRv(new Map());
      })
      .finally(() => {
        if (!cancelled) setOvRvReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rcCountKey captures id/code/ov
  }, [loading, rcCountKey]);

  useEffect(() => {
    if (loading || rows.length === 0) return;
    let cancelled = false;
    setSoldReady(false);
    void sumYesGatcRcHsnSoldQty(rows)
      .then(qty => {
        if (!cancelled) setSoldQty(qty);
      })
      .catch(() => {
        if (!cancelled) setSoldQty(new Map());
      })
      .finally(() => {
        if (!cancelled) setSoldReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- soldKey captures id/dealer
  }, [loading, soldKey]);

  const sortedRows = useMemo(() => (
    dedupeYesGatcRcDetails(rows).sort((a, b) => {
      const ovDiff = groupOv(b, rows, ovRv).ov - groupOv(a, rows, ovRv).ov;
      if (ovDiff !== 0) return ovDiff;
      return yesGatcRcOfficeName(a).localeCompare(yesGatcRcOfficeName(b), 'en', { sensitivity: 'base' });
    })
  ), [ovRv, rows]);

  const qtyReady = soldReady && ovRvReady;

  return (
    <section className="gatc-report rc-ov-report" aria-label="RC OV report">
      {error ? <p className="gatc-report__error text-sm">{error}</p> : null}
      {loading ? (
        <p className="gatc-report__loading">Loading…</p>
      ) : sortedRows.length === 0 ? (
        <p className="gatc-report__empty">No RC offices yet.</p>
      ) : (
        <>
          <div className="rc-ov-report__list">
            <div className="rc-ov-report__head" aria-hidden>
              <span className="yesgatc-rc-row__sold">Sold</span>
              <span className="yesgatc-rc-row__ov">OV</span>
              <span className="yesgatc-rc-row__linked-qty">Linked</span>
              <span className="yesgatc-rc-row__diff">Bal</span>
            </div>
            {sortedRows.map(row => {
              const qty = groupOv(row, rows, ovRv);
              const sold = groupSold(row, rows, soldQty);
              const name = yesGatcRcOfficeName(row);
              const placeLine = yesGatcRcPlaceDistrictLine(row);
              return (
                <article key={row.id} className="rc-ov-report__card">
                  <div className="rc-ov-report__identity">
                    <p className="rc-ov-report__name">{name}</p>
                    {placeLine ? (
                      <p className="rc-ov-report__place">{placeLine}</p>
                    ) : null}
                  </div>
                  <div className="rc-ov-report__qty">
                    <span
                      className="yesgatc-rc-row__sold rc-ov-report__metric"
                      title="HSN 84238190, 84238290, 84231000 from 1 Feb 2026"
                    >
                      {soldReady ? formatCount(sold) : '…'}
                    </span>
                    <span className="yesgatc-rc-row__ov rc-ov-report__metric">
                      {ovRvReady ? formatCount(qty.ov) : '…'}
                    </span>
                    <span className="yesgatc-rc-row__linked-qty rc-ov-report__metric">
                      {ovRvReady ? formatCount(qty.linked) : '…'}
                    </span>
                    <span className="yesgatc-rc-row__diff rc-ov-report__metric" title="Sold minus OV">
                      {qtyReady ? formatCount(sold - qty.ov) : '…'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="rc-ov-report__foot">
            Sold is YesOne invoice qty from 1 Feb 2026. OV and Linked come from YesGATC.
            Bal is Sold − OV. Showing {sortedRows.length} offices.
          </p>
        </>
      )}
    </section>
  );
};
