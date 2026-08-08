import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, PlugZap, Save } from 'lucide-react';
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

export const DelhiveryB2bApiPanel: React.FC<Props> = ({ onError }) => {
  const [config, setConfig] = useState<DelhiveryB2bPublicConfig>(emptyDelhiveryB2bPublicConfig);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [env, setEnv] = useState<DelhiveryB2bEnv>('staging');
  const [pickup, setPickup] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setNote('');
    try {
      const next = await getDelhiveryB2bConfig();
      setConfig(next);
      setUsername(next.username);
      setEnv(next.env);
      setPickup({ ...next.pickupLocationBySite });
      setPassword('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load Delhivery API settings.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setNote('');
    onError('');
    try {
      const next = await saveDelhiveryB2bCredentials({
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        env,
        pickupLocationBySite: pickup,
      });
      setConfig(next);
      setPassword('');
      setNote('Saved Delhivery B2B settings.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save Delhivery settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setNote('');
    onError('');
    try {
      // Persist draft fields first so the test uses the latest username/env/password.
      if (username.trim() || password.trim() || env !== config.env) {
        await saveDelhiveryB2bCredentials({
          username: username.trim(),
          ...(password.trim() ? { password: password.trim() } : {}),
          env,
          pickupLocationBySite: pickup,
        });
        setPassword('');
      }
      const result = await testDelhiveryB2bConnection();
      const refreshed = await getDelhiveryB2bConfig();
      setConfig(refreshed);
      setUsername(refreshed.username);
      setEnv(refreshed.env);
      setNote(result.message || (result.ok ? 'Connection ok.' : 'Connection failed.'));
      if (!result.ok) onError(result.message || 'Connection failed.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not test Delhivery connection.');
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
    <fieldset className="settings-courier-rates__card">
      <legend>
        <KeyRound size={14} aria-hidden />
        {' '}
        B2B API connection
      </legend>
      <p className="text-muted text-sm" style={{ marginTop: 0 }}>
        Staging login uses username
        {' '}
        <code>INTERWEIGHINGB2B-b2b</code>
        .
        Password is stored server-side and never shown again after save.
      </p>

      <div className="settings-courier-rates__inline-fields">
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Environment</span>
          <select
            value={env}
            onChange={e => setEnv(e.target.value === 'production' ? 'production' : 'staging')}
            aria-label="Delhivery B2B environment"
          >
            <option value="staging">Staging (btob-api-dev)</option>
            <option value="production">Production (btob.api)</option>
          </select>
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>API username</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={e => setUsername(e.target.value)}
            placeholder="INTERWEIGHINGB2B-b2b"
          />
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>
            Password
            {config.passwordSet ? ' (leave blank to keep)' : ''}
          </span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={e => setPassword(e.target.value)}
            placeholder={config.passwordSet ? '••••••••' : 'API password'}
          />
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
              {STAFF_LOGISTICS_SITE_LABELS[site]}
            </span>
            <input
              type="text"
              value={pickup[site]}
              onChange={e => setPickup(prev => ({ ...prev, [site]: e.target.value }))}
              placeholder="Exact Delhivery warehouse name"
            />
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={saving || testing}
          onClick={() => void handleSave()}
        >
          {saving ? <Loader2 size={16} className="spin" aria-hidden /> : <Save size={16} aria-hidden />}
          Save
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || testing || (!config.passwordSet && !password.trim())}
          onClick={() => void handleTest()}
        >
          {testing ? <Loader2 size={16} className="spin" aria-hidden /> : <PlugZap size={16} aria-hidden />}
          Test connection
        </button>
      </div>

      {(note || config.lastTestMessage) ? (
        <p
          className="text-sm"
          style={{
            marginTop: 12,
            color: (note ? /fail|error|reject/i.test(note) : !config.lastTestOk)
              ? 'var(--danger, #b42318)'
              : 'var(--success, #067647)',
          }}
        >
          {note || config.lastTestMessage}
          {config.lastTestAt && !note ? (
            <span className="text-muted">
              {' · '}
              {new Date(config.lastTestAt).toLocaleString('en-IN')}
            </span>
          ) : null}
          {config.clientName ? (
            <span className="text-muted">
              {' · '}
              {config.clientName}
            </span>
          ) : null}
        </p>
      ) : null}
    </fieldset>
  );
};
