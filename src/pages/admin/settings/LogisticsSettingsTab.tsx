import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MapPin, Save } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  BLUE_DART_PICKUP_PIN_BY_SITE,
  withBlueDartPickupPins,
} from '../../../constants/blueDartPickup';
import { syncLogisticsShipFromAddressesToAllBookings } from '../../../lib/logisticsBookings';
import type { DeliveryPartnerTransporters } from '../../../constants/deliveryPartnerTabs';
import {
  loadLogisticsSettings,
  saveLogisticsFromAddresses,
  saveLogisticsFromSiteContacts,
  type LogisticsSiteContact,
} from '../../../lib/logisticsSettings';
import { FIRM_GSTIN, FIRM_PHONE } from '../../../constants/brand';
import {
  STAFF_LOGISTICS_SITES,
  STAFF_LOGISTICS_SITE_LABELS,
  type StaffLogisticsSite,
} from '../../../types/staff-logistics';
import { StCourierRatesSettings } from './StCourierRatesSettings';
import { DeliveryPartnerRulesSettings } from './DeliveryPartnerRulesSettings';
import { SpareBoxDefinitionsSettings } from './SpareBoxDefinitionsSettings';
import type { LogisticsDeliveryRulesMatrix } from '../../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../../types/logistics-partner-status';
import type { SpareBoxDefinition } from '../../../types/spare-box-definitions';

function autosizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 1)}px`;
}

type LogisticsSettingsSubTab =
  | 'sites'
  | 'delivery-rules'
  | 'courier-rates'
  | 'spare-box-dia';

const LOGISTICS_SETTINGS_SUBTABS: { id: LogisticsSettingsSubTab; label: string }[] = [
  { id: 'courier-rates', label: 'Delivery Partners' },
  { id: 'sites', label: 'Sites' },
  { id: 'delivery-rules', label: 'Delivery rules' },
  { id: 'spare-box-dia', label: 'Spare box dia' },
];

export const LogisticsSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<LogisticsSettingsSubTab>('courier-rates');
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
  const [partnerTransporters, setPartnerTransporters] = useState<DeliveryPartnerTransporters | null>(null);
  const [spareBoxDefinitions, setSpareBoxDefinitions] = useState<SpareBoxDefinition[]>([]);
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
      const settings = await loadLogisticsSettings();
      const fromAddressesNext = withBlueDartPickupPins(settings.fromAddresses);
      const pinRewritten = STAFF_LOGISTICS_SITES.some(
        site => fromAddressesNext[site] !== settings.fromAddresses[site],
      );
      if (pinRewritten) {
        await saveLogisticsFromAddresses(fromAddressesNext, user?.uid ?? null);
      }
      setFromAddresses(fromAddressesNext);
      setDraftFromAddresses(fromAddressesNext);
      setFromSiteContacts(settings.fromSiteContacts);
      setDraftFromSiteContacts(settings.fromSiteContacts);
      setDeliveryRules(settings.deliveryRules);
      setPartnerStatuses(settings.partnerStatuses);
      setPartnerTransporters(settings.partnerTransporters);
      setSpareBoxDefinitions(settings.spareBoxDefinitions);

      const hasAddress = STAFF_LOGISTICS_SITES.some(
        site => Boolean(fromAddressesNext[site]?.trim()),
      );
      if (hasAddress && !didAutoSyncShipFromRef.current) {
        didAutoSyncShipFromRef.current = true;
        const result = await syncLogisticsShipFromAddressesToAllBookings(fromAddressesNext);
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
  }, [user?.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useLayoutEffect(() => {
    if (subTab !== 'sites') return;
    for (const site of STAFF_LOGISTICS_SITES) {
      autosizeTextarea(addressRefs.current[site] ?? null);
    }
  }, [subTab, draftFromAddresses, loading]);

  const fromAddressesDirty = STAFF_LOGISTICS_SITES.some(
    site => draftFromAddresses[site] !== fromAddresses[site],
  );
  const fromSiteContactsDirty = STAFF_LOGISTICS_SITES.some(site => (
    draftFromSiteContacts[site].phone !== fromSiteContacts[site].phone
    || draftFromSiteContacts[site].gstin !== fromSiteContacts[site].gstin
  ));
  const sitesDirty = fromAddressesDirty || fromSiteContactsDirty;

  const handleSaveSites = async () => {
    setBusyKey('sites');
    setError('');
    try {
      const tasks: Promise<unknown>[] = [];
      if (fromAddressesDirty) {
        const addressesToSave = withBlueDartPickupPins(draftFromAddresses);
        tasks.push(
          saveLogisticsFromAddresses(addressesToSave, user?.uid ?? null).then(async saved => {
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

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            Configure ship-from sites, delivery partner rules, and partner rates.
            Ship-from on sales orders and invoices follows automatic warehouse site selection.
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
                ({FIRM_PHONE} / {FIRM_GSTIN}). Blue Dart pickup uses the official pin on each
                card (Cochin 683104, Head Office 682019).
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
              const bdPin = BLUE_DART_PICKUP_PIN_BY_SITE[site];
              return (
              <div key={site} className="settings-logistics__site-card">
                <div className="settings-logistics__site-card-head">
                  <div className="settings-logistics__site-card-title">
                    <MapPin size={16} aria-hidden />
                    <strong>{STAFF_LOGISTICS_SITE_LABELS[site]}</strong>
                  </div>
                  <div className="settings-logistics__site-card-meta">
                    <span className="settings-logistics__site-staff-chip settings-logistics__bd-chip--match">
                      Blue Dart pickup {bdPin}
                    </span>
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

        {subTab === 'courier-rates' && deliveryRules && partnerStatuses && partnerTransporters && (
          <StCourierRatesSettings
            deliveryRules={deliveryRules}
            partnerStatuses={partnerStatuses}
            partnerTransporters={partnerTransporters}
            onPartnerStatusesSaved={setPartnerStatuses}
            onPartnerTransportersSaved={setPartnerTransporters}
            onError={setError}
          />
        )}

        {subTab === 'spare-box-dia' && !loading && (
          <SpareBoxDefinitionsSettings
            key={spareBoxDefinitions.map(d => d.id).join('|') || 'empty'}
            definitions={spareBoxDefinitions}
            updatedBy={user?.uid ?? null}
            onSaved={setSpareBoxDefinitions}
            onError={setError}
          />
        )}
      </div>
    </section>
  );
};
