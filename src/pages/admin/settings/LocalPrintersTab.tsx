import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ChevronDown, Plus, Printer, Save, Star, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  emptyLabelPrinter,
  emptyLabelStudioDoc,
  getStoreLabelPrinter,
  loadLabelStudioDoc,
  saveLabelStudioDoc,
  type LabelPrinter,
  type LabelStudioDoc,
} from '../../../lib/labelStudio';
import { isNativePrintAvailable, sendTestLabel } from '../../../lib/localPrinterPrint';
import { getLabelLayoutTemplateXml, DEFAULT_LABEL_LAYOUT_ID } from '../../../lib/labelLayouts';
import {
  loadTestLabelDraft,
  saveTestLabelDraft,
  toBinLabelFields,
  type BinLabelDraft,
} from '../../../lib/localPrinterLabel';
import { LocalPrinterLabelPreview } from '../../../components/admin/LocalPrinterLabelPreview';

type PrinterDraft = LabelPrinter & { portText: string };

function toPrinterDraft(printer: LabelPrinter): PrinterDraft {
  return { ...printer, portText: String(printer.port) };
}

function fromPrinterDraft(draft: PrinterDraft): LabelPrinter {
  return {
    id: draft.id,
    name: draft.name,
    host: draft.host,
    port: Number(draft.portText),
  };
}

