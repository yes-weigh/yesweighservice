import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ChevronDown, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { LocalPrinterLabelPreview } from '../../../components/admin/LocalPrinterLabelPreview';
import {
  emptyLabelLayout,
  emptyLabelPrinter,
  emptyLabelStudioDoc,
  emptyPrintLabel,
  loadLabelStudioDoc,
  saveLabelStudioDoc,
  type LabelLayout,
  type LabelPrinter,
  type LabelStudioDoc,
  type PrintLabel,
} from '../../../lib/labelStudio';
import {
  getLabelLayoutTemplateXml,
  parseLayoutMedia,
  validateLayoutXml,
} from '../../../lib/labelLayouts';
import { isNativePrintAvailable, sendTestLabel } from '../../../lib/localPrinterPrint';
import {
  loadTestLabelDraft,
  saveTestLabelDraft,
  toBinLabelFields,
  type BinLabelDraft,
} from '../../../lib/localPrinterLabel';

type StudioTab = 'printers' | 'layouts' | 'labels';

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
  const [tab, setTab] = useState<StudioTab>('printers');
  const [printers, setPrinters] = useState<PrinterDraft[]>([]);
  const [layouts, setLayouts] = useState<LabelLayout[]>([]);
  const [labels, setLabels] = useState<PrintLabel[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [expandedPrinterIds, setExpandedPrinterIds] = useState<Set<string>>(() => new Set());
  const [selectedLayoutId, setSelectedLayoutId] = useState('');
  const [selectedLabelId, setSelectedLabelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<BinLabelDraft>(() => loadTestLabelDraft());

  const native = isNativePrintAvailable();
  const platform = Capacitor.getPlatform();
  const previewFields = useMemo(() => toBinLabelFields(draft), [draft]);

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
    setLayouts(docData.layouts);
    setLabels(docData.labels);
    setSelectedLayoutId(prev =>
      docData.layouts.some(l => l.id === prev) ? prev : (docData.layouts[0]?.id ?? ''),
    );
    setSelectedLabelId(prev =>
      docData.labels.some(l => l.id === prev) ? prev : (docData.labels[0]?.id ?? ''),
    );
    setSavedSnapshot(JSON.stringify({
      printers: docData.printers,
      layouts: docData.layouts,
      labels: docData.labels,
    }));
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applyDoc(await loadLabelStudioDoc());
    } catch (err) {
      applyDoc(emptyLabelStudioDoc());
      setError(err instanceof Error ? err.message : 'Could not load label studio.');
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
      layouts,
      labels,
    });
    return snapshot !== savedSnapshot;
  }, [currentPrinters, layouts, labels, savedSnapshot]);

  const selectedLayout = useMemo(
    () => layouts.find(l => l.id === selectedLayoutId) ?? layouts[0] ?? null,
    [layouts, selectedLayoutId],
  );

  const selectedLabel = useMemo(
    () => labels.find(l => l.id === selectedLabelId) ?? labels[0] ?? null,
    [labels, selectedLabelId],
  );

  const selectedLabelLayout = useMemo(() => {
    if (!selectedLabel) return null;
    return layouts.find(l => l.id === selectedLabel.layoutId) ?? null;
  }, [selectedLabel, layouts]);

  const selectedLabelPrinter = useMemo(() => {
    if (!selectedLabel) return null;
    return currentPrinters.find(p => p.id === selectedLabel.printerId) ?? null;
  }, [selectedLabel, currentPrinters]);

  const updatePrinter = (id: string, patch: Partial<PrinterDraft>) => {
    setPrinters(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  };

  const updateLayout = (id: string, patch: Partial<LabelLayout>) => {
    setLayouts(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  };

  const updateLabel = (id: string, patch: Partial<PrintLabel>) => {
    setLabels(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
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
    if (labels.some(l => l.printerId === id)) {
      setError('This printer is used by a label. Reassign or delete those labels first.');
      return;
    }
    setPrinters(prev => prev.filter(p => p.id !== id));
    setExpandedPrinterIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleAddLayout = () => {
    const next = emptyLabelLayout({
      name: `Custom layout ${layouts.length + 1}`,
      xml: getLabelLayoutTemplateXml('genuine-spare'),
    });
    setLayouts(prev => [...prev, next]);
    setSelectedLayoutId(next.id);
    setTab('layouts');
  };

  const handleDeleteLayout = (id: string) => {
    if (layouts.length <= 1) {
      setError('Keep at least one layout.');
      return;
    }
    if (labels.some(l => l.layoutId === id)) {
      setError('This layout is used by a label. Reassign or delete those labels first.');
      return;
    }
    const remaining = layouts.filter(l => l.id !== id);
    setLayouts(remaining);
    if (selectedLayoutId === id) setSelectedLayoutId(remaining[0]?.id ?? '');
  };

  const handleAddLabel = () => {
    const next = emptyPrintLabel({
      name: `Label ${labels.length + 1}`,
      printerId: currentPrinters[0]?.id ?? '',
      layoutId: layouts[0]?.id ?? '',
    });
    setLabels(prev => [...prev, next]);
    setSelectedLabelId(next.id);
    setTab('labels');
  };

  const handleDeleteLabel = (id: string) => {
    if (labels.length <= 1) {
      setError('Keep at least one label.');
      return;
    }
    const remaining = labels.filter(l => l.id !== id);
    setLabels(remaining);
    if (selectedLabelId === id) setSelectedLabelId(remaining[0]?.id ?? '');
  };

  const handleSave = async () => {
    setBusyKey('save');
    setError('');
    setSuccess('');
    try {
      const saved = await saveLabelStudioDoc(
        {
          printers: currentPrinters,
          layouts,
          labels,
        },
        user?.uid ?? null,
      );
      applyDoc(saved);
      setSuccess('Label studio saved. Print dialogs and APK users pick this up on next load.');
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
      const printer = selectedLabelPrinter;
      const layout = selectedLabelLayout;
      if (!printer || !layout) throw new Error('Select a label with a valid printer and layout.');
      if (!printer.host.trim()) throw new Error('Set the printer IP address.');
      const result = await sendTestLabel({
        host: printer.host.trim(),
        port: printer.port,
        layoutXml: layout.xml,
        fields: toBinLabelFields(draft),
      });
      saveTestLabelDraft(draft);
      const media = parseLayoutMedia(layout.xml);
      setSuccess(
        `Label bitmap sent (${result.bytesSent} bytes) to ${printer.host.trim()}:${printer.port} `
        + `(${selectedLabel?.name ?? 'label'} · ${media.labelWidthMm}×${media.labelHeightMm} mm).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test print failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const layoutXmlError = selectedLayout ? validateLayoutXml(selectedLayout.xml) : null;

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Label printing</h3>
          <p className="text-muted text-sm">
            Define printers, layout XML templates, and labels (each label = printer + layout).
            Spare-part print picks a label, then fills any missing bindings.
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
              <div className="label-studio__tabs" role="tablist" aria-label="Label studio sections">
                {([
                  ['printers', 'Printers'],
                  ['layouts', 'Layouts'],
                  ['labels', 'Labels'],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={`label-studio__tab${tab === id ? ' is-active' : ''}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
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

            {tab === 'printers' && (
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
                </div>
                <div className="settings-local-printer__list">
                  {printers.map(printer => {
                    const expanded = expandedPrinterIds.has(printer.id);
                    return (
                      <div
                        key={printer.id}
                        className="settings-logistics__default panel glass settings-local-printer__config"
                      >
                        <button
                          type="button"
                          className="settings-local-printer__config-toggle"
                          aria-expanded={expanded}
                          onClick={() => togglePrinterExpanded(printer.id)}
                        >
                          <div className="settings-local-printer__config-toggle-text">
                            <h4 className="settings-logistics__title">
                              {printer.name.trim() || 'Label printer'}
                            </h4>
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
                            <p className="settings-local-printer__hint text-muted text-sm">
                              Label size and gap come from the layout XML, not the printer.
                            </p>
                            <div className="settings-local-printer__card-actions">
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
              </>
            )}

            {tab === 'layouts' && selectedLayout && (
              <div className="label-studio__split">
                <div className="label-studio__sidebar">
                  <div className="settings-local-printer__list-toolbar">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null}
                      onClick={handleAddLayout}
                    >
                      <Plus size={15} aria-hidden />
                      Add layout
                    </button>
                  </div>
                  <ul className="label-studio__entity-list">
                    {layouts.map(layout => {
                      const media = parseLayoutMedia(layout.xml);
                      return (
                        <li key={layout.id}>
                          <button
                            type="button"
                            className={`label-studio__entity${layout.id === selectedLayout.id ? ' is-active' : ''}`}
                            onClick={() => setSelectedLayoutId(layout.id)}
                          >
                            <strong>{layout.name}</strong>
                            <span className="text-muted text-sm">
                              {media.labelWidthMm}×{media.labelHeightMm} mm · gap {media.labelGapMm}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="label-studio__main settings-logistics__default panel glass">
                  <label className="settings-locations__field">
                    <span>Layout name</span>
                    <input
                      type="text"
                      value={selectedLayout.name}
                      disabled={busyKey === 'save'}
                      onChange={e => updateLayout(selectedLayout.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="settings-locations__field">
                    <span>Layout XML</span>
                    <textarea
                      className="settings-local-printer__xml"
                      rows={16}
                      spellCheck={false}
                      value={selectedLayout.xml}
                      disabled={busyKey === 'save'}
                      onChange={e => updateLayout(selectedLayout.id, { xml: e.target.value })}
                    />
                  </label>
                  {layoutXmlError && (
                    <p className="settings-locations__error text-sm">{layoutXmlError}</p>
                  )}
                  <div className="settings-local-printer__card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey === 'save'}
                      onClick={() => updateLayout(selectedLayout.id, {
                        xml: getLabelLayoutTemplateXml('genuine-spare'),
                      })}
                    >
                      Load Genuine Spare seed
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey === 'save'}
                      onClick={() => updateLayout(selectedLayout.id, {
                        xml: getLabelLayoutTemplateXml('simple-bin'),
                      })}
                    >
                      Load Simple bin seed
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null || layouts.length <= 1}
                      onClick={() => handleDeleteLayout(selectedLayout.id)}
                    >
                      <Trash2 size={15} aria-hidden />
                      Delete layout
                    </button>
                  </div>

                  {!layoutXmlError && (
                    <LocalPrinterLabelPreview
                      layoutXml={selectedLayout.xml}
                      fields={previewFields}
                    />
                  )}

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
                      <label className="settings-locations__field settings-local-printer__field--wide">
                        <span>QR payload</span>
                        <input type="text" value={draft.qrPayload} onChange={e => updateDraft('qrPayload', e.target.value)} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'labels' && selectedLabel && (
              <div className="label-studio__split">
                <div className="label-studio__sidebar">
                  <div className="settings-local-printer__list-toolbar">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null}
                      onClick={handleAddLabel}
                    >
                      <Plus size={15} aria-hidden />
                      Add label
                    </button>
                  </div>
                  <ul className="label-studio__entity-list">
                    {labels.map(label => {
                      const printer = currentPrinters.find(p => p.id === label.printerId);
                      const layout = layouts.find(l => l.id === label.layoutId);
                      return (
                        <li key={label.id}>
                          <button
                            type="button"
                            className={`label-studio__entity${label.id === selectedLabel.id ? ' is-active' : ''}`}
                            onClick={() => setSelectedLabelId(label.id)}
                          >
                            <strong>{label.name}</strong>
                            <span className="text-muted text-sm">
                              {(printer?.name ?? '—') + ' · ' + (layout?.name ?? '—')}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="label-studio__main settings-logistics__default panel glass">
                  <div className="settings-local-printer__preview-head">
                    <div>
                      <h4 className="settings-logistics__title">Label recipe</h4>
                      <p className="text-muted text-sm">
                        {selectedLabelPrinter
                          ? `${selectedLabelPrinter.name} (${selectedLabelPrinter.host || 'no IP'})`
                          : 'No printer'}
                        {selectedLabelLayout
                          ? ` · ${selectedLabelLayout.name}`
                          : ''}
                      </p>
                    </div>
                    <div className="settings-local-printer__preview-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyKey != null || dirty}
                        onClick={() => void handleTestPrint()}
                        title={native ? 'Print the exact preview bitmap' : 'Requires Android APK on same Wi‑Fi'}
                      >
                        <Printer size={15} aria-hidden />
                        {busyKey === 'test' ? 'Printing…' : 'Test print'}
                      </button>
                    </div>
                  </div>

                  <label className="settings-locations__field">
                    <span>Label name</span>
                    <input
                      type="text"
                      value={selectedLabel.name}
                      disabled={busyKey === 'save'}
                      onChange={e => updateLabel(selectedLabel.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="settings-locations__field">
                    <span>Printer</span>
                    <select
                      value={selectedLabel.printerId}
                      disabled={busyKey === 'save'}
                      onChange={e => updateLabel(selectedLabel.id, { printerId: e.target.value })}
                    >
                      {currentPrinters.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-locations__field">
                    <span>Layout</span>
                    <select
                      value={selectedLabel.layoutId}
                      disabled={busyKey === 'save'}
                      onChange={e => updateLabel(selectedLabel.id, { layoutId: e.target.value })}
                    >
                      {layouts.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-local-printer__card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey != null || labels.length <= 1}
                      onClick={() => handleDeleteLabel(selectedLabel.id)}
                    >
                      <Trash2 size={15} aria-hidden />
                      Delete label
                    </button>
                  </div>

                  {selectedLabelLayout && (
                    <LocalPrinterLabelPreview
                      layoutXml={selectedLabelLayout.xml}
                      fields={previewFields}
                    />
                  )}

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
                      <label className="settings-locations__field settings-local-printer__field--wide">
                        <span>QR payload</span>
                        <input type="text" value={draft.qrPayload} onChange={e => updateDraft('qrPayload', e.target.value)} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
