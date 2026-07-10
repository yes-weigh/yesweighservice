import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Printer, Save } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  emptyLocalPrinterSettings,
  loadLocalPrinterSettings,
  saveLocalPrinterSettings,
  validateLabelDimensions,
  validatePrinterHost,
} from '../../../lib/localPrinterSettings';
import { isNativePrintAvailable, sendTestLabel } from '../../../lib/localPrinterPrint';
import {
  DEFAULT_LABEL_GAP_MM,
  DEFAULT_LABEL_HEIGHT_MM,
  DEFAULT_LABEL_PRINTER_PORT,
  DEFAULT_LABEL_WIDTH_MM,
} from '../../../constants/localPrinterSettings';

export const LocalPrintersTab: React.FC = () => {
  const { user } = useAuth();
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_LABEL_PRINTER_PORT));
  const [name, setName] = useState('');
  const [labelWidthMm, setLabelWidthMm] = useState(String(DEFAULT_LABEL_WIDTH_MM));
  const [labelHeightMm, setLabelHeightMm] = useState(String(DEFAULT_LABEL_HEIGHT_MM));
  const [labelGapMm, setLabelGapMm] = useState(String(DEFAULT_LABEL_GAP_MM));
  const [savedHost, setSavedHost] = useState('');
  const [savedPort, setSavedPort] = useState(DEFAULT_LABEL_PRINTER_PORT);
  const [savedName, setSavedName] = useState('');
  const [savedWidth, setSavedWidth] = useState(DEFAULT_LABEL_WIDTH_MM);
  const [savedHeight, setSavedHeight] = useState(DEFAULT_LABEL_HEIGHT_MM);
  const [savedGap, setSavedGap] = useState(DEFAULT_LABEL_GAP_MM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const native = isNativePrintAvailable();
  const platform = Capacitor.getPlatform();

  const applySettings = (settings: ReturnType<typeof emptyLocalPrinterSettings>) => {
    setHost(settings.host);
    setPort(String(settings.port));
    setName(settings.name);
    setLabelWidthMm(String(settings.labelWidthMm));
    setLabelHeightMm(String(settings.labelHeightMm));
    setLabelGapMm(String(settings.labelGapMm));
    setSavedHost(settings.host);
    setSavedPort(settings.port);
    setSavedName(settings.name);
    setSavedWidth(settings.labelWidthMm);
    setSavedHeight(settings.labelHeightMm);
    setSavedGap(settings.labelGapMm);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applySettings(await loadLocalPrinterSettings());
    } catch (err) {
      applySettings(emptyLocalPrinterSettings());
      setError(err instanceof Error ? err.message : 'Could not load printer settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const portNumber = Number(port);
  const widthNumber = Number(labelWidthMm);
  const heightNumber = Number(labelHeightMm);
  const gapNumber = Number(labelGapMm);
  const dirty =
    host.trim() !== savedHost
    || name.trim() !== savedName
    || portNumber !== savedPort
    || widthNumber !== savedWidth
    || heightNumber !== savedHeight
    || gapNumber !== savedGap;

  const handleSave = async () => {
    setBusyKey('save');
    setError('');
    setSuccess('');
    try {
      const hostError = validatePrinterHost(host);
      if (hostError) throw new Error(hostError);
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error('Port must be a whole number between 1 and 65535.');
      }
      const dimError = validateLabelDimensions({
        labelWidthMm: widthNumber,
        labelHeightMm: heightNumber,
        labelGapMm: gapNumber,
      });
      if (dimError) throw new Error(dimError);

      const saved = await saveLocalPrinterSettings(
        {
          host,
          port: portNumber,
          name,
          labelWidthMm: widthNumber,
          labelHeightMm: heightNumber,
          labelGapMm: gapNumber,
        },
        user?.uid ?? null,
      );
      applySettings(saved);
      setSuccess('Printer settings saved. APK users pick up size/gap/IP on next load.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save printer settings.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleTestPrint = async () => {
    setBusyKey('test');
    setError('');
    setSuccess('');
    try {
      const hostError = validatePrinterHost(host);
      if (hostError) throw new Error(hostError);
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error('Port must be a whole number between 1 and 65535.');
      }
      const dimError = validateLabelDimensions({
        labelWidthMm: widthNumber,
        labelHeightMm: heightNumber,
        labelGapMm: gapNumber,
      });
      if (dimError) throw new Error(dimError);
      if (dirty) {
        throw new Error('Save printer settings before running a test print.');
      }
      const result = await sendTestLabel({
        host: host.trim(),
        port: portNumber,
        labelWidthMm: widthNumber,
        labelHeightMm: heightNumber,
        labelGapMm: gapNumber,
      });
      setSuccess(`Test label sent (${result.bytesSent} bytes) to ${host.trim()}:${portNumber}.`);
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
          <h3>Local printers</h3>
          <p className="text-muted text-sm">
            TSC TE210 LAN label printer. Size/gap are physical mm; test print needs the Android APK on the same Wi‑Fi.
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
            : 'Browser / PWA — save settings here; open the APK on Wi‑Fi to test print'}
        </div>

        {loading ? (
          <div className="settings-locations__loading">
            <div className="loader-ring" />
          </div>
        ) : (
          <div className="settings-logistics__default panel glass">
            <div className="settings-logistics__default-head">
              <div>
                <h4 className="settings-logistics__title">Label printer</h4>
                <p className="text-muted text-sm">
                  Defaults from caliper: 75 × 45.5 mm, gap 3.5 mm, port 9100. Test print uses the Genuine Spare layout (sample SKU 4pinCW).
                </p>
              </div>
              <div className="settings-local-printer__actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!dirty || busyKey != null}
                  onClick={() => void handleSave()}
                >
                  <Save size={15} aria-hidden />
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyKey != null || dirty}
                  onClick={() => void handleTestPrint()}
                  title={native ? 'Print Genuine Spare sample label' : 'Requires Android APK on same Wi‑Fi'}
                >
                  <Printer size={15} aria-hidden />
                  {busyKey === 'test' ? 'Printing…' : 'Test print'}
                </button>
              </div>
            </div>

            <label className="settings-locations__field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                disabled={busyKey === 'save'}
                onChange={e => setName(e.target.value)}
                placeholder="Store room label printer"
              />
            </label>

            <label className="settings-locations__field">
              <span>IP address</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={host}
                disabled={busyKey === 'save'}
                onChange={e => setHost(e.target.value)}
                placeholder="192.168.1.39"
              />
            </label>

            <label className="settings-locations__field">
              <span>Port</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                disabled={busyKey === 'save'}
                onChange={e => setPort(e.target.value)}
              />
            </label>

            <div className="settings-local-printer__dims">
              <label className="settings-locations__field">
                <span>Width (mm)</span>
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={0.1}
                  value={labelWidthMm}
                  disabled={busyKey === 'save'}
                  onChange={e => setLabelWidthMm(e.target.value)}
                />
              </label>
              <label className="settings-locations__field">
                <span>Height (mm)</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={0.1}
                  value={labelHeightMm}
                  disabled={busyKey === 'save'}
                  onChange={e => setLabelHeightMm(e.target.value)}
                />
              </label>
              <label className="settings-locations__field">
                <span>Gap (mm)</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  step={0.1}
                  value={labelGapMm}
                  disabled={busyKey === 'save'}
                  onChange={e => setLabelGapMm(e.target.value)}
                />
              </label>
            </div>
            <p className="settings-local-printer__hint text-muted text-sm">
              Use the physical sticker size (not the TE210 self-test WIDTH if it disagrees). Gap can be 0 if Feed already advances one label.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
