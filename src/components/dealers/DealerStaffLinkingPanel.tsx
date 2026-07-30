import { useState } from 'react';
import { Link2, Play, RefreshCw, UserPlus } from 'lucide-react';
import { FetchingLoader } from '../FetchingLoader';
import {
  analyzeDealerStaffLinking,
  backfillDealerAssignedStaff,
  dealerErrorMessage,
  type DealerStaffLinkingAnalysis,
} from '../../lib/dealers';

export function DealerStaffLinkingPanel() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [result, setResult] = useState<DealerStaffLinkingAnalysis | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const data = await analyzeDealerStaffLinking();
      setResult(data);
      setSuccess(
        `Checked ${data.summary.totalDealers.toLocaleString()} dealers · `
        + `${data.summary.alreadyAssignable} assignable · `
        + `${data.summary.needStaffLink} need staff link · `
        + `${data.summary.noUsableInvoice} no usable invoice`,
      );
    } catch (err) {
      setResult(null);
      setError(dealerErrorMessage(err));
    } finally {
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
      const data = await analyzeDealerStaffLinking();
      setResult(data);
    } catch (err) {
      setError(dealerErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const busy = loading || applying;

  return (
    <div className="dealer-linking-panel">
      <section className="panel glass dealer-linking-panel__hero">
        <div className="dealer-linking-panel__hero-copy">
          <h2>Dealer linking check</h2>
          <p className="text-muted text-sm">
            Resolve each unassigned dealer from their latest invoice salesperson
            (skipping {result?.ignoredSalespersons?.join(', ') || 'yescloud server, Cloud Charges, GATC SELF'}).
            Salespersons already linked to portal staff can be assigned immediately;
            others show as unlocks until you link staff.
          </p>
        </div>
        <div className="dealer-linking-panel__hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void runCheck()}
          >
            {loading ? <RefreshCw size={16} className="spin-icon" /> : <Play size={16} />}
            {loading ? 'Running check…' : 'Run dealer linking check'}
          </button>
          {result && result.summary.alreadyAssignable > 0 ? (
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

      {loading && !result ? <FetchingLoader label="Scanning dealers and invoices…" /> : null}

      {result ? (
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

          {result.alreadyAssignableBySalesperson.length > 0 ? (
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
                  Unassigned dealers whose last usable invoice salesperson has no portal staff link.
                </p>
              </div>
            </header>
            {result.unlocks.length === 0 ? (
              <p className="text-muted dealer-linking-empty">No unlocks — every usable last-invoice salesperson is already linked.</p>
            ) : (
              <div className="dealer-linking-table-wrap">
                <table className="dealers-table dealer-linking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Zoho salesperson</th>
                      <th className="dealer-linking-table__num">Linkable dealers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unlocks.map((row, index) => (
                      <tr key={row.zohoSalespersonId}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="dealer-linking-table__primary">
                            {row.zohoSalespersonName || row.zohoSalespersonId}
                          </div>
                          <div className="text-muted text-sm">{row.zohoSalespersonId}</div>
                        </td>
                        <td className="dealer-linking-table__num">{row.unassignedDealers}</td>
                      </tr>
                    ))}
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
                  {' '}{result.ignoredSalespersons.join(', ')}.
                </p>
              </div>
              <span className="dealer-linking-section__count">
                {result.noUsableInvoiceDealers.length.toLocaleString()}
              </span>
            </header>
            {result.noUsableInvoiceDealers.length === 0 ? (
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
      ) : null}
    </div>
  );
}
