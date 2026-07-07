import React, { useRef } from 'react';
import { CheckCircle2, Package, Upload } from 'lucide-react';
import { courierPartnerLabel } from '../../constants/courierPartners';
import {
  allBoxPhotosUploaded,
  allBoxesLabeled,
  canMarkDispatched,
} from '../../lib/logisticsDispatch';
import type { CourierDispatch } from '../../types/logistics-dispatch';
import { CourierBoxList } from './CourierBoxCard';
import { CourierDispatchPhases } from './CourierDispatchPhases';

interface CourierDispatchDetailProps {
  dispatch: CourierDispatch;
  onUpdate: (dispatch: CourierDispatch) => void;
  onMarkDispatched: () => void;
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={`courier-requirements__item${met ? ' is-met' : ''}`}>
      <CheckCircle2 size={15} aria-hidden />
      <span>{label}</span>
    </li>
  );
}

export const CourierDispatchDetail: React.FC<CourierDispatchDetailProps> = ({
  dispatch,
  onUpdate,
  onMarkDispatched,
}) => {
  const pickupRef = useRef<HTMLInputElement>(null);
  const dispatched = dispatch.status === 'dispatched';
  const readyToDispatch = canMarkDispatched(dispatch);

  return (
    <div className="courier-dispatch-detail">
      <section className="courier-dispatch-summary panel glass">
        <div className="courier-dispatch-summary__head">
          <div>
            <span className="courier-dispatch-summary__eyebrow">Order {dispatch.orderRef}</span>
            <h3>{courierPartnerLabel(dispatch.courierPartnerId)}</h3>
          </div>
          <span className={`courier-dispatch-summary__badge courier-dispatch-summary__badge--${dispatch.status}`}>
            {dispatched ? 'Dispatched' : 'Packing Completed'}
          </span>
        </div>

        <dl className="courier-dispatch-summary__grid">
          <div>
            <dt>Tracking / LR</dt>
            <dd>{dispatch.trackingNumber}</dd>
          </div>
          <div>
            <dt>Freight</dt>
            <dd>{dispatch.freightCharge != null ? `₹ ${dispatch.freightCharge.toLocaleString('en-IN')}` : '—'}</dd>
          </div>
          <div>
            <dt>Expected delivery</dt>
            <dd>{dispatch.expectedDeliveryDate || '—'}</dd>
          </div>
          <div>
            <dt>Boxes / Weight</dt>
            <dd>{dispatch.numberOfBoxes} boxes · {dispatch.totalWeightKg} kg</dd>
          </div>
        </dl>

        {dispatch.remarks && (
          <p className="courier-dispatch-summary__remarks">
            <strong>Remarks:</strong> {dispatch.remarks}
          </p>
        )}
      </section>

      <CourierDispatchPhases dispatch={dispatch} />

      <CourierBoxList dispatch={dispatch} disabled={dispatched} onUpdate={onUpdate} />

      <section className="courier-handover panel glass">
        <h3 className="courier-handover__title">Pickup Receipt</h3>
        <p className="text-muted text-sm">
          Upload courier pickup receipt after all box photos are added.
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={dispatched}
          onClick={() => pickupRef.current?.click()}
        >
          <Upload size={14} aria-hidden />
          {dispatch.pickupReceiptFileName ?? 'Upload Pickup Receipt'}
        </button>
        <input
          ref={pickupRef}
          type="file"
          accept="image/*,.pdf"
          className="courier-box-card__file"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) {
              onUpdate({ ...dispatch, pickupReceiptFileName: file.name });
            }
            event.target.value = '';
          }}
        />
      </section>

      <section className="courier-requirements panel glass">
        <h3 className="courier-requirements__title">Dispatch Checklist</h3>
        <ul className="courier-requirements__list">
          <RequirementRow met={Boolean(dispatch.courierPartnerId)} label="Logistic partner added" />
          <RequirementRow met={Boolean(dispatch.trackingNumber.trim())} label="Tracking / LR number added" />
          <RequirementRow met={allBoxesLabeled(dispatch)} label="Shipping label generated for every box" />
          <RequirementRow met={allBoxPhotosUploaded(dispatch)} label="Box photos uploaded" />
          <RequirementRow met={Boolean(dispatch.pickupReceiptFileName)} label="Pickup receipt uploaded" />
        </ul>

        <button
          type="button"
          className="btn btn-primary courier-requirements__dispatch-btn"
          disabled={!readyToDispatch || dispatched}
          onClick={onMarkDispatched}
        >
          <Package size={16} aria-hidden />
          {dispatched ? 'Dispatched' : 'Mark as Dispatched'}
        </button>
      </section>
    </div>
  );
};
