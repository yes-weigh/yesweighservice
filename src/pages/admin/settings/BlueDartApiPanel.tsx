import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  PlugZap,
  Save,
  X,
} from 'lucide-react';
import {
  getBlueDartConfig,
  saveBlueDartCredentials,
  testBlueDartConnection,
} from '../../../lib/blueDartApi';
import type { BlueDartApiEnv, BlueDartPublicConfig } from '../../../types/blue-dart-api';
import { emptyBlueDartPublicConfig } from '../../../types/blue-dart-api';

type Props = {
  onError: (message: string) => void;
};

type TestResultBanner = {
  ok: boolean;
  message: string;
  detail?: string;
};

export const BlueDartApiPanel: React.FC<Props> = ({ onError }) => {
  const [config, setConfig] = useState<BlueDartPublicConfig>(emptyBlueDartPublicConfig);
  const [env, setEnv] = useState<BlueDartApiEnv>('production');
  const [loginId, setLoginId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [shippingLicenseKey, setShippingLicenseKey] = useState('');
  const [trackingLicenseKey, setTrackingLicenseKey] = useState('');
  const [sandboxLicenseKey, setSandboxLicenseKey] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [originArea, setOriginArea] = useState('');
  const [customerPincode, setCustomerPincode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [testResult, setTestResult] = useState<TestResultBanner | null>(null);

  const applyConfig = useCallback((next: BlueDartPublicConfig) => {
    setConfig(next);
    setEnv(next.env);
    setLoginId(next.loginId);
    setCustomerCode(next.customerCode);
    setOriginArea(next.originArea);
    setCustomerPincode(next.customerPincode);
    setCustomerName(next.customerName);
    setClientId('');
    setClientSecret('');
    setShippingLicenseKey('');
    setTrackingLicenseKey('');
    setSandboxLicenseKey('');
    setShowSecrets(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyConfig(await getBlueDartConfig());
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load Blue Dart API settings.');
    } finally {
      setLoading(false);
    }
  }, [applyConfig, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    setEditing(true);
    setShowSecrets(false);
    setTestResult(null);
    onError('');
  };

  const cancelEdit = () => {
    setEditing(false);
    applyConfig(config);
    onError('');
  };

  const persist = async () => {
    const next = await saveBlueDartCredentials({
      env,
      loginId: loginId.trim(),
      customerCode: customerCode.trim(),
      originArea: originArea.trim(),
      customerPincode: customerPincode.trim(),
      customerName: customerName.trim(),
      ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
      ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      ...(shippingLicenseKey.trim() ? { shippingLicenseKey: shippingLicenseKey.trim() } : {}),
      ...(trackingLicenseKey.trim() ? { trackingLicenseKey: trackingLicenseKey.trim() } : {}),
      ...(sandboxLicenseKey.trim() ? { sandboxLicenseKey: sandboxLicenseKey.trim() } : {}),
    });
    applyConfig(next);
    return next;
  };

  const handleSave = async () => {
    setSaving(true);
    onError('');
    try {
      await persist();
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save Blue Dart settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    onError('');
    try {
      if (editing) {
        await persist();
        setEditing(false);
      }
      const result = await testBlueDartConnection();
      applyConfig(await getBlueDartConfig());
      const detail = [result.env ? `env ${result.env}` : null, result.loginId || null]
        .filter(Boolean)
        .join(' · ');
      if (result.ok) {
        setTestResult({
          ok: true,
          message: result.message?.trim() || 'Connection successful.',
          detail: detail || undefined,
        });
      } else {
        const message = result.message?.trim() || 'Connection failed.';
        setTestResult({ ok: false, message, detail: detail || undefined });
        onError(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not test Blue Dart connection.';
      setTestResult({ ok: false, message });
      onError(message);
    } finally {
      setTesting(false);
    }
  };

  const secretReady = config.clientSecretSet
    && (env === 'sandbox' ? config.sandboxLicenseSet : config.shippingLicenseSet);

  if (loading) {
    return (
      <div className="settings-courier-rates__loading settings-locations__loading">
        <div className="loader-ring" />
      </div>
    );
  }

  const secretInput = (
    value: string,
    setValue: (next: string) => void,
    stored: boolean,
    placeholder: string,
  ) => (
    <div className="delhivery-b2b-panel__password">
      <input
        type={editing && showSecrets ? 'text' : 'password'}
        value={editing ? value : (stored ? '••••••••' : '')}
        autoComplete="new-password"
        readOnly={!editing}
        disabled={!editing}
        onChange={e => setValue(e.target.value)}
        placeholder={stored ? 'Leave blank to keep current' : placeholder}
      />
      {editing ? (
        <button
          type="button"
          className="delhivery-b2b-panel__pw-toggle"
          onClick={() => setShowSecrets(prev => !prev)}
          aria-label={showSecrets ? 'Hide secrets' : 'Show secrets'}
        >
          {showSecrets ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="settings-courier-rates__card delhivery-b2b-panel">
      <div className="delhivery-b2b-panel__toolbar">
        <div>
          <strong>Blue Dart API credentials</strong>
          <p className="text-muted text-sm">
            {editing
              ? 'Editing — license keys are write-only (Admin SDK), same as Delhivery.'
              : (secretReady
                ? 'Credentials on file. Edit to change keys, LoginID, or environment.'
                : 'No production keys saved yet. Edit to add shipping / tracking licenses.')}
          </p>
        </div>
        {editing ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving || testing}
            onClick={cancelEdit}
          >
            <X size={14} aria-hidden />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving || testing}
            onClick={startEdit}
          >
            <Pencil size={14} aria-hidden />
            Edit
          </button>
        )}
      </div>

      <div className="settings-courier-rates__inline-fields">
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Environment</span>
          <select
            value={env}
            disabled={!editing}
            onChange={e => setEnv(e.target.value === 'sandbox' ? 'sandbox' : 'production')}
          >
            <option value="production">Production</option>
            <option value="sandbox">Sandbox</option>
          </select>
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Login ID</span>
          <input
            type="text"
            value={loginId}
            readOnly={!editing}
            disabled={!editing}
            onChange={e => setLoginId(e.target.value)}
            placeholder="COK36650"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="settings-courier-rates__inline-fields" style={{ marginTop: 12 }}>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Customer code</span>
          <input
            type="text"
            value={customerCode}
            readOnly={!editing}
            disabled={!editing}
            onChange={e => setCustomerCode(e.target.value)}
            placeholder="034241"
            spellCheck={false}
          />
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Origin area</span>
          <input
            type="text"
            value={originArea}
            readOnly={!editing}
            disabled={!editing}
            onChange={e => setOriginArea(e.target.value.toUpperCase())}
            placeholder="COK"
            spellCheck={false}
          />
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Origin pincode</span>
          <input
            type="text"
            value={customerPincode}
            readOnly={!editing}
            disabled={!editing}
            inputMode="numeric"
            onChange={e => setCustomerPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="682001"
          />
        </label>
      </div>

      <label className="settings-courier-rates__field settings-courier-rates__field--plain" style={{ marginTop: 12 }}>
        <span>Customer name</span>
        <input
          type="text"
          value={customerName}
          readOnly={!editing}
          disabled={!editing}
          onChange={e => setCustomerName(e.target.value)}
          placeholder="INTERWEIGHING PRIVATE LIMITED"
        />
      </label>

      <div className="settings-courier-rates__inline-fields" style={{ marginTop: 12 }}>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Client ID</span>
          {secretInput(clientId, setClientId, config.clientSecretSet, 'DHL developer ClientID')}
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Client secret</span>
          {secretInput(clientSecret, setClientSecret, config.clientSecretSet, 'DHL developer secret')}
        </label>
      </div>

      <div className="settings-courier-rates__inline-fields" style={{ marginTop: 12 }}>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Shipping license (live)</span>
          {secretInput(shippingLicenseKey, setShippingLicenseKey, config.shippingLicenseSet, 'Waybill license')}
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Tracking license (live)</span>
          {secretInput(trackingLicenseKey, setTrackingLicenseKey, config.trackingLicenseSet, 'Tracking license')}
        </label>
      </div>

      <label className="settings-courier-rates__field settings-courier-rates__field--plain" style={{ marginTop: 12 }}>
        <span>Sandbox license</span>
        {secretInput(sandboxLicenseKey, setSandboxLicenseKey, config.sandboxLicenseSet, 'Sandbox LicenceKey')}
      </label>

      <div className="delhivery-b2b-panel__actions">
        {editing ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving || testing}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 size={16} className="spin" aria-hidden /> : <Save size={16} aria-hidden />}
            Save
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || testing || (editing ? false : !secretReady)}
          onClick={() => void handleTest()}
        >
          {testing ? <Loader2 size={16} className="spin" aria-hidden /> : <PlugZap size={16} aria-hidden />}
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {testResult ? (
        <div
          className={`delhivery-b2b-panel__test-result${testResult.ok ? ' is-ok' : ' is-fail'}`}
          role="status"
          aria-live="polite"
        >
          {testResult.ok
            ? <CheckCircle2 size={16} aria-hidden />
            : <AlertTriangle size={16} aria-hidden />}
          <div>
            <strong>{testResult.ok ? 'Success' : 'Failed'}</strong>
            <p>{testResult.message}</p>
            {testResult.detail ? <em>{testResult.detail}</em> : null}
          </div>
        </div>
      ) : config.lastTestAt ? (
        <div
          className={`delhivery-b2b-panel__test-result is-prior${config.lastTestOk ? ' is-ok' : ' is-fail'}`}
          role="status"
        >
          {config.lastTestOk
            ? <CheckCircle2 size={16} aria-hidden />
            : <AlertTriangle size={16} aria-hidden />}
          <div>
            <strong>
              Last test
              {' '}
              {config.lastTestOk ? 'succeeded' : 'failed'}
            </strong>
            <p>{config.lastTestMessage || (config.lastTestOk ? 'Connection successful.' : 'Connection failed.')}</p>
            <em>
              {(() => {
                const at = new Date(config.lastTestAt);
                return Number.isNaN(at.getTime())
                  ? config.lastTestAt
                  : at.toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  });
              })()}
            </em>
          </div>
        </div>
      ) : null}
    </div>
  );
};
