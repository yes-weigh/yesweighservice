import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Printer, X } from 'lucide-react';
import { LocalPrinterLabelPreview } from '../admin/LocalPrinterLabelPreview';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import {
  BINDING_FIELD_LABELS,
  extractBindingKeys,
  missingBindings,
  parseLayoutMedia,
} from '../../lib/labelLayouts';
import {
  emptyLabelStudioDoc,
  loadLabelStudioDoc,
  resolvePrintLabel,
  type LabelStudioDoc,
  type PrintLabel,
} from '../../lib/labelStudio';
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

type Step = 'pick' | 'review';

/**
 * Pick a Label (printer + layout), fill missing bindings, preview, print.
 */
export const BinLabelPrintDialog: React.FC<Props> = ({ fields, onClose }) => {
  const [studio, setStudio] = useState<LabelStudioDoc>(emptyLabelStudioDoc);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [step, setStep] = useState<Step>('pick');
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<BinLabelFields>(() => ({
    ...fields,
    printedOn: new Date(),
  }));
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const native = isNativePrintAvailable();

  useEffect(() => {
    let active = true;
    setLoadingSettings(true);
    void loadLabelStudioDoc()
      .then(loaded => {
        if (!active) return;
        setStudio(loaded);
        if (loaded.labels.length === 1) {
          setSelectedLabelId(loaded.labels[0].id);
          setStep('review');
        }
      })
      .catch(() => {
        if (active) setStudio(emptyLabelStudioDoc());
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setFieldDraft({ ...fields, printedOn: new Date() });
  }, [fields]);

  const resolved = useMemo(
    () => (selectedLabelId ? resolvePrintLabel(studio, selectedLabelId) : null),
    [studio, selectedLabelId],
  );

  const requiredKeys = useMemo(
    () => (resolved ? extractBindingKeys(resolved.layout.xml) : []),
    [resolved],
  );

  const missing = useMemo(
    () => missingBindings(requiredKeys, fieldDraft),
    [requiredKeys, fieldDraft],
  );

  const canPrint = Boolean(resolved) && missing.length === 0;

  const printerSummary = (label: PrintLabel) => {
    const printer = studio.printers.find(p => p.id === label.printerId);
    const layout = studio.layouts.find(l => l.id === label.layoutId);
    const media = layout ? parseLayoutMedia(layout.xml) : null;
    return [
      printer?.name ?? 'Unknown printer',
      layout?.name ?? 'Unknown layout',
      media ? `${media.labelWidthMm}×${media.labelHeightMm} mm` : null,
    ].filter(Boolean).join(' · ');
  };

  const selectLabel = (id: string) => {
    setSelectedLabelId(id);
    setError('');
    setSuccess('');
    setStep('review');
  };

  const handlePrint = async () => {
    setPrinting(true);
    setError('');
    setSuccess('');
    try {
      if (!resolved) throw new Error('Select a label first.');
      if (missing.length) {
        throw new Error(`Fill missing fields: ${missing.map(k => BINDING_FIELD_LABELS[k] ?? k).join(', ')}`);
      }
      if (!resolved.printer.host.trim()) {
        throw new Error(
          'Set the printer IP in Admin → Settings → Label printing.',
        );
      }
      const result = await sendBinLabel({
        host: resolved.printer.host.trim(),
        port: resolved.printer.port,
        layoutXml: resolved.layout.xml,
        fields: { ...fieldDraft, printedOn: new Date() },
      });
      setSuccess(
        `Sent via ${resolved.label.name} → ${resolved.printer.name} `
        + `(${resolved.printer.host.trim()}:${resolved.printer.port}, ${result.bytesSent} bytes).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  const updateField = (key: keyof BinLabelFields, value: string) => {
    setFieldDraft(prev => {
      const next = { ...prev, [key]: value } as BinLabelFields;
      if (key === 'sku' && (!prev.qrPayload.trim() || prev.qrPayload === prev.sku)) {
        next.qrPayload = value;
      }
      return next;
    });
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
            <h2 id="bin-label-print-title">
              {step === 'pick' ? 'Choose label' : 'Print bin label'}
            </h2>
            <p className="text-muted text-sm">
              {fields.sku}
              {' · '}
              Rack {fields.rack} / Row {fields.row} / Bin {fields.bin}
              {resolved ? ` · ${resolved.label.name}` : ''}
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
        ) : step === 'pick' ? (
          <div className="bin-label-print-dialog__picker">
            {studio.labels.length === 0 ? (
              <p className="text-muted text-sm">
                No labels defined. Add one under Admin → Settings → Label printing.
              </p>
            ) : (
              <ul className="bin-label-print-dialog__label-list">
                {studio.labels.map(label => (
                  <li key={label.id}>
                    <button
                      type="button"
                      className="bin-label-print-dialog__label-card"
                      onClick={() => selectLabel(label.id)}
                    >
                      <strong>{label.name}</strong>
                      <span className="text-muted text-sm">{printerSummary(label)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            {studio.labels.length > 1 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm bin-label-print-dialog__back"
                onClick={() => {
                  setStep('pick');
                  setSuccess('');
                  setError('');
                }}
              >
                <ArrowLeft size={15} aria-hidden />
                Change label
              </button>
            )}

            {missing.length > 0 && (
              <div className="bin-label-print-dialog__missing">
                <h3 className="settings-logistics__title">Fill missing fields</h3>
                <p className="text-muted text-sm">
                  This layout needs values that are not on the product yet. Enter them for this print only.
                </p>
                <div className="settings-local-printer__fields-grid">
                  {missing.map(key => {
                    if (key === 'printedOn') return null;
                    const fieldKey = key as keyof BinLabelFields;
                    const value = typeof fieldDraft[fieldKey] === 'string'
                      ? (fieldDraft[fieldKey] as string)
                      : '';
                    return (
                      <label key={key} className="settings-locations__field">
                        <span>{BINDING_FIELD_LABELS[key] ?? key}</span>
                        <input
                          type="text"
                          value={value}
                          onChange={e => updateField(fieldKey, e.target.value)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {resolved && (
              <LocalPrinterLabelPreview
                layoutXml={resolved.layout.xml}
                fields={fieldDraft}
                hideHead
              />
            )}

            {!native && (
              <p className="text-muted text-sm bin-label-print-dialog__hint">
                Print requires the YesWeigh Android APK on the same Wi‑Fi as the label printer.
              </p>
            )}
          </>
        )}

        <div className="dealers-modal__actions bin-label-print-dialog__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={printing}>
            Close
          </button>
          {step === 'review' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handlePrint()}
              disabled={printing || loadingSettings || !canPrint}
              title={
                !canPrint
                  ? 'Fill missing fields first'
                  : native
                    ? 'Print this label'
                    : 'Requires Android APK on same Wi‑Fi'
              }
            >
              <Printer size={16} aria-hidden />
              {printing ? 'Printing…' : 'Print'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
