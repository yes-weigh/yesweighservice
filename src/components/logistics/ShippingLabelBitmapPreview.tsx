import React, { useEffect, useRef, useState } from 'react';
import {
  LOGISTICS_LABEL_HEIGHT_MM,
  LOGISTICS_LABEL_WIDTH_MM,
} from '../../constants/localPrinterSettings';
import { renderShippingLabelCanvas } from '../../lib/shippingLabelBitmap';
import type { ShippingLabelViewModel } from '../../lib/shippingLabel';

type Props = {
  label: ShippingLabelViewModel;
  className?: string;
};

function labelPreviewKey(label: ShippingLabelViewModel): string {
  return [
    label.consignmentNo,
    label.boxIndex,
    label.boxTotal,
    label.numberOfBoxes,
    label.shipmentMode,
    label.fromName,
    label.fromAddress,
    label.toName,
    label.toAddress,
    label.toPhone,
    label.boxDimensions,
    label.contents,
    label.grossWeightKg,
    label.chargeableWeightKg,
    label.transportMode,
    label.paymentMode,
    label.partnerId,
    label.partnerLabel,
    label.partnerImage ?? '',
    label.bookingTime,
    label.bookedBy,
    label.firmName,
  ].join('\u0001');
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as React.MutableRefObject<T | null>).current = value;
}

/**
 * Exact 203 DPI thermal bitmap preview — same pixels sent to the logistics printer.
 */
export const ShippingLabelBitmapPreview = React.forwardRef<HTMLCanvasElement, Props>(
  function ShippingLabelBitmapPreview({ label, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState('');
    const [rendering, setRendering] = useState(true);
    const key = labelPreviewKey(label);

    useEffect(() => {
      let cancelled = false;
      setRendering(true);
      setError('');

      void (async () => {
        try {
          const rendered = await renderShippingLabelCanvas(label);
          if (cancelled) return;
          const target = canvasRef.current;
          if (!target) return;
          target.width = rendered.width;
          target.height = rendered.height;
          const ctx = target.getContext('2d');
          if (!ctx) throw new Error('Could not draw shipping label preview.');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, target.width, target.height);
          ctx.drawImage(rendered, 0, 0);
          assignRef(ref, target);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Could not render label preview.');
            assignRef(ref, null);
          }
        } finally {
          if (!cancelled) setRendering(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [key, label, ref]);

    return (
      <div
        className={['shipping-label-bitmap-preview', className].filter(Boolean).join(' ')}
        style={{
          width: `${LOGISTICS_LABEL_WIDTH_MM}mm`,
          maxWidth: '100%',
          aspectRatio: `${LOGISTICS_LABEL_WIDTH_MM} / ${LOGISTICS_LABEL_HEIGHT_MM}`,
        }}
      >
        {rendering && (
          <div className="shipping-label-bitmap-preview__loading" aria-hidden>
            <div className="loader-ring" />
          </div>
        )}
        {error ? (
          <p className="shipping-label-bitmap-preview__error text-sm">{error}</p>
        ) : (
          <canvas
            ref={node => {
              canvasRef.current = node;
              assignRef(ref, node);
            }}
            className="shipping-label-bitmap-preview__canvas"
            aria-label={`Shipping label ${label.consignmentNo} box ${label.boxIndex}`}
          />
        )}
      </div>
    );
  },
);
