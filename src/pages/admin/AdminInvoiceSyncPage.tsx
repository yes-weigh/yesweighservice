import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Tags } from 'lucide-react';
import { InvoiceCsvUpsertPanel } from '../../components/admin/InvoiceCsvUpsertPanel';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { reclassifyInvoiceCategoriesFromCatalog } from '../../lib/org-invoice-sync';

/**
 * Invoice import tools — CSV upsert + Firestore-only category reclassify.
 * Org Zoho list/pull backfill was removed; realtime updates use the invoice webhook.
 */
export const AdminInvoiceSyncPage: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const actionFeedbackRef = useRef<HTMLDivElement | null>(null);

  useCatalogPageHeader({ title: 'Invoice import' }, true);

  const showActionFeedback = useCallback((nextNotice: string, nextError = '') => {
    setNotice(nextNotice);
    setError(nextError);
    window.requestAnimationFrame(() => {
      actionFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const handleCategoryBackfill = async () => {
    setBusy(true);
    showActionFeedback('Classifying invoices from catalog…');
    try {
      const result = await reclassifyInvoiceCategoriesFromCatalog();
      showActionFeedback(
        `Classified ${result.updated.toLocaleString()} of ${result.scanned.toLocaleString()} invoice(s)`
        + (result.unchanged != null ? ` (${result.unchanged.toLocaleString()} unchanged)` : '')
        + '.',
      );
    } catch (err) {
      showActionFeedback('', err instanceof Error ? err.message : 'Classify failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-content fade-in">
      <div className="mb-6">
        <Link to="/super-admin/invoices" className="text-muted text-sm">
          ← Invoices
        </Link>
        <h1 className="mt-2">Invoice import</h1>
        <p className="text-muted mt-2">
          Backfill or patch invoices from a Zoho CSV export (no API quota). New and changed invoices
          arrive via the Zoho webhook, with a nightly org sync at 2:00 AM IST as a safety net.
        </p>
      </div>

      <InvoiceCsvUpsertPanel />

      <div className="panel glass">
        <h2 className="mb-4">Classify from catalog</h2>
        <p className="text-muted mb-4">
          Sets each invoice category from its highest-value line item’s product id → catalog
          HSN/category. Firestore only — no Zoho API calls.
        </p>
        <div ref={actionFeedbackRef}>
          {error && (
            <div className="products-inline-error panel glass mb-4" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="panel glass mb-4" role="status">
              <span>{notice}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => { void handleCategoryBackfill(); }}
        >
          <Tags size={16} />
          {busy ? 'Classifying…' : 'Classify from catalog'}
        </button>
      </div>
    </div>
  );
};
