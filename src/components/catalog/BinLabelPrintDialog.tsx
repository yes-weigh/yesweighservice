import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { LocalPrinterLabelPreview } from '../admin/LocalPrinterLabelPreview';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import {
  emptyLocalPrinterSettings,
  loadLocalPrinterSettings,
  type LocalPrinterSettings,
} from '../../lib/localPrinterSettings';
import { isNativePrintAvailable, sendBinLabel } from '../../lib/localPrinterPrint';
import type { CatalogProduct } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';

export function binLabelFieldsFromStoreItem(
  product: Pick<CatalogProduct, 'id' | 'name' | 'sku'>,
  binItem: YesStoreItemDoc,
): BinLabelFields {
  const sku = (product.sku ?? '').trim() || product.id;
  return {
    sku,
    itemName: product.name.trim(),
    masterSku: '',
    masterProduct: '',
    rack: binItem.rackId.toUpperCase(),
    row: String(binItem.rowNumber),
    bin: String(binItem.binNumber),
    qrPayload: sku,
    printedOn: new Date(),
  };
}

type Props = {
  fields: BinLabelFields;
  onClose: () => void;
};

/**
 * Preview + print dialog for Genuine Spare bin labels (same bitmap as admin Local printers).
 */
export const BinLabelPrintDialog: React.FC<Props> = ({ fields, onClose }) => {
  const [settings, setSettings] = useState<LocalPrinterSettings>(emptyLocalPrinterSettings);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const native = isNativePrintAvailable();

  useEffect(() => {
    let active = true;
    setLoadingSettings(true);
    void loadLocalPrinterSettings()
      .then(loaded => {
        if (active) setSettings(loaded);
      })
      .catch(() => {
        if (active) setSettings(emptyLocalPrinterSettings());
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handlePrint = async () => {
    setPrinting(true);
    setError('');
    setSuccess('');
    try {
      if (!settings.host.trim()) {
        throw new Error(
          'Set the Store label printer IP in Admin → Settings → Local printers.',
        );
      }
      const result = await sendBinLabel({
        host: settings.host.trim(),
        port: settings.port,
        labelWidthMm: settings.labelWidthMm,
        labelHeightMm: settings.labelHeightMm,
        labelGapMm: settings.labelGapMm,
        fields: { ...fields, printedOn: new Date() },
      });
      setSuccess(
        `Sent via ${settings.name} to ${settings.host.trim()}:${settings.port} (${result.bytesSent} bytes).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  return createPortal(
    <div className="dealers-modal-backdrop bin-label-print-dialog__backdrop" onClick={onClose}>
      <div
        className="dealers-modal panel glass bin-label-print-dialog"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bin-label-print-title"
      >
        <div className="dealers-modal__header">
          <div>
            <h2 id="bin-label-print-title">Print bin label</h2>
            <p className="text-muted text-sm">
              {fields.sku}
              {' · '}
              Rack {fields.rack} / Row {fields.row} / Bin {fields.bin}
              {!loadingSettings && settings.name
                ? ` · ${settings.name}`
                : ''}
            </p>
          </div>
          <button type="button" className="dealers-modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <p className="dealers-modal__error">{error}</p>}
        {success && <p className="bin-label-print-dialog__success text-sm">{success}</p>}

        {loadingSettings ? (
          <div className="bin-label-print-dialog__loading">
            <div className="loader-ring" />
          </div>
        ) : (
          <LocalPrinterLabelPreview
            labelWidthMm={settings.labelWidthMm}
            labelHeightMm={settings.labelHeightMm}
            fields={fields}
            hideHead
          />
        )}

        {!native && (
          <p className="text-muted text-sm bin-label-print-dialog__hint">
            Print requires the YesWeigh Android APK on the same Wi‑Fi as the label printer.
          </p>
        )}

        <div className="dealers-modal__actions bin-label-print-dialog__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={printing}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePrint()}
            disabled={printing || loadingSettings}
            title={native ? 'Print this label' : 'Requires Android APK on same Wi‑Fi'}
          >
            <Printer size={16} aria-hidden />
            {printing ? 'Printing…' : 'Print'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
