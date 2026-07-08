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

export const LogisticsSettingsTab: React.FC = () => {
  const { user } = useAuth();
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

  const handleSaveDefault = async () => {
    setBusyKey('default');
    setError('');
    try {
      const saved = await saveDefaultStaffLogisticsSite(draftDefaultSite, user?.uid ?? null);
      setDefaultSite(saved);
      setDraftDefaultSite(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save default logistics location.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveFromAddresses = async () => {
    setBusyKey('from-addresses');
    setError('');
    try {
      const saved = await saveLogisticsFromAddresses(draftFromAddresses, user?.uid ?? null);
      setFromAddresses(saved);
      setDraftFromAddresses(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save ship-from addresses.');
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
            Map HR staff to Cochin or Head Office. New staff accounts use the default location below.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      <div className="settings-logistics">
        <div className="settings-logistics__default panel glass">
          <div className="settings-logistics__default-head">
            <div>
              <h4 className="settings-logistics__title">Default logistics location</h4>
              <p className="text-muted text-sm">
                Pre-selected when creating a new staff member.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!defaultDirty || busyKey != null}
              onClick={() => void handleSaveDefault()}
            >
              <Save size={15} aria-hidden />
              Save default
            </button>
          </div>
          <label className="settings-locations__field settings-logistics__default-field">
            <span>Location</span>
            <select
              value={draftDefaultSite}
              onChange={e => setDraftDefaultSite(e.target.value as StaffLogisticsSite)}
              disabled={busyKey === 'default'}
            >
              {STAFF_LOGISTICS_SITES.map(site => (
                <option key={site} value={site}>{STAFF_LOGISTICS_SITE_LABELS[site]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-logistics__default panel glass">
          <div className="settings-logistics__default-head">
            <div>
              <h4 className="settings-logistics__title">Ship-from addresses</h4>
              <p className="text-muted text-sm">
                Free-text origin address used on courier labels for each logistics site.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!fromAddressesDirty || busyKey != null}
              onClick={() => void handleSaveFromAddresses()}
            >
              <Save size={15} aria-hidden />
              Save addresses
            </button>
          </div>
          {STAFF_LOGISTICS_SITES.map(site => (
            <label key={site} className="settings-locations__field settings-logistics__from-field">
              <span>{STAFF_LOGISTICS_SITE_LABELS[site]}</span>
              <textarea
                rows={4}
                value={draftFromAddresses[site]}
                disabled={busyKey === 'from-addresses'}
                onChange={event => setDraftFromAddresses(prev => ({
                  ...prev,
                  [site]: event.target.value,
                }))}
                placeholder="Company name, address lines, city, state, pincode, phone"
              />
            </label>
          ))}
        </div>

        <div className="settings-logistics__summary">
          {STAFF_LOGISTICS_SITES.map(site => (
            <span key={site} className="settings-logistics__summary-chip">
              <MapPin size={14} aria-hidden />
              {STAFF_LOGISTICS_SITE_LABELS[site]}: {staffBySite[site]}
            </span>
          ))}
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
                  <th scope="col">Logistics location</th>
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
                        <option value="" disabled>Select location</option>
                        {STAFF_LOGISTICS_SITES.map(site => (
                          <option key={site} value={site}>
                            {STAFF_LOGISTICS_SITE_LABELS[site]}
                          </option>
                        ))}
                      </select>
                      {!record.staffLogisticsSite && (
                        <span className="settings-logistics__unassigned text-muted text-sm">
                          Not set · shows as {staffLogisticsSiteLabel(defaultSite)} for new staff only
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
    </section>
  );
};
