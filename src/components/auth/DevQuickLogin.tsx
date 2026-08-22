import React, { useMemo, useState } from 'react';
import { isLocalhostDev } from '../../lib/isLocalhost';

type DevQuickLoginProfile = {
  id: string;
  label: string;
  loginId: string;
  password: string;
};

/** Local-dev test accounts only — stripped from production builds via import.meta.env.DEV. */
const DEV_QUICK_LOGIN_PROFILES: readonly DevQuickLoginProfile[] = import.meta.env.DEV
  ? [
      {
        id: 'meezan',
        label: 'Meezan (dealer)',
        loginId: '9544227744',
        password: 'Pala!7890',
      },
      {
        id: 'nasreena',
        label: 'Nasreena (dealer staff)',
        loginId: '354330408013',
        password: 'Pala!7890',
      },
      {
        id: 'biju',
        label: 'Biju (staff)',
        loginId: '494837940091',
        password: 'Yes@2026',
      },
      {
        id: 'vishakh',
        label: 'Vishakh (staff)',
        loginId: '648742683897',
        password: 'Yes@2026',
      },
      {
        id: 'vishnu',
        label: 'Vishnu (invoice access)',
        loginId: '261870165022',
        password: 'Yesweigh@2026',
      },
      {
        id: 'safna',
        label: 'Safna (admin)',
        loginId: '788971879465',
        password: 'Yes@2026',
      },
      {
        id: 'shibin',
        label: 'Shibin (Spare incharge)',
        loginId: '8272283477829',
        password: 'Crm@2026',
      },
      {
        id: 'developer',
        label: 'Developer (super admin)',
        loginId: 'admin@yesweigh.in',
        password: 'YesWeigh@2026',
      },
      {
        id: 'shuhaib',
        label: 'Shuhaib (media)',
        loginId: 'shuhaib',
        password: 'shuhaib',
      },
    ]
  : [];

export function canShowDevQuickLogin(): boolean {
  return Boolean(import.meta.env.DEV && isLocalhostDev() && DEV_QUICK_LOGIN_PROFILES.length > 0);
}

export const DevQuickLogin: React.FC<{
  disabled?: boolean;
  onPick: (loginId: string, password: string) => void;
}> = ({ disabled = false, onPick }) => {
  const [selectedId, setSelectedId] = useState('');
  const profiles = useMemo(() => DEV_QUICK_LOGIN_PROFILES, []);

  if (!canShowDevQuickLogin()) return null;

  return (
    <div className="login-dev-quick">
      <div className="login-dev-quick__badge">Localhost only</div>
      <label className="login-dev-quick__label" htmlFor="login-dev-quick-select">
        Quick login
      </label>
      <select
        id="login-dev-quick-select"
        className="login-dev-quick__select"
        value={selectedId}
        disabled={disabled}
        onChange={event => {
          const nextId = event.target.value;
          setSelectedId(nextId);
          const profile = profiles.find(entry => entry.id === nextId);
          if (!profile) return;
          onPick(profile.loginId, profile.password);
        }}
      >
        <option value="">Select a test user…</option>
        {profiles.map(profile => (
          <option key={profile.id} value={profile.id}>
            {profile.label}
          </option>
        ))}
      </select>
    </div>
  );
};
