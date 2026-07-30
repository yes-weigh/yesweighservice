import { useEffect, useMemo, useState } from 'react';
import { Link2, Play, RefreshCw, UserPlus } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import { useConfirm } from '../../context/ConfirmContext';
import {
  analyzeDealerStaffLinking,
  backfillDealerAssignedStaff,
  claimDealersBySalesperson,
  dealerErrorMessage,
  listAssignableDealerStaff,
  subscribeDealerStaffLinkingCheck,
  type DealerStaffLinkingAnalysis,
} from '../../lib/dealers';
import type { AssignableStaffOption } from '../../types/dealers';

function formatUpdatedAt(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  }
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toLocaleString();
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    const seconds = Number((value as { seconds: number }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toLocaleString();
  }
  return null;
}

export function DealerStaffLinkingPanel() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [claimingId, setClaimingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [result, setResult] = useState<DealerStaffLinkingAnalysis | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [staffOptions, setStaffOptions] = useState<AssignableStaffOption[]>([]);
  const [staffBySalesperson, setStaffBySalesperson] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const staff = await listAssignableDealerStaff();
        if (!cancelled) setStaffOptions(staff);
      } catch {
        if (!cancelled) setStaffOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeDealerStaffLinkingCheck(
      data => {
        setResult(data);
        setSnapshotReady(true);
        if (data?.status === 'running') {
          setLoading(true);
        } else if (data?.status === 'ready' || data?.status === 'error') {
          setLoading(false);
        }
        if (data?.status === 'error' && data.errorMessage) {
          setError(data.errorMessage);
        }
      },
      err => {
        setSnapshotReady(true);
        setError(err.message || 'Could not load saved linking check.');
      },
    );
    return () => unsub();
  }, []);

  const updatedLabel = useMemo(
    () => formatUpdatedAt(result?.updatedAt) || formatUpdatedAt(result?.runCompletedAt),
    [result?.updatedAt, result?.runCompletedAt],
  );

  const runCheck = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await analyzeDealerStaffLinking();
      // Result arrives via realtime snapshot write from the function.
      setSuccess('Linking check saved. Results update live as you claim dealers.');
    } catch (err) {
      setError(dealerErrorMessage(err));
      setLoading(false);
    }
  };

  const applyAssignable = async () => {
    setApplying(true);
    setError('');
    setSuccess('');
    try {
      const fill = await backfillDealerAssignedStaff({ onlyFillUnassigned: true });
      setSuccess(
        `Assigned ${fill.filled} dealer${fill.filled === 1 ? '' : 's'} from linked salespersons.`,
      );
      // Cache patch arrives via realtime snapshot — no full re-scan.
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const claimRow = async (row: {
    zohoSalespersonId: string;
    zohoSalespersonName: string | null;
    unassignedDealers: number;
  }) => {
    const staffUid = staffBySalesperson[row.zohoSalespersonId] || '';
    if (!staffUid) {
      setError('Choose a portal owner before claiming dealers.');
      return;
    }
    const staff = staffOptions.find(s => s.uid === staffUid);
    const spLabel = row.zohoSalespersonName || row.zohoSalespersonId;
    const ok = await confirm({
      title: 'Claim these dealers?',
      message:
        `Move ${row.unassignedDealers} unassigned dealer${row.unassignedDealers === 1 ? '' : 's'} `
        + `from ${spLabel} to ${staff?.displayName || 'selected staff'}, `
        + 'and link this Zoho salesperson to their profile.',
      confirmLabel: 'Claim dealers',
    });
    if (!ok) return;

    setClaimingId(row.zohoSalespersonId);
    setError('');
    setSuccess('');
    try {
      const claim = await claimDealersBySalesperson({
        zohoSalespersonId: row.zohoSalespersonId,
        zohoSalespersonName: row.zohoSalespersonName,
        staffUid,
      });
      setSuccess(
        `Claimed ${claim.assigned} dealer${claim.assigned === 1 ? '' : 's'} for ${claim.staffName}`
        + (claim.linkedSalesperson ? ' · Zoho salesperson linked' : ''),
      );
      setStaffBySalesperson(prev => {
        const next = { ...prev };
        delete next[row.zohoSalespersonId];
        return next;
      });
      // Snapshot updates in realtime from the function cache patch.
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setClaimingId('');
    }
  };

  const busy = loading || applying || Boolean(claimingId);
  const hasReadyResult = Boolean(result?.summary && result.status !== 'error');

  return (
    <div className="dealer-linking-panel">
      <section className="panel glass dealer-linking-panel__hero">
        <div className="dealer-linking-panel__hero-copy">
          <h2>Dealer linking check</h2>
          <p className="text-muted text-sm">
            Resolve each unassigned dealer from their latest invoice salesperson
            (skipping {result?.ignoredSalespersons?.join(', ') || 'yescloud server, Cloud Charges, GATC SELF'}).
            Results are saved and update live when you claim or assign — re-run only when you need a fresh scan.
          </p>
          {updatedLabel ? (
            <p className="text-muted text-sm dealer-linking-panel__meta">
              Last saved {updatedLabel}
              {result?.status === 'running' ? ' · scan in progress' : ''}
            </p>
          ) : null}
        </div>
        <div className="dealer-linking-panel__hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void runCheck()}
          >
            {loading ? <RefreshCw size={16} className="spin-icon" /> : <Play size={16} />}
            {loading ? 'Running check…' : hasReadyResult ? 'Re-run linking check' : 'Run dealer linking check'}
          </button>
          {result && (result.summary?.alreadyAssignable ?? 0) > 0 ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void applyAssignable()}
            >
              {applying ? <RefreshCw size={16} className="spin-icon" /> : <UserPlus size={16} />}
              {applying
                ? 'Assigning…'
                : `Assign ${result.summary.alreadyAssignable} ready dealers`}
            </button>
          ) : null}
        </div>
      </section>

      {success ? (
        <div
          className="products-inline-error panel glass"
          style={{ borderColor: 'rgba(16,185,129,0.35)', color: '#6ee7b7' }}
        >
          <span>{success}</span>
        </div>
      ) : null}

      {error ? (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      ) : null}

      {!snapshotReady || (loading && !hasReadyResult) ? (
        <FetchingLoader label={loading ? 'Scanning dealers and invoices…' : 'Loading saved check…'} />
      ) : null}

      {hasReadyResult && result?.summary ? (
        <>
          <section className="dealer-linking-kpis" aria-label="Linking summary">
            <div className="panel glass dealer-linking-kpi">
              <span className="dealer-linking-kpi__label">Unassigned</span>
              <strong>{result.summary.unassignedDealers.toLocaleString()}</strong>
            </div>
            <div className="panel glass dealer-linking-kpi">
              <span className="dealer-linking-kpi__label">Ready to assign</span>
              <strong>{result.summary.alreadyAssignable.toLocaleString()}</strong>
            </div>
            <div className="panel glass dealer-linking-kpi">
              <span className="dealer-linking-kpi__label">Need staff link</span>
              <strong>{result.summary.needStaffLink.toLocaleString()}</strong>
            </div>
            <div className="panel glass dealer-linking-kpi">
              <span className="dealer-linking-kpi__label">No usable invoice</span>
              <strong>{result.summary.noUsableInvoice.toLocaleString()}</strong>
            </div>
          </section>

          {(result.alreadyAssignableBySalesperson?.length ?? 0) > 0 ? (
            <section className="panel glass dealer-linking-section">
              <header className="dealer-linking-section__head">
                <Link2 size={18} aria-hidden />
                <div>
                  <h3>Ready to assign</h3>
                  <p className="text-muted text-sm">
                    Last-invoice salesperson is already linked to portal staff.
                  </p>
                </div>
              </header>
              <div className="dealer-linking-table-wrap">
                <table className="dealers-table dealer-linking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Zoho salesperson</th>
                      <th>Portal staff</th>
                      <th className="dealer-linking-table__num">Dealers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.alreadyAssignableBySalesperson.map((row, index) => (
                      <tr key={row.zohoSalespersonId}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="dealer-linking-table__primary">
                            {row.zohoSalespersonName || row.zohoSalespersonId}
                          </div>
                          <div className="text-muted text-sm">{row.zohoSalespersonId}</div>
                        </td>
                        <td>
                          <div className="dealer-linking-table__primary">{row.linkedStaffName}</div>
                          {row.linkedStaffEmail ? (
                            <div className="text-muted text-sm">{row.linkedStaffEmail}</div>
                          ) : null}
                        </td>
                        <td className="dealer-linking-table__num">{row.unassignedDealers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel glass dealer-linking-section">
            <header className="dealer-linking-section__head">
              <UserPlus size={18} aria-hidden />
              <div>
                <h3>Biggest unlocks if you link staff</h3>
                <p className="text-muted text-sm">
                  Pick a portal owner and claim every unassigned dealer for that Zoho salesperson.
                </p>
              </div>
            </header>
            {(result.unlocks?.length ?? 0) === 0 ? (
              <p className="text-muted dealer-linking-empty">No unlocks — every usable last-invoice salesperson is already linked.</p>
            ) : (
              <div className="dealer-linking-table-wrap">
                <table className="dealers-table dealer-linking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Zoho salesperson</th>
                      <th className="dealer-linking-table__num">Linkable dealers</th>
                      <th>Assign to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unlocks.map((row, index) => {
                      const selected = staffBySalesperson[row.zohoSalespersonId] || '';
                      const isClaiming = claimingId === row.zohoSalespersonId;
                      return (
                        <tr key={row.zohoSalespersonId}>
                          <td>{index + 1}</td>
                          <td>
                            <div className="dealer-linking-table__primary">
                              {row.zohoSalespersonName || row.zohoSalespersonId}
                            </div>
                            <div className="text-muted text-sm">{row.zohoSalespersonId}</div>
                          </td>
                          <td className="dealer-linking-table__num">{row.unassignedDealers}</td>
                          <td>
                            <div className="dealer-linking-claim">
                              <select
                                className="catalog-select dealer-linking-claim__select"
                                value={selected}
                                disabled={busy}
                                aria-label={`Portal owner for ${row.zohoSalespersonName || row.zohoSalespersonId}`}
                                onChange={e => {
                                  const value = e.target.value;
                                  setStaffBySalesperson(prev => ({
                                    ...prev,
                                    [row.zohoSalespersonId]: value,
                                  }));
                                }}
                              >
                                <option value="">Choose staff…</option>
                                {staffOptions.map(staff => (
                                  <option key={staff.uid} value={staff.uid}>
                                    {staff.displayName}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={busy || !selected}
                                onClick={() => void claimRow(row)}
                              >
                                {isClaiming ? (
                                  <RefreshCw size={14} className="spin-icon" />
                                ) : (
                                  <UserPlus size={14} />
                                )}
                                {isClaiming ? 'Claiming…' : 'Claim dealers'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel glass dealer-linking-section">
            <header className="dealer-linking-section__head">
              <div>
                <h3>No usable invoice</h3>
                <p className="text-muted text-sm">
                  Unassigned dealers with no invoice salesperson after ignoring
                  {' '}{(result.ignoredSalespersons || []).join(', ')}.
                </p>
              </div>
              <span className="dealer-linking-section__count">
                {(result.noUsableInvoiceDealers?.length ?? 0).toLocaleString()}
              </span>
            </header>
            {(result.noUsableInvoiceDealers?.length ?? 0) === 0 ? (
              <p className="text-muted dealer-linking-empty">None.</p>
            ) : (
              <div className="dealer-linking-table-wrap">
                <table className="dealers-table dealer-linking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Dealer</th>
                      <th>Code</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.noUsableInvoiceDealers.map((row, index) => (
                      <tr key={row.id}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="dealer-linking-table__primary">
                            {row.companyName || row.contactName || row.id}
                          </div>
                          {row.companyName && row.contactName ? (
                            <div className="text-muted text-sm">{row.contactName}</div>
                          ) : null}
                        </td>
                        <td>{row.dealerCode || '—'}</td>
                        <td>
                          {[row.billingCity, row.billingState].filter(Boolean).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : snapshotReady && !loading ? (
        <p className="text-muted dealer-linking-empty panel glass" style={{ padding: '1rem' }}>
          No saved linking check yet. Run a check once to cache results for this tab.
        </p>
      ) : null}
    </div>
  );
}
