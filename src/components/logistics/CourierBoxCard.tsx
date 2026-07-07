import React, { useRef } from 'react';
import { Camera, ExternalLink, Printer, Truck } from 'lucide-react';
import { boxStatusLabel, trackingUrl } from '../../lib/logisticsDispatch';
import type { CourierDispatch, CourierDispatchBox, CourierPartnerId } from '../../types/logistics-dispatch';

interface CourierBoxCardProps {
  box: CourierDispatchBox;
  partnerId: CourierPartnerId;
  disabled?: boolean;
  onPrintLabel: (boxId: string) => void;
  onUploadPhoto: (boxId: string, fileName: string) => void;
  onMarkPickedUp: (boxId: string) => void;
}

export const CourierBoxCard: React.FC<CourierBoxCardProps> = ({
  box,
  partnerId,
  disabled = false,
  onPrintLabel,
  onUploadPhoto,
  onMarkPickedUp,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const trackUrl = trackingUrl(partnerId, box.trackingNumber);

  return (
    <article className="courier-box-card panel glass">
      <div className="courier-box-card__head">
        <div>
          <h4>Box {box.boxNumber} / {box.totalBoxes}</h4>
          <p className="text-muted text-sm">Product count: {box.productCount}</p>
        </div>
        <span className={`courier-box-card__status courier-box-card__status--${box.status}`}>
          {boxStatusLabel(box.status)}
        </span>
      </div>

      <dl className="courier-box-card__meta">
        <div>
          <dt>Weight</dt>
          <dd>{box.weightKg} kg</dd>
        </div>
        <div>
          <dt>Tracking</dt>
          <dd>{box.trackingNumber}</dd>
        </div>
      </dl>

      <div className="courier-box-card__actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || box.labelGenerated}
          onClick={() => onPrintLabel(box.id)}
        >
          <Printer size={14} aria-hidden />
          Print Label
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <Camera size={14} aria-hidden />
          {box.photoFileName ? 'Photo Added' : 'Upload Photo'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="courier-box-card__file"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) onUploadPhoto(box.id, file.name);
            event.target.value = '';
          }}
        />
        {trackUrl ? (
          <a
            href={trackUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            <ExternalLink size={14} aria-hidden />
            View Tracking
          </a>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" disabled>
            <ExternalLink size={14} aria-hidden />
            View Tracking
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || !box.labelGenerated || box.status === 'picked_up'}
          onClick={() => onMarkPickedUp(box.id)}
        >
          <Truck size={14} aria-hidden />
          Mark Picked Up
        </button>
      </div>
    </article>
  );
};

interface CourierBoxListProps {
  dispatch: CourierDispatch;
  disabled?: boolean;
  onUpdate: (dispatch: CourierDispatch) => void;
}

export function updateDispatchBoxes(
  dispatch: CourierDispatch,
  updater: (boxes: CourierDispatchBox[]) => CourierDispatchBox[],
): CourierDispatch {
  return { ...dispatch, boxes: updater(dispatch.boxes) };
}

export const CourierBoxList: React.FC<CourierBoxListProps> = ({
  dispatch,
  disabled = false,
  onUpdate,
}) => (
  <section className="courier-box-list" aria-label="Courier boxes">
    <h3 className="courier-box-list__title">Box-Level Courier View</h3>
    {dispatch.boxes.map(box => (
      <CourierBoxCard
        key={box.id}
        box={box}
        partnerId={dispatch.courierPartnerId}
        disabled={disabled}
        onPrintLabel={boxId => {
          onUpdate(updateDispatchBoxes(dispatch, boxes => boxes.map(item => (
            item.id === boxId
              ? { ...item, labelGenerated: true, status: 'label_printed' }
              : item
          ))));
        }}
        onUploadPhoto={(boxId, fileName) => {
          onUpdate(updateDispatchBoxes(dispatch, boxes => boxes.map(item => (
            item.id === boxId ? { ...item, photoFileName: fileName } : item
          ))));
        }}
        onMarkPickedUp={boxId => {
          onUpdate(updateDispatchBoxes(dispatch, boxes => boxes.map(item => (
            item.id === boxId ? { ...item, status: 'picked_up' } : item
          ))));
        }}
      />
    ))}
  </section>
);
