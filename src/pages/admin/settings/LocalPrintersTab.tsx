import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Printer, Save } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  emptyLocalPrinterSettings,
  loadLocalPrinterSettings,
  saveLocalPrinterSettings,
  validatePrinterHost,
} from '../../../lib/localPrinterSettings';
import { isNativePrintAvailable, sendTestLabel } from '../../../lib/localPrinterPrint';
import { DEFAULT_LABEL_PRINTER_PORT } from '../../../constants/localPrinterSettings';

export const LocalPrintersTab: React.FC = () => {
  const { user } = useAuth();
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_LABEL_PRINTER_PORT));
  const [name, setName] = useState('');
  const [savedHost, setSavedHost] = useState('');
  const [savedPort, setSavedPort] = useState(DEFAULT_LABEL_PRINTER_PORT);
  const [savedName, setSavedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const native = isNativePrintAvailable();
  const platform = Capacitor.getPlatform();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await loadLocalPrinterSettings();
      setHost(settings.host);
      setPort(String(settings.port));
      setName(settings.name);
      setSavedHost(settings.host);
      setSavedPort(settings.port);
      setSavedName(settings.name);
    } catch (err) {
      const fallback = emptyLocalPrinterSettings();
      setHost(fallback.host);
      setPort(String(fallback.port));
      setName(fallback.name);
      setError(err instanceof Error ? err.message : 'Could not load printer settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const portNumber = Number(port);
  const dirty =
    host.trim() !== savedHost
    || name.trim() !== savedName
    || portNumber !== savedPort;

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
      const saved = await saveLocalPrinterSettings(
        { host, port: portNumber, name },
        user?.uid ?? null,
      );
      setSavedHost(saved.host);
      setSavedPort(saved.port);
      setSavedName(saved.name);
      setHost(saved.host);
      setPort(String(saved.port));
      setName(saved.name);
      setSuccess('Printer settings saved. All APK users will use this IP on next load.');
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
      if (dirty) {
        throw new Error('Save the printer IP/port before running a test print.');
      }
      const result = await sendTestLabel({ host: host.trim(), port: portNumber });
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
            Store-room LAN label printer. IP is shared via settings; test print requires the YesWeigh Android APK on the same Wi‑Fi.
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
            : 'Browser / PWA — save IP here; open the APK on Wi‑Fi to test print'}
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
                  Default port is 9100 (raw TCP). Reserve the printer IP on the router if DHCP is on.
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
                  title={native ? 'Send a TSPL test label' : 'Requires Android APK on same Wi‑Fi'}
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
          </div>
        )}
      </div>
    </section>
  );
};
