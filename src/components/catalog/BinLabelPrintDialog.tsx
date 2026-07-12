import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { LocalPrinterLabelPreview } from '../admin/LocalPrinterLabelPreview';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import {
  BINDING_FIELD_LABELS,
  extractBindingKeys,
  getLabelLayoutTemplateXml,
  missingBindings,
} from '../../lib/labelLayouts';
import {
  emptyLabelStudioDoc,
  getStoreLabelPrinter,
  loadLabelStudioDoc,
  type LabelPrinter,
  type LabelStudioDoc,
} from '../../lib/labelStudio';
import { isNativePrintAvailable, sendBinLabel } from '../../lib/localPrinterPrint';
import type { CatalogProduct } from '../../types/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';
import { encodePackedDateBatch } from '../../lib/labelLayouts/batchCode';
import { loadMrpRules } from '../../lib/catalogProductSettings';
import {
  calculateProductMrpInclGst,
  formatProductMrpInclGst,
  resolveMrpGroupRule,
} from '../../lib/catalogMrp';

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

/**
 * MRP from Product settings formula + multiplier.
 * Legacy signature: (rate, tax, multiplier?) uses gstThenMultiply.
 */
export function calculateProductLabelMrp(
  rate: number,
  taxPercentage: number,
  multiplier = 2.5,
): number {
  return calculateProductMrpInclGst(rate, taxPercentage, {
    formula: 'gstThenMultiply',
    multiplier,
  });
}

export function formatProductLabelMrp(
  rate: number,
  taxPercentage: number,
  multiplier = 2.5,
): string {
  return formatProductMrpInclGst(calculateProductLabelMrp(rate, taxPercentage, multiplier));
}

/** Fields for Genuine Spare Product layout from a catalog product. */
export async function productPackLabelFieldsFromCatalog(
  product: Pick<
    CatalogProduct,
    | 'id'
    | 'name'
    | 'sku'
    | 'rate'
    | 'taxPercentage'
    | 'unit'
    | 'categoryId'
    | 'categoryName'
    | 'mrpOverride'
  >,
  packedByName?: string | null,
): Promise<BinLabelFields> {
  const sku = (product.sku ?? '').trim() || product.id;
  const unit = (product.unit ?? 'pcs').trim() || 'pcs';
  const packedOn = new Date();
  const packedBy = ((packedByName ?? '').trim() || 'YESWEIGH').toUpperCase();
  const rules = await loadMrpRules();
  const override = Number(product.mrpOverride);
  let mrp: number;
  if (Number.isFinite(override) && override > 0) {
    mrp = Math.round(override * 100) / 100;
  } else {
    const groupRule = resolveMrpGroupRule(product, rules);
    mrp = calculateProductMrpInclGst(product.rate, product.taxPercentage, groupRule);
  }
  return {
    sku,
    itemName: product.name.trim(),
    masterSku: '',
    masterProduct: '',
    rack: '',
    row: '',
    bin: '',
    qrPayload: sku,
    printedOn: packedOn,
    qty: /nos/i.test(unit) || /pc/i.test(unit) ? '1 nos' : `1 ${unit}`,
    mrp: formatProductMrpInclGst(mrp),
    batchNo: encodePackedDateBatch(packedOn),
    packedBy,
    qcStatus: 'PASSED',
  };
}

type Props = {
  fields: BinLabelFields;
  /** Built-in layout id — fixed by print location (not user-selectable). */
  layoutId: string;
  onClose: () => void;
};

/**
 * Preview + print with a fixed layout. User only picks printer when more than one exists.
 */
export const BinLabelPrintDialog: React.FC<Props> = ({ fields, layoutId, onClose }) => {
  const [studio, setStudio] = useState<LabelStudioDoc>(emptyLabelStudioDoc);
  const [printerId, setPrinterId] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [fieldDraft, setFieldDraft] = useState<BinLabelFields>(() => ({
    ...fields,
    printedOn: new Date(),
  }));
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const native = isNativePrintAvailable();

  const layoutXml = useMemo(() => getLabelLayoutTemplateXml(layoutId), [layoutId]);

  useEffect(() => {
    let active = true;
    setLoadingSettings(true);
    void loadLabelStudioDoc()
      .then(loaded => {
        if (!active) return;
        setStudio(loaded);
        setPrinterId(getStoreLabelPrinter(loaded).id);
      })
      .catch(() => {
        if (active) {
          const fallback = emptyLabelStudioDoc();
          setStudio(fallback);
          setPrinterId(fallback.storeLabelPrinterId);
        }
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

  const printer: LabelPrinter | null = useMemo(() => {
    return studio.printers.find(p => p.id === printerId) ?? getStoreLabelPrinter(studio);
  }, [studio, printerId]);

  const requiredKeys = useMemo(() => extractBindingKeys(layoutXml), [layoutXml]);
  const missing = useMemo(
    () => missingBindings(requiredKeys, fieldDraft),
    [requiredKeys, fieldDraft],
  );
  const canPrint = Boolean(printer) && missing.length === 0;

  const handlePrint = async () => {
    setPrinting(true);
    setError('');
    setSuccess('');
    try {
      if (!printer) throw new Error('No printer configured.');
      if (missing.length) {
        throw new Error(`Fill missing fields: ${missing.map(k => BINDING_FIELD_LABELS[k] ?? k).join(', ')}`);
      }
      if (!printer.host.trim()) {
        throw new Error('Set the printer IP in Admin → Settings → Label printing.');
      }
      const result = await sendBinLabel({
        host: printer.host.trim(),
        port: printer.port,
        layoutXml,
        fields: { ...fieldDraft, printedOn: new Date() },
      });
      setSuccess(
        `Sent via ${printer.name} to ${printer.host.trim()}:${printer.port} (${result.bytesSent} bytes).`,
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
            <h2 id="bin-label-print-title">Print label</h2>
            <p className="text-muted text-sm">
              {fields.sku}
              {fields.rack ? ` · Rack ${fields.rack} / Row ${fields.row} / Bin ${fields.bin}` : ''}
              {printer ? ` · ${printer.name}` : ''}
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
          <>
            {studio.printers.length > 1 && (
              <label className="settings-locations__field">
                <span>Printer</span>
                <select
                  value={printer?.id ?? ''}
                  onChange={e => setPrinterId(e.target.value)}
                >
                  {studio.printers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.host || 'no IP'})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {missing.length > 0 && (
              <div className="bin-label-print-dialog__missing">
                <h3 className="settings-logistics__title">Fill missing fields</h3>
                <div className="settings-local-printer__fields-grid">
                  {missing.map(key => {
                    if (key === 'printedOn' || key === 'packedOn') return null;
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

            <LocalPrinterLabelPreview
              layoutXml={layoutXml}
              fields={fieldDraft}
              hideHead
            />

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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePrint()}
            disabled={printing || loadingSettings || !canPrint}
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
