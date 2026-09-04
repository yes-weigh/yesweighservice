import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  IndianRupee,
  Loader2,
  Pencil,
  PlugZap,
  Save,
  X,
} from 'lucide-react';
import { DELHIVERY_DEFAULT_PICKUP_BY_SITE } from '../../../constants/delhiveryPickupLocations';
import { formatCurrency } from '../../../lib/catalog';
import {
  fetchDelhiveryFreightCharges,
  getDelhiveryB2bConfig,
  saveDelhiveryB2bCredentials,
  testDelhiveryB2bConnection,
  type DelhiveryFreightChargeEntry,
} from '../../../lib/delhiveryB2b';
import { normalizeDelhiveryId } from '../../../lib/delhiveryTrack';
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

function money(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  return formatCurrency(amount);
}

function freightDialogRows(freight: DelhiveryFreightChargeEntry): Array<{ label: string; value: string; emphasize?: boolean }> {
  const rows: Array<{ label: string; value: string; emphasize?: boolean }> = [];
  if (freight.lrn) rows.push({ label: 'LRN', value: freight.lrn });
  if (freight.billingMode) {
    rows.push({ label: 'Billing', value: freight.billingMode.toUpperCase() });
  }
  if (freight.chargedWeightKg != null) {
    rows.push({ label: 'Charged weight', value: `${freight.chargedWeightKg.toFixed(2)} kg` });
  }
  const breakup = freight.breakup;
  if (breakup) {
    const add = (label: string, amount: number | null) => {
      const text = money(amount);
      if (text) rows.push({ label, value: text });
    };
    add('Base freight', breakup.baseFreightCharge);
    add('Fuel surcharge', breakup.fuelSurcharge);
    add('Fuel hike', breakup.fuelHike);
    add('Insurance / ROV', breakup.insuranceRov);
    add('ODA (first mile)', breakup.odaFm);
    add('ODA (last mile)', breakup.odaLm);
    add('First mile', breakup.fm);
    add('Last mile', breakup.lm);
    add('Green', breakup.green);
    add('Other handling', breakup.otherHandlingCharges);
    add('Markup', breakup.markup);
    add('Freight (excl. GST)', breakup.preTaxFreight);
    add('GST', breakup.gst);
  }
  const total = money(freight.totalInr);
  if (total) rows.push({ label: 'Total (incl. GST)', value: total, emphasize: true });
  return rows;
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
  const [lrn, setLrn] = useState('');
  const [freightTesting, setFreightTesting] = useState(false);
  const [freightDialog, setFreightDialog] = useState<{
    lrn: string;
    freight: DelhiveryFreightChargeEntry | null;
    error: string | null;
  } | null>(null);

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

  useEffect(() => {
    if (!freightDialog) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFreightDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [freightDialog]);

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

  const handleFreightTest = async () => {
    const id = normalizeDelhiveryId(lrn);
    if (!id) {
      onError('Enter an LRN to test freight.');
      return;
    }
    setFreightTesting(true);
    onError('');
    try {
      const freight = await fetchDelhiveryFreightCharges(id);
      setFreightDialog({
        lrn: id,
        freight,
        error: freight.ok
          ? null
          : (freight.error || 'Freight not available yet. Delhivery returns billed amount after weight capture.'),
      });
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Could not fetch Delhivery freight.';
      setFreightDialog({ lrn: id, freight: null, error: message });
    } finally {
      setFreightTesting(false);
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
        <label className="settings-courier-rates__field settings-courier-rates__field--plain">
          <span>LRN</span>
          <input
            type="text"
            inputMode="numeric"
            value={lrn}
            onChange={e => setLrn(e.target.value.replace(/[^\dA-Za-z]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleFreightTest();
              }
            }}
            placeholder="314344753"
            spellCheck={false}
            autoComplete="off"
            aria-label="Delhivery LRN for freight test"
          />
        </label>
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 8, marginBottom: 0 }}>
        Enter an LRN and press Test for billed freight after weight capture.
      </p>

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
            || freightTesting
            || (editing ? (!config.passwordSet && !password.trim()) : !config.passwordSet)
          }
          onClick={() => void handleTest()}
        >
          {testing ? <Loader2 size={16} className="spin" aria-hidden /> : <PlugZap size={16} aria-hidden />}
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={
            freightTesting
            || testing
            || saving
            || !normalizeDelhiveryId(lrn)
            || !config.passwordSet
          }
          onClick={() => void handleFreightTest()}
        >
          {freightTesting
            ? <Loader2 size={16} className="spin" aria-hidden />
            : <IndianRupee size={16} aria-hidden />}
          {freightTesting ? 'Testing…' : 'Test'}
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

      {freightDialog
        ? createPortal(
          <div
            className="dealers-modal-backdrop delhivery-freight-test-dialog__backdrop"
            onClick={() => setFreightDialog(null)}
          >
            <div
              className="dealers-modal panel glass delhivery-freight-test-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delhivery-freight-test-title"
              onClick={e => e.stopPropagation()}
            >
              <header className="dealers-modal__header">
                <h2 id="delhivery-freight-test-title">Delhivery freight</h2>
                <button
                  type="button"
                  className="dealers-modal__close"
                  onClick={() => setFreightDialog(null)}
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </header>
              {freightDialog.freight?.ok ? (
                <dl className="delhivery-freight-test-dialog__rows">
                  {freightDialogRows(freightDialog.freight).map(row => (
                    <div
                      key={row.label}
                      className={row.emphasize ? 'is-total' : undefined}
                    >
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="delhivery-freight-test-dialog__empty" role="status">
                  {freightDialog.error
                    || 'Freight not available yet. Delhivery returns billed amount after weight capture.'}
                </p>
              )}
              <div className="dealers-modal__actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setFreightDialog(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
};
