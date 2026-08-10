import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Save, Truck, Users } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { syncLogisticsShipFromAddressesToAllBookings } from '../../../lib/logisticsBookings';
import {
  listHrStaffUsers,
  loadLogisticsSettings,
  saveDefaultStaffLogisticsSite,
  saveLogisticsFromAddresses,
  saveLogisticsFromSiteContacts,
  type LogisticsSiteContact,
} from '../../../lib/logisticsSettings';
import { FIRM_GSTIN, FIRM_PHONE } from '../../../constants/brand';
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
import { DeliveryPartnerRulesSettings } from './DeliveryPartnerRulesSettings';
import { LogisticsFreightTestingPanel } from './LogisticsFreightTestingPanel';
import type { LogisticsDeliveryRulesMatrix } from '../../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../../types/logistics-partner-status';

function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 1)}px`;
}

type LogisticsSettingsSubTab =
  | 'sites'
  | 'delivery-rules'
  | 'courier-rates'
  | 'staff'
  | 'testing';

const LOGISTICS_SETTINGS_SUBTABS: { id: LogisticsSettingsSubTab; label: string }[] = [
  { id: 'courier-rates', label: 'Delivery Partners' },
  { id: 'sites', label: 'Sites' },
  { id: 'delivery-rules', label: 'Delivery rules' },
  { id: 'staff', label: 'Staff' },
  { id: 'testing', label: 'Testing' },
];

export const LogisticsSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<LogisticsSettingsSubTab>('courier-rates');
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
  const [fromSiteContacts, setFromSiteContacts] = useState<Record<StaffLogisticsSite, LogisticsSiteContact>>({
    cochin: { phone: '', gstin: '' },
    head_office: { phone: '', gstin: '' },
  });
  const [draftFromSiteContacts, setDraftFromSiteContacts] = useState<Record<StaffLogisticsSite, LogisticsSiteContact>>({
    cochin: { phone: '', gstin: '' },
    head_office: { phone: '', gstin: '' },
  });
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [partnerStatuses, setPartnerStatuses] = useState<LogisticsPartnerStatuses | null>(null);
  const [staff, setStaff] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [shipFromSyncNote, setShipFromSyncNote] = useState('');
  const addressRefs = useRef<Partial<Record<StaffLogisticsSite, HTMLTextAreaElement | null>>>({});
  const didAutoSyncShipFromRef = useRef(false);

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
      setFromSiteContacts(settings.fromSiteContacts);
      setDraftFromSiteContacts(settings.fromSiteContacts);
      setDeliveryRules(settings.deliveryRules);
      setPartnerStatuses(settings.partnerStatuses);
      setStaff(staffUsers);

      const hasAddress = STAFF_LOGISTICS_SITES.some(
        site => Boolean(settings.fromAddresses[site]?.trim()),
      );
      if (hasAddress && !didAutoSyncShipFromRef.current) {
        didAutoSyncShipFromRef.current = true;
        const result = await syncLogisticsShipFromAddressesToAllBookings(settings.fromAddresses);
        if (result.updated > 0) {
          setShipFromSyncNote(
            `Applied ship-from addresses to ${result.updated} of ${result.scanned} bookings.`,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load logistics settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useLayoutEffect(() => {
    if (subTab !== 'sites') return;
    for (const site of STAFF_LOGISTICS_SITES) {
      autosizeTextarea(addressRefs.current[site] ?? null);
    }
  }, [subTab, draftFromAddresses, loading]);

  const defaultDirty = draftDefaultSite !== defaultSite;
  const fromAddressesDirty = STAFF_LOGISTICS_SITES.some(
    site => draftFromAddresses[site] !== fromAddresses[site],
  );
  const fromSiteContactsDirty = STAFF_LOGISTICS_SITES.some(site => (
    draftFromSiteContacts[site].phone !== fromSiteContacts[site].phone
    || draftFromSiteContacts[site].gstin !== fromSiteContacts[site].gstin
  ));
  const sitesDirty = defaultDirty || fromAddressesDirty || fromSiteContactsDirty;

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
          saveLogisticsFromAddresses(draftFromAddresses, user?.uid ?? null).then(async saved => {
            setFromAddresses(saved);
            setDraftFromAddresses(saved);
            const result = await syncLogisticsShipFromAddressesToAllBookings(saved);
            setShipFromSyncNote(
              result.updated > 0
                ? `Saved and applied ship-from to ${result.updated} of ${result.scanned} bookings.`
                : `Saved. All ${result.scanned} bookings already match these addresses.`,
            );
          }),
        );
      }
      if (fromSiteContactsDirty) {
        tasks.push(
          saveLogisticsFromSiteContacts(draftFromSiteContacts, user?.uid ?? null).then(saved => {
            setFromSiteContacts(saved);
            setDraftFromSiteContacts(saved);
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
            Configure ship-from sites, delivery partner rules, partner rates, and staff warehouse assignments.
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
                Ship-from address, phone, and GSTIN for courier docs. Address save also applies to
                existing bookings. Empty phone/GSTIN fall back to firm defaults
                ({FIRM_PHONE} / {FIRM_GSTIN}). Mark one site as default for new staff.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!sitesDirty || busyKey != null}
              onClick={() => void handleSaveSites()}
            >
              <Save size={15} aria-hidden />
              Save
            </button>
          </div>
          {shipFromSyncNote && (
            <p className="text-muted text-sm settings-logistics__sync-note" role="status">
              {shipFromSyncNote}
            </p>
          )}

          <div className="settings-logistics__from-grid">
            {STAFF_LOGISTICS_SITES.map(site => {
              const isDefault = draftDefaultSite === site;
              return (
                <div
                  key={site}
                  className={`settings-logistics__site-card${isDefault ? ' is-default' : ''}`}
                >
                  <div className="settings-logistics__site-card-head">
                    <div className="settings-logistics__site-card-title">
                      <MapPin size={16} aria-hidden />
                      <strong>{STAFF_LOGISTICS_SITE_LABELS[site]}</strong>
                    </div>
                    <div className="settings-logistics__site-card-meta">
                      <span className="settings-logistics__site-staff-chip" title="Assigned staff">
                        <Users size={13} aria-hidden />
                        {staffBySite[site]}
                      </span>
                      <label className={`settings-logistics__default-pill${isDefault ? ' is-on' : ''}`}>
                        <input
                          type="radio"
                          name="default-logistics-site"
                          checked={isDefault}
                          disabled={busyKey === 'sites'}
                          onChange={() => setDraftDefaultSite(site)}
                        />
                        <span>{isDefault ? 'Default' : 'Set default'}</span>
                      </label>
                    </div>
                  </div>
                  <label className="settings-logistics__site-card-address">
                    <span className="settings-logistics__site-card-address-label">Ship-from address</span>
                    <textarea
                      rows={1}
                      className="settings-logistics__site-card-textarea"
                      value={draftFromAddresses[site]}
                      disabled={busyKey === 'sites'}
                      ref={el => {
                        addressRefs.current[site] = el;
                        autosizeTextarea(el);
                      }}
                      onChange={event => {
                        const el = event.currentTarget;
                        setDraftFromAddresses(prev => ({
                          ...prev,
                          [site]: el.value,
                        }));
                        autosizeTextarea(el);
                      }}
                      onInput={event => autosizeTextarea(event.currentTarget)}
                      placeholder="Company name, address, city, state, pincode"
                    />
                  </label>
                  <div className="settings-logistics__site-card-contacts">
                    <label className="settings-logistics__site-card-contact">
                      <span className="settings-logistics__site-card-address-label">Phone</span>
                      <input
                        type="tel"
                        className="settings-logistics__site-card-input"
                        value={draftFromSiteContacts[site].phone}
                        disabled={busyKey === 'sites'}
                        placeholder={FIRM_PHONE}
                        onChange={event => {
                          const phone = event.currentTarget.value;
                          setDraftFromSiteContacts(prev => ({
                            ...prev,
                            [site]: { ...prev[site], phone },
                          }));
                        }}
                      />
                    </label>
                    <label className="settings-logistics__site-card-contact">
                      <span className="settings-logistics__site-card-address-label">GSTIN</span>
                      <input
                        type="text"
                        className="settings-logistics__site-card-input"
                        value={draftFromSiteContacts[site].gstin}
                        disabled={busyKey === 'sites'}
                        placeholder={FIRM_GSTIN}
                        autoCapitalize="characters"
                        onChange={event => {
                          const gstin = event.currentTarget.value.toUpperCase();
                          setDraftFromSiteContacts(prev => ({
                            ...prev,
                            [site]: { ...prev[site], gstin },
                          }));
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
        )}

        {subTab === 'delivery-rules' && deliveryRules && (
          <DeliveryPartnerRulesSettings
            rules={deliveryRules}
            updatedBy={user?.uid ?? null}
            onSaved={setDeliveryRules}
            onError={setError}
          />
        )}

        {subTab === 'courier-rates' && deliveryRules && partnerStatuses && (
          <StCourierRatesSettings
            deliveryRules={deliveryRules}
            partnerStatuses={partnerStatuses}
            onPartnerStatusesSaved={setPartnerStatuses}
            onError={setError}
          />
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

        {subTab === 'testing' && <LogisticsFreightTestingPanel />}
      </div>
    </section>
  );
};
