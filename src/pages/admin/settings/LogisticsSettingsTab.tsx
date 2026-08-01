import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Save, Truck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  listHrStaffUsers,
  loadLogisticsSettings,
  saveDefaultStaffLogisticsSite,
  saveLogisticsFromAddresses,
} from '../../../lib/logisticsSettings';
import { updateUserProfile } from '../../../lib/userAdmin';
import { db } from '../../../firebase';
import { staffDepartmentLabel } from '../../../lib/staffAccess';
import type { UserRecord } from '../../../types';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  staffLogisticsSiteLabel,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';
import { StCourierRatesSettings } from './StCourierRatesSettings';

type LogisticsSettingsSubTab = 'sites' | 'courier-rates' | 'staff';

const LOGISTICS_SETTINGS_SUBTABS: { id: LogisticsSettingsSubTab; label: string }[] = [
  { id: 'sites', label: 'Sites' },
  { id: 'courier-rates', label: 'Courier rates' },
  { id: 'staff', label: 'Staff' },
];

export const LogisticsSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<LogisticsSettingsSubTab>('sites');
  const [defaultSite, setDefaultSite] = useState<StaffLogisticsSite>('head_office');
  const [draftDefaultSite, setDraftDefaultSite] = useState<StaffLogisticsSite>('head_office');
  const [fromAddresses, setFromAddresses] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const [draftFromAddresses, setDraftFromAddresses] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const [staff, setStaff] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settings, staffUsers] = await Promise.all([
        loadLogisticsSettings(),
        listHrStaffUsers(),
      ]);
      setDefaultSite(settings.defaultStaffLogisticsSite);
      setDraftDefaultSite(settings.defaultStaffLogisticsSite);
      setFromAddresses(settings.fromAddresses);
      setDraftFromAddresses(settings.fromAddresses);
      setStaff(staffUsers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load logistics settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const defaultDirty = draftDefaultSite !== defaultSite;
  const fromAddressesDirty = STAFF_LOGISTICS_SITES.some(
    site => draftFromAddresses[site] !== fromAddresses[site],
  );
  const sitesDirty = defaultDirty || fromAddressesDirty;

  const staffBySite = useMemo(() => {
    const counts: Record<StaffLogisticsSite, number> = {
      cochin: 0,
      head_office: 0,
    };
    for (const record of staff) {
      if (record.staffLogisticsSite) counts[record.staffLogisticsSite] += 1;
    }
    return counts;
  }, [staff]);

  const handleSaveSites = async () => {
    setBusyKey('sites');
    setError('');
    try {
      const tasks: Promise<unknown>[] = [];
      if (defaultDirty) {
        tasks.push(
          saveDefaultStaffLogisticsSite(draftDefaultSite, user?.uid ?? null).then(saved => {
            setDefaultSite(saved);
            setDraftDefaultSite(saved);
          }),
        );
      }
      if (fromAddressesDirty) {
        tasks.push(
          saveLogisticsFromAddresses(draftFromAddresses, user?.uid ?? null).then(saved => {
            setFromAddresses(saved);
            setDraftFromAddresses(saved);
          }),
        );
      }
      await Promise.all(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save logistics sites.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleStaffSiteChange = async (record: UserRecord, site: StaffLogisticsSite) => {
    setBusyKey(record.uid);
    setError('');
    try {
      await updateUserProfile(db, record.uid, { staffLogisticsSite: site });
      setStaff(prev => prev.map(row => (
        row.uid === record.uid ? { ...row, staffLogisticsSite: site } : row
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update staff logistics location.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            Configure ship-from sites, courier rates, and staff warehouse assignments.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      <div
        className="settings-sku-correction__subtabs settings-product__subtabs"
        role="tablist"
        aria-label="Logistics settings sections"
      >
        {LOGISTICS_SETTINGS_SUBTABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            className={`settings-sku-correction__subtab ${subTab === tab.id ? 'is-active' : ''}`}
            onClick={() => {
              setSubTab(tab.id);
              setError('');
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-logistics">
        {subTab === 'sites' && (
        <div className="settings-logistics__section panel">
          <div className="settings-logistics__default-head">
            <div>
              <h4 className="settings-logistics__title">Logistics sites</h4>
              <p className="text-muted text-sm">
                Origin address on courier labels. One site is the default for new staff.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!sitesDirty || busyKey != null}
              onClick={() => void handleSaveSites()}
            >
              <Save size={15} aria-hidden />
              Save sites
            </button>
          </div>

          <div className="settings-logistics__table-wrap">
            <table className="settings-logistics__table settings-logistics__table--sites">
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Ship-from address</th>
                  <th scope="col">Default</th>
                  <th scope="col">Staff</th>
                </tr>
              </thead>
              <tbody>
                {STAFF_LOGISTICS_SITES.map(site => (
                  <tr key={site}>
                    <td className="settings-logistics__site-name">
                      <MapPin size={15} aria-hidden />
                      <strong>{STAFF_LOGISTICS_SITE_LABELS[site]}</strong>
                    </td>
                    <td>
                      <label className="settings-logistics__address-field">
                        <span className="sr-only">
                          {STAFF_LOGISTICS_SITE_LABELS[site]} ship-from address
                        </span>
                        <textarea
                          rows={3}
                          value={draftFromAddresses[site]}
                          disabled={busyKey === 'sites'}
                          onChange={event => setDraftFromAddresses(prev => ({
                            ...prev,
                            [site]: event.target.value,
                          }))}
                          placeholder="Company name, address, city, state, pincode, phone"
                        />
                      </label>
                    </td>
                    <td className="settings-logistics__default-cell">
                      <label className="settings-logistics__default-radio">
                        <input
                          type="radio"
                          name="default-logistics-site"
                          checked={draftDefaultSite === site}
                          disabled={busyKey === 'sites'}
                          onChange={() => setDraftDefaultSite(site)}
                        />
                        <span>{draftDefaultSite === site ? 'Default' : '—'}</span>
                      </label>
                    </td>
                    <td className="settings-logistics__staff-count">
                      {staffBySite[site]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {subTab === 'courier-rates' && (
          <StCourierRatesSettings onError={setError} />
        )}

        {subTab === 'staff' && (
        <div className="settings-logistics__section panel">
          <div className="settings-logistics__default-head">
            <div>
              <h4 className="settings-logistics__title">Staff assignments</h4>
              <p className="text-muted text-sm">
                Each HR staff member ships from Cochin or Head Office.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="settings-locations__loading">
              <div className="loader-ring" />
            </div>
          ) : staff.length === 0 ? (
            <div className="settings-locations__empty">
              <Truck size={28} aria-hidden />
              <p>No HR staff accounts yet.</p>
            </div>
          ) : (
            <div className="settings-logistics__table-wrap">
              <table className="settings-logistics__table">
                <thead>
                  <tr>
                    <th scope="col">Staff</th>
                    <th scope="col">Department</th>
                    <th scope="col">Logistics site</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map(record => (
                    <tr key={record.uid}>
                      <td>
                        <Link to={`/super-admin/hr/staff/${record.uid}`} className="settings-logistics__staff-link">
                          {record.displayName}
                        </Link>
                        {record.active === false && (
                          <span className="settings-logistics__inactive text-muted text-sm">Inactive</span>
                        )}
                      </td>
                      <td>{staffDepartmentLabel(record.staffDepartment)}</td>
                      <td>
                        <select
                          className="settings-logistics__site-select"
                          value={record.staffLogisticsSite ?? ''}
                          disabled={busyKey != null}
                          onChange={e => {
                            const site = e.target.value as StaffLogisticsSite;
                            if (!site) return;
                            void handleStaffSiteChange(record, site);
                          }}
                        >
                          <option value="" disabled>Select site</option>
                          {STAFF_LOGISTICS_SITES.map(site => (
                            <option key={site} value={site}>
                              {STAFF_LOGISTICS_SITE_LABELS[site]}
                            </option>
                          ))}
                        </select>
                        {!record.staffLogisticsSite && (
                          <span className="settings-logistics__unassigned text-muted text-sm">
                            Not set · new staff default is {staffLogisticsSiteLabel(defaultSite)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}
      </div>
    </section>
  );
};