export const LocalPrintersTab: React.FC = () => {
  const { user } = useAuth();
  const [printers, setPrinters] = useState<PrinterDraft[]>([]);
  const [storeLabelPrinterId, setStoreLabelPrinterId] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [expandedPrinterIds, setExpandedPrinterIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<BinLabelDraft>(() => loadTestLabelDraft());

  const native = isNativePrintAvailable();
  const platform = Capacitor.getPlatform();
  const previewFields = useMemo(() => toBinLabelFields(draft), [draft]);
  const binLayoutXml = getLabelLayoutTemplateXml(DEFAULT_LABEL_LAYOUT_ID);

  const updateDraft = <K extends keyof BinLabelDraft>(key: K, value: BinLabelDraft[K]) => {
    setDraft(prev => {
      const next: BinLabelDraft = { ...prev, [key]: value };
      if (key === 'sku' && (prev.qrPayload === prev.sku || !prev.qrPayload.trim())) {
        next.qrPayload = value as string;
      }
      saveTestLabelDraft(next);
      return next;
    });
  };

  const applyDoc = (docData: LabelStudioDoc) => {
    setPrinters(docData.printers.map(toPrinterDraft));
    setStoreLabelPrinterId(docData.storeLabelPrinterId);
    setSavedSnapshot(JSON.stringify({
      printers: docData.printers,
      storeLabelPrinterId: docData.storeLabelPrinterId,
    }));
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applyDoc(await loadLabelStudioDoc());
    } catch (err) {
      applyDoc(emptyLabelStudioDoc());
      setError(err instanceof Error ? err.message : 'Could not load printers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const currentPrinters = useMemo(() => printers.map(fromPrinterDraft), [printers]);

  const dirty = useMemo(() => {
    const snapshot = JSON.stringify({
      printers: currentPrinters,
      storeLabelPrinterId,
    });
    return snapshot !== savedSnapshot;
  }, [currentPrinters, storeLabelPrinterId, savedSnapshot]);

  const storeLabelPrinter = useMemo(() => {
    const match = currentPrinters.find(p => p.id === storeLabelPrinterId);
    return match ?? getStoreLabelPrinter(emptyLabelStudioDoc());
  }, [currentPrinters, storeLabelPrinterId]);

  const updatePrinter = (id: string, patch: Partial<PrinterDraft>) => {
    setPrinters(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  };

  const togglePrinterExpanded = (id: string) => {
    setExpandedPrinterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddPrinter = () => {
    const next = toPrinterDraft(emptyLabelPrinter({ name: `Label printer ${printers.length + 1}` }));
    setPrinters(prev => [...prev, next]);
    setExpandedPrinterIds(prev => new Set(prev).add(next.id));
  };

  const handleDeletePrinter = (id: string) => {
    if (printers.length <= 1) {
      setError('Keep at least one printer.');
      return;
    }
    const remaining = printers.filter(p => p.id !== id);
    setPrinters(remaining);
    setExpandedPrinterIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (storeLabelPrinterId === id) {
      setStoreLabelPrinterId(remaining[0]?.id ?? '');
    }
  };

  const handleSave = async () => {
    setBusyKey('save');
    setError('');
    setSuccess('');
    try {
      const saved = await saveLabelStudioDoc(
        {
          printers: currentPrinters,
          storeLabelPrinterId,
        },
        user?.uid ?? null,
      );
      applyDoc(saved);
      setSuccess('Printer settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleTestPrint = async () => {
    setBusyKey('test');
    setError('');
    setSuccess('');
    try {
      if (dirty) throw new Error('Save before running a test print.');
      if (!storeLabelPrinter.host.trim()) throw new Error('Set the store label printer IP.');
      const result = await sendTestLabel({
        host: storeLabelPrinter.host.trim(),
        port: storeLabelPrinter.port,
        layoutXml: binLayoutXml,
        fields: toBinLabelFields(draft),
      });
      saveTestLabelDraft(draft);
      setSuccess(
        `Bin label sent (${result.bytesSent} bytes) to ${storeLabelPrinter.host.trim()}:${storeLabelPrinter.port}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test print failed.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Label printing</h3>
          <p className="text-muted text-sm">
            Manage LAN printers. Bin labels (rack / row / bin) always use the Genuine Spare layout;
            product labels use Genuine Spare Product. Mark one printer as Store label for defaults.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}
      {success && <p className="settings-local-printer__success text-sm">{success}</p>}

      <div className="settings-local-printer">
        <div className={`settings-local-printer__badge ${native ? 'is-native' : 'is-web'}`}>
          <Printer size={16} aria-hidden />
          {native
            ? `Android APK ready · ${platform}`
            : 'Browser / PWA — preview & save here; open the APK on Wi‑Fi to test print'}
        </div>

        {loading ? (
          <div className="settings-locations__loading">
            <div className="loader-ring" />
          </div>
        ) : (
          <>
            <div className="settings-local-printer__list-toolbar">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busyKey != null}
                onClick={handleAddPrinter}
              >
                <Plus size={15} aria-hidden />
                Add printer
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!dirty || busyKey != null}
                onClick={() => void handleSave()}
              >
                <Save size={15} aria-hidden />
                {busyKey === 'save' ? 'Saving…' : 'Save all'}
              </button>
            </div>

            <div className="settings-local-printer__list">
              {printers.map(printer => {
                const expanded = expandedPrinterIds.has(printer.id);
                const isStoreLabel = printer.id === storeLabelPrinterId;
                return (
                  <div
                    key={printer.id}
                    className={`settings-logistics__default panel glass settings-local-printer__config${
                      isStoreLabel ? ' settings-local-printer__config--store' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="settings-local-printer__config-toggle"
                      aria-expanded={expanded}
                      onClick={() => togglePrinterExpanded(printer.id)}
                    >
                      <div className="settings-local-printer__config-toggle-text">
                        <div className="settings-local-printer__config-title-row">
                          <h4 className="settings-logistics__title">
                            {printer.name.trim() || 'Label printer'}
                          </h4>
                          {isStoreLabel && (
                            <span className="settings-local-printer__role-badge">Store label</span>
                          )}
                        </div>
                        {!expanded && (
                          <p className="text-muted text-sm settings-local-printer__config-summary">
                            {[printer.host.trim() || 'no IP', `port ${printer.portText || '—'}`].join(' · ')}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        size={18}
                        aria-hidden
                        className={`settings-local-printer__chevron${expanded ? ' is-open' : ''}`}
                      />
                    </button>
                    {expanded && (
                      <div className="settings-local-printer__config-body">
                        <label className="settings-locations__field">
                          <span>Name</span>
                          <input
                            type="text"
                            value={printer.name}
                            disabled={busyKey === 'save'}
                            onChange={e => updatePrinter(printer.id, { name: e.target.value })}
                          />
                        </label>
                        <label className="settings-locations__field">
                          <span>IP address</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            value={printer.host}
                            disabled={busyKey === 'save'}
                            onChange={e => updatePrinter(printer.id, { host: e.target.value })}
                            placeholder="192.168.1.39"
                          />
                        </label>
                        <label className="settings-locations__field">
                          <span>Port</span>
                          <input
                            type="number"
                            min={1}
                            max={65535}
                            value={printer.portText}
                            disabled={busyKey === 'save'}
                            onChange={e => updatePrinter(printer.id, { portText: e.target.value })}
                          />
                        </label>
                        <div className="settings-local-printer__card-actions">
                          {!isStoreLabel && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busyKey != null}
                              onClick={() => setStoreLabelPrinterId(printer.id)}
                            >
                              <Star size={15} aria-hidden />
                              Set as store label
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyKey != null || printers.length <= 1}
                            onClick={() => handleDeletePrinter(printer.id)}
                          >
                            <Trash2 size={15} aria-hidden />
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="settings-logistics__default panel glass">
              <div className="settings-local-printer__preview-head">
                <div>
                  <h4 className="settings-logistics__title">Store bin label preview</h4>
                  <p className="text-muted text-sm">
                    Genuine Spare layout · {storeLabelPrinter.name}
                    {' '}({storeLabelPrinter.host || 'no IP'})
                  </p>
                </div>
                <div className="settings-local-printer__preview-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busyKey != null || dirty}
                    onClick={() => void handleTestPrint()}
                  >
                    <Printer size={15} aria-hidden />
                    {busyKey === 'test' ? 'Printing…' : 'Test print'}
                  </button>
                </div>
              </div>

              <LocalPrinterLabelPreview layoutXml={binLayoutXml} fields={previewFields} />

              <div className="settings-local-printer__fields">
                <h4 className="settings-logistics__title">Test values</h4>
                <div className="settings-local-printer__fields-grid">
                  <label className="settings-locations__field">
                    <span>SKU</span>
                    <input type="text" value={draft.sku} onChange={e => updateDraft('sku', e.target.value)} />
                  </label>
                  <label className="settings-locations__field settings-local-printer__field--wide">
                    <span>Item name</span>
                    <input type="text" value={draft.itemName} onChange={e => updateDraft('itemName', e.target.value)} />
                  </label>
                  <label className="settings-locations__field">
                    <span>Master SKU</span>
                    <input type="text" value={draft.masterSku} onChange={e => updateDraft('masterSku', e.target.value)} />
                  </label>
                  <label className="settings-locations__field">
                    <span>Rack</span>
                    <input type="text" value={draft.rack} onChange={e => updateDraft('rack', e.target.value)} />
                  </label>
                  <label className="settings-locations__field">
                    <span>Row</span>
                    <input type="text" value={draft.row} onChange={e => updateDraft('row', e.target.value)} />
                  </label>
                  <label className="settings-locations__field">
                    <span>Bin</span>
                    <input type="text" value={draft.bin} onChange={e => updateDraft('bin', e.target.value)} />
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
