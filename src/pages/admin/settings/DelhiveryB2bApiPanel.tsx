import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, PlugZap, Save } from 'lucide-react';
import {
  getDelhiveryB2bConfig,
  saveDelhiveryB2bCredentials,
  testDelhiveryB2bConnection,
} from '../../../lib/delhiveryB2b';
import type { DelhiveryB2bEnv, DelhiveryB2bPublicConfig } from '../../../types/delhivery-b2b';
import { emptyDelhiveryB2bPublicConfig } from '../../../types/delhivery-b2b';
import type { StaffLogisticsSite } from '../../../types/staff-logistics';

type Props = {
  onError: (message: string) => void;
};

export const DelhiveryB2bApiPanel: React.FC<Props> = ({ onError }) => {
  const [config, setConfig] = useState<DelhiveryB2bPublicConfig>(emptyDelhiveryB2bPublicConfig);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [env, setEnv] = useState<DelhiveryB2bEnv>('production');
  const [pickup, setPickup] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  const persist = async () => {
    const next = await saveDelhiveryB2bCredentials({
      username: username.trim(),
      ...(password.trim() ? { password: password.trim() } : {}),
      env,
      pickupLocationBySite: pickup,
    });
    setConfig(next);
    setPassword('');
    return next;
  };

  const handleSave = async () => {
    setSaving(true);
    onError('');
    try {
      await persist();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save Delhivery settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    onError('');
    try {
      if (username.trim() || password.trim() || env !== config.env) {
        await persist();
      }
      const result = await testDelhiveryB2bConnection();
      const refreshed = await getDelhiveryB2bConfig();
      setConfig(refreshed);
      setUsername(refreshed.username);
      setEnv(refreshed.env);
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
    <div className="settings-courier-rates__card">
      <div className="settings-courier-rates__inline-fields">
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Username</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            onChange={e => setUsername(e.target.value)}
            placeholder="INTERWEIGHINGB2B"
          />
        </label>
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={e => setPassword(e.target.value)}
            placeholder={config.passwordSet ? '••••••••' : 'API password'}
          />
        </label>
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
    </div>
  );
};
