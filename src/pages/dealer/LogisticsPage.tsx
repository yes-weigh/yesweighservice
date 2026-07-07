import React, { useCallback, useMemo, useState } from 'react';
import { Package, Plus, Truck } from 'lucide-react';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { AddCourierPartnerDialog } from '../../components/logistics/AddCourierPartnerDialog';
import { CourierDispatchDetail } from '../../components/logistics/CourierDispatchDetail';
import { courierPartnerLabel } from '../../constants/courierPartners';
import { createCourierDispatch } from '../../lib/logisticsDispatch';
import type { CourierDispatch, CourierPartnerFormDraft } from '../../types/logistics-dispatch';

export const LogisticsPage: React.FC = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dispatches, setDispatches] = useState<CourierDispatch[]>([]);
  const [activeDispatchId, setActiveDispatchId] = useState<string | null>(null);

  const activeDispatch = useMemo(
    () => dispatches.find(item => item.id === activeDispatchId) ?? null,
    [dispatches, activeDispatchId],
  );

  const openDialog = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleContinue = useCallback((draft: CourierPartnerFormDraft) => {
    const created = createCourierDispatch(draft);
    if (!created) return;
    setDispatches(prev => [created, ...prev]);
    setActiveDispatchId(created.id);
    setDialogOpen(false);
  }, []);

  const handleUpdateDispatch = useCallback((next: CourierDispatch) => {
    setDispatches(prev => prev.map(item => (item.id === next.id ? next : item)));
  }, []);

  const handleMarkDispatched = useCallback(() => {
    if (!activeDispatch) return;
    const next: CourierDispatch = {
      ...activeDispatch,
      status: 'dispatched',
      dispatchedAt: new Date().toISOString(),
      podFileName: activeDispatch.podFileName ?? 'dispatch-proof.pdf',
    };
    handleUpdateDispatch(next);
  }, [activeDispatch, handleUpdateDispatch]);

  const topBarAction = useMemo(
    () => (
      <button
        type="button"
        className="cart-header-btn cart-header-btn--primary"
        onClick={openDialog}
        aria-label="Add logistic partner"
        title="Add logistic partner"
      >
        <Plus size={22} />
      </button>
    ),
    [openDialog],
  );

  useTopBarAction(topBarAction, !dialogOpen);

  return (
    <div className="page-content fade-in logistics-page">
      {activeDispatch ? (
        <CourierDispatchDetail
          dispatch={activeDispatch}
          onUpdate={handleUpdateDispatch}
          onMarkDispatched={handleMarkDispatched}
        />
      ) : dispatches.length === 0 ? (
        <div className="logistics-page__empty panel glass">
          <Truck size={40} aria-hidden />
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            Bridge packing completed orders to courier assignment, pickup, and final dispatch.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openDialog}>
            Add Logistic Partner
          </button>
        </div>
      ) : (
        <section className="logistics-page__list panel glass" aria-label="Courier dispatches">
          <h3 className="logistics-page__list-title">Courier dispatches</h3>
          <ul className="logistics-page__entries">
            {dispatches.map(dispatch => (
              <li key={dispatch.id}>
                <button
                  type="button"
                  className="logistics-page__entry logistics-page__entry--button"
                  onClick={() => setActiveDispatchId(dispatch.id)}
                >
                  <span className="logistics-page__entry-icon" aria-hidden>
                    <Package size={18} />
                  </span>
                  <div className="logistics-page__entry-copy">
                    <strong>{courierPartnerLabel(dispatch.courierPartnerId)}</strong>
                    <span className="text-muted text-sm">
                      {dispatch.orderRef} · {dispatch.trackingNumber}
                    </span>
                    <span className={`logistics-page__entry-status logistics-page__entry-status--${dispatch.status}`}>
                      {dispatch.status === 'dispatched' ? 'Dispatched' : 'In progress'}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeDispatch && dispatches.length > 1 && (
        <button
          type="button"
          className="btn btn-secondary btn-sm logistics-page__back-list"
          onClick={() => setActiveDispatchId(null)}
        >
          View all dispatches
        </button>
      )}

      {dialogOpen && (
        <AddCourierPartnerDialog onClose={closeDialog} onContinue={handleContinue} />
      )}
    </div>
  );
};
