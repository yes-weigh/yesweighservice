import React, { useEffect, useRef, useState } from 'react';
import { TEST_BIN_LABEL_SAMPLE, type BinLabelFields } from '../../lib/localPrinterLabel';
import { renderBinLabelCanvas } from '../../lib/localPrinterLabelBitmap';
import { parseLayoutMedia } from '../../lib/labelLayouts';

type Props = {
  layoutXml: string;
  fields?: BinLabelFields;
  /** Hide the title/help block (e.g. inside a print dialog). */
  hideHead?: boolean;
};

/**
 * On-screen bin label preview (canvas).
 * Size comes from layout XML widthMm/heightMm.
 */
export const LocalPrinterLabelPreview: React.FC<Props> = ({
  layoutXml,
  fields,
  hideHead = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  const media = parseLayoutMedia(layoutXml);
  const width = media.labelWidthMm;
  const height = media.labelHeightMm;

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
        if (!layoutXml.trim()) {
          throw new Error('No layout XML to preview.');
        }
        const rendered = await renderBinLabelCanvas(labelFields, {
          layoutXml,
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
  }, [
    layoutXml,
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
    labelFields.qty,
    labelFields.mrp,
    labelFields.batchNo,
    labelFields.packedBy,
    labelFields.qcStatus,
    labelFields.modelNumber,
    labelFields.approvalNumber,
    labelFields.serialNumber,
    labelFields.printedOn.getTime(),
  ]);

  return (
    <div className="settings-local-printer-preview">
      {!hideHead && (
        <div className="settings-local-printer-preview__head">
          <h4 className="settings-logistics__title">Label preview</h4>
          <p className="text-muted text-sm">
            Exact print preview ({width} × {height} mm @ 203 dpi). What you see here is what Test print sends to the TE210.
          </p>
        </div>
      )}

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
