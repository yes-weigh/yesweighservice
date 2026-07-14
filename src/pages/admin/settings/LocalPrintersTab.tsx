import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Printer, Save } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  HARDCODED_LABEL_PRINTERS,
  LOGISTICS_LABEL_PRINTER_ID,
  STORE_LABEL_PRINTER_ID,
  emptyLabelStudioDoc,
  formatLabelMediaSize,
  getHardcodedPrinterSlot,
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

export const LocalPrintersTab: React.FC = () => {
  const { user } = useAuth();
  const [printers, setPrinters] = useState<LabelPrinter[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<BinLabelDraft>(() => loadTestLabelDraft());

  const native = isNativePrintAvailable();
  const platform = Capacitor.getPlatform();
  const previewFields = useMemo(() => toBinLabelFields(draft), [draft]);
  const binLayoutXml = getLabelLayoutTemplateXml(DEFAULT_LABEL_LAYOUT_ID);
  const storeSlot = getHardcodedPrinterSlot(STORE_LABEL_PRINTER_ID);

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
    setPrinters(docData.printers);
    setSavedSnapshot(JSON.stringify(docData.printers.map(p => ({ id: p.id, host: p.host }))));
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

  const dirty = useMemo(() => {
    const snapshot = JSON.stringify(printers.map(p => ({ id: p.id, host: p.host })));
    return snapshot !== savedSnapshot;
  }, [printers, savedSnapshot]);

  const storeLabelPrinter = useMemo(
    () => getStoreLabelPrinter({
      printers,
      storeLabelPrinterId: STORE_LABEL_PRINTER_ID,
      logisticsLabelPrinterId: LOGISTICS_LABEL_PRINTER_ID,
      updatedAt: '',
    }),
    [printers],
  );

  const updatePrinterHost = (id: string, host: string) => {
    setPrinters(prev => prev.map(p => (p.id === id ? { ...p, host } : p)));
  };

  const handleSave = async () => {
    setBusyKey('save');
    setError('');
    setSuccess('');
    try {
      const saved = await saveLabelStudioDoc(
        { printers },
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
            Printers and label sizes are fixed by usage. Only set each printer IP.
            Port is {HARDCODED_LABEL_PRINTERS[0]?.port ?? 9100} for all.
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
                className="btn btn-primary btn-sm"
                disabled={!dirty || busyKey != null}
                onClick={() => void handleSave()}
              >
                <Save size={15} aria-hidden />
                {busyKey === 'save' ? 'Saving…' : 'Save all'}
              </button>
            </div>

            <div className="settings-local-printer__list">
              {HARDCODED_LABEL_PRINTERS.map(slot => {
                const printer = printers.find(p => p.id === slot.id)
                  ?? { id: slot.id, name: slot.name, host: '', port: slot.port };
                return (
                  <div
                    key={slot.id}
                    className={`settings-logistics__default panel glass settings-local-printer__config${
                      slot.id === STORE_LABEL_PRINTER_ID
                        ? ' settings-local-printer__config--store'
                        : ' settings-local-printer__config--logistics'
                    }`}
                  >
                    <div className="settings-local-printer__config-body settings-local-printer__config-body--flat">
                      <div className="settings-local-printer__config-title-row">
                        <h4 className="settings-logistics__title">{slot.name}</h4>
                        <span className="settings-local-printer__role-badge">{slot.roleBadge}</span>
                      </div>
                      <p className="text-muted text-sm settings-local-printer__usage">
                        {slot.usageDescription}
                        {' · '}
                        {formatLabelMediaSize(slot.media)}
                      </p>
                      <label className="settings-locations__field">
                        <span>IP address</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          value={printer.host}
                          disabled={busyKey === 'save'}
                          onChange={e => updatePrinterHost(slot.id, e.target.value)}
                          placeholder="192.168.1.39"
                        />
                      </label>
                    </div>
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
                    {storeSlot ? ` · ${formatLabelMediaSize(storeSlot.media)}` : ''}
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
