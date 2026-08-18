import React, { useEffect } from 'react';
import { SalesOrderStageSeal } from './SalesOrderStageSeal';

const HOLD_MS = 2800;

/** Full-screen rubber-stamp overlay after Verify & invoice succeeds. */
export const InvoicedStampOverlay: React.FC<{
  onDone: () => void;
}> = ({ onDone }) => {
  useEffect(() => {
    const id = window.setTimeout(onDone, HOLD_MS);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div
      className="so-invoiced-overlay"
      role="status"
      aria-live="polite"
      aria-label="Invoiced"
      onClick={onDone}
    >
      <div className="so-invoiced-overlay__stamp">
        <SalesOrderStageSeal kind="invoiced" className="so-invoiced-overlay__seal" />
      </div>
    </div>
  );
};
