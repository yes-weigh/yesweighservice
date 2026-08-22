import React from 'react';
import { Check, Package, X } from 'lucide-react';
import type { DealerStaffOrderApproval } from '../../types/dealer-staff-orders';

export const DealerStaffApprovalQueue: React.FC<{
  approvals: DealerStaffOrderApproval[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}> = ({ approvals, busyId, onApprove, onReject }) => {
  if (approvals.length === 0) return null;

  return (
    <section className="orders-page__pending" aria-label="Team orders awaiting approval">
      <h3 className="orders-page__section-title">Awaiting your approval</h3>
      <ul className="orders-page__pending-list">
        {approvals.map(row => {
          const qty = row.displayLines.reduce((sum, line) => sum + (line.quantity || 0), 0);
          const busy = busyId === row.id;
          return (
            <li key={row.id} className="orders-page__pending-card panel glass">
              <div className="orders-page__pending-head">
                <div>
                  <p className="orders-page__pending-name">{row.submittedByName}</p>
                  <p className="orders-page__pending-meta">
                    <span className={`dealer-team__badge dealer-team__badge--${row.submittedByTeam}`}>
                      {row.submittedByTeam === 'service' ? 'Service' : 'Sales'}
                    </span>
                    <span>
                      {qty} {qty === 1 ? 'item' : 'items'}
                      {row.kind === 'service' ? ' · Spare order' : ''}
                    </span>
                  </p>
                </div>
                <div className="orders-page__pending-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onReject(row.id)}
                  >
                    <X size={14} />
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => onApprove(row.id)}
                  >
                    <Check size={14} />
                    {busy ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              </div>
              <ul className="orders-page__pending-lines">
                {row.displayLines.map(line => (
                  <li key={line.cartLineId || `${line.productId}-${line.quantity}`}>
                    <Package size={14} aria-hidden />
                    <span>
                      {line.name}
                      {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
