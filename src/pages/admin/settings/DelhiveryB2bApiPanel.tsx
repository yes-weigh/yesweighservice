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
import { DELHIVERY_DEFAULT_PICKUP_BY_SITE } from '../../../constants/delhiveryPickupLocations';
import {
  getDelhiveryB2bConfig,
  saveDelhiveryB2bCredentials,
  testDelhiveryB2bConnection,
} from '../../../lib/delhiveryB2b';
import type { DelhiveryB2bEnv, DelhiveryB2bPublicConfig } from '../../../types/delhivery-b2b';
import { emptyDelhiveryB2bPublicConfig } from '../../../types/delhivery-b2b';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';

type Props = {
  onError: (message: string) => void;
};

type TestResultBanner = {
  ok: boolean;
  message: string;
  detail?: string;
};

function withPickupDefaults(
  pickup: Record<StaffLogisticsSite, string>,
): Record<StaffLogisticsSite, string> {
  return {
    cochin: pickup.cochin.trim() || DELHIVERY_DEFAULT_PICKUP_BY_SITE.cochin,
    head_office: pickup.head_office.trim() || DELHIVERY_DEFAULT_PICKUP_BY_SITE.head_office,
  };
}

export const DelhiveryB2bApiPanel: React.FC<Props> = ({ onError }) => {
  const [config, setConfig] = useState<DelhiveryB2bPublicConfig>(emptyDelhiveryB2bPublicConfig);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [env, setEnv] = useState<DelhiveryB2bEnv>('production');
  const [pickup, setPickup] = useState<Record<StaffLogisticsSite, string>>({
    ...DELHIVERY_DEFAULT_PICKUP_BY_SITE,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResultBanner | null>(null);

  const applyConfig = useCallback((next: DelhiveryB2bPublicConfig) => {
    setConfig(next);
    setUsername(next.username);
    setEnv(next.env);
    setPickup(withPickupDefaults(next.pickupLocationBySite));
    setPassword('');
    setShowPassword(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getDelhiveryB2bConfig();
      applyConfig(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load Delhivery API settings.');
    } finally {
      setLoading(false);
    }
  }, [applyConfig, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    setEditing(true);
    setShowPassword(false);
    setPassword('');
    setTestResult(null);
    onError('');
  };

  const cancelEdit = () => {
    setEditing(false);
    setShowPassword(false);
    setPassword('');
    setUsername(config.username);
    setEnv(config.env);
    setPickup(withPickupDefaults(config.pickupLocationBySite));
    onError('');
  };

  const persist = async () => {
    const nextPickup = withPickupDefaults(pickup);
    const next = await saveDelhiveryB2bCredentials({
      username: username.trim(),
      ...(password.trim() ? { password: password.trim() } : {}),
      env,
      pickupLocationBySite: nextPickup,
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
      onError(err instanceof Error ? err.message : 'Could not save Delhivery settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    onError('');
    try {
      if (
        editing
        && (
          username.trim()
          || password.trim()
          || env !== config.env
          || pickup.cochin !== config.pickupLocationBySite.cochin
          || pickup.head_office !== config.pickupLocationBySite.head_office
        )
      ) {
        await persist();
        setEditing(false);
      }
      const result = await testDelhiveryB2bConnection();
      const refreshed = await getDelhiveryB2bConfig();
      applyConfig(refreshed);
      const detail = [
        result.env ? `env ${result.env}` : null,
        result.username || null,
        result.clientName || null,
      ].filter(Boolean).join(' · ');
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
      const message = err instanceof Error ? err.message : 'Could not test Delhivery connection.';
      setTestResult({ ok: false, message });
      onError(message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-courier-rates__loading settings-locations__loading">
        <div className="loader-ring" />
      </div>
    );
  }

  return (
    <div className="settings-courier-rates__card delhivery-b2b-panel">
      <div className="delhivery-b2b-panel__toolbar">
        <div>
          <strong>B2B API credentials</strong>
          <p className="text-muted text-sm">
            {editing
              ? 'Editing — save when done. Password eye is available below.'
              : (config.passwordSet
                ? 'Credentials on file. Edit to change username, password, or pickup names.'
                : 'No password saved yet. Edit to add credentials.')}
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
          <span>Username</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            readOnly={!editing}
            disabled={!editing}
            onChange={e => setUsername(e.target.value)}
            placeholder="INTERWEIGHINGB2B"
          />
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Password</span>
          <div className="delhivery-b2b-panel__password">
            <input
              type={editing && showPassword ? 'text' : 'password'}
              value={editing ? password : (config.passwordSet ? '••••••••' : '')}
              autoComplete="new-password"
              readOnly={!editing}
              disabled={!editing}
              onChange={e => setPassword(e.target.value)}
              placeholder={config.passwordSet ? 'Leave blank to keep current' : 'API password'}
            />
            {editing ? (
              <button
                type="button"
                className="delhivery-b2b-panel__pw-toggle"
                onClick={() => setShowPassword(prev => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            ) : null}
          </div>
        </label>
      </div>

      <div className="settings-courier-rates__inline-fields" style={{ marginTop: 12 }}>
        {STAFF_LOGISTICS_SITES.map(site => (
          <label
            key={site}
            className="settings-courier-rates__field settings-courier-rates__field--plain"
          >
            <span>
              Pickup location ·
              {' '}
              {STAFF_LOGISTICS_SITE_LABELS[site]}
            </span>
            <input
              type="text"
              value={pickup[site]}
              readOnly={!editing}
              disabled={!editing}
              onChange={e => setPickup(prev => ({ ...prev, [site]: e.target.value }))}
              placeholder={DELHIVERY_DEFAULT_PICKUP_BY_SITE[site]}
              spellCheck={false}
              aria-label={`Delhivery pickup location for ${STAFF_LOGISTICS_SITE_LABELS[site]}`}
            />
          </label>
        ))}
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
        Exact Delhivery facility names (unique, case-sensitive). Used as
        {' '}
        <code>pickup_location</code>
        {' '}
        when booking — not the portal facility UUID.
      </p>

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
          disabled={
            saving
            || testing
            || (editing ? (!config.passwordSet && !password.trim()) : !config.passwordSet)
          }
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
