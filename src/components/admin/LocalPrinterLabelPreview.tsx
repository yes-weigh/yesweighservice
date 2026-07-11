import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_WIDTH_MM,
} from '../../constants/localPrinterSettings';
import { TEST_BIN_LABEL_SAMPLE, type BinLabelFields } from '../../lib/localPrinterLabel';
import { renderBinLabelCanvas } from '../../lib/localPrinterLabelBitmap';

type Props = {
  labelWidthMm: number;
  labelHeightMm: number;
  fields?: BinLabelFields;
};

/**
 * On-screen Genuine Spare label preview (canvas).
 * Use this to iterate layout without printing; Test print still sends TSPL to the TE210.
 */
export const LocalPrinterLabelPreview: React.FC<Props> = ({
  labelWidthMm,
  labelHeightMm,
  fields,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  const width = Number.isFinite(labelWidthMm) && labelWidthMm > 0
    ? labelWidthMm
    : DEFAULT_LABEL_WIDTH_MM;
  const height = Number.isFinite(labelHeightMm) && labelHeightMm > 0
    ? labelHeightMm
    : DEFAULT_LABEL_HEIGHT_MM;

  const labelFields: BinLabelFields = fields ?? {
    ...TEST_BIN_LABEL_SAMPLE,
    printedOn: new Date(),
  };

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError('');

    void (async () => {
      try {
        const rendered = await renderBinLabelCanvas(labelFields, {
          labelWidthMm: width,
          labelHeightMm: height,
        });
        if (cancelled) return;
        const target = canvasRef.current;
        if (!target) return;
        target.width = rendered.width;
        target.height = rendered.height;
        const ctx = target.getContext('2d');
        if (!ctx) throw new Error('Could not draw preview.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.drawImage(rendered, 0, 0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not render label preview.');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-render when size or field identity changes
  }, [
    width,
    height,
    labelFields.sku,
    labelFields.itemName,
    labelFields.masterSku,
    labelFields.masterProduct,
    labelFields.rack,
    labelFields.row,
    labelFields.bin,
    labelFields.qrPayload,
    labelFields.printedOn.getTime(),
  ]);

  return (
    <div className="settings-local-printer-preview">
      <div className="settings-local-printer-preview__head">
        <h4 className="settings-logistics__title">Label preview</h4>
        <p className="text-muted text-sm">
          Exact print preview ({width} × {height} mm @ 203 dpi). What you see here is what Test print sends to the TE210.
        </p>
      </div>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      <div
        className="settings-local-printer-preview__stage"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {rendering && (
          <div className="settings-local-printer-preview__loading">
            <div className="loader-ring" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="settings-local-printer-preview__canvas"
          aria-label="Label preview"
        />
      </div>
    </div>
  );
};
